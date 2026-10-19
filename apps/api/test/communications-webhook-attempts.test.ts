import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type {
  PrismaClient,
  WhatsAppMessageStatus,
} from "../src/generated/prisma/client";
import {
  CommunicationsMessageService,
  hashProviderMessageId,
  hashWebhookEvent,
} from "../src/modules/communications/messages-service";
import { WhatsAppQueueWorker } from "../src/modules/communications/worker";
import type { WhatsAppProvider } from "../src/services/waha-client";

const secret = "attempt-webhook-test-secret";
const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "99999999-9999-4999-8999-999999999999";
const patientId = "22222222-2222-4222-8222-222222222222";
const appointmentId = "33333333-3333-4333-8333-333333333333";
const actorUserId = "44444444-4444-4444-8444-444444444444";

type FakeMessage = {
  id: string;
  organizationId: string;
  patientId: string;
  appointmentId: string;
  templateVersionId: string;
  eventId: string;
  type: "APPOINTMENT_CREATED";
  status: WhatsAppMessageStatus;
  scheduledFor: Date;
  sentAt: Date | null;
  providerMessageHash: string | null;
  attemptCount: number;
  nextAttemptAt: Date;
  leaseUntil: Date | null;
  uncertainAt: Date | null;
  errorCode: string | null;
  errorReason: string | null;
};

type FakeAttempt = {
  id: string;
  organizationId: string | null;
  messageId: string;
  number: number;
  origin?: "AUTOMATIC" | "MANUAL";
  idempotencyKey?: string | null;
  requestedById?: string | null;
  startedAt?: Date;
  dispatchedAt: Date | null;
  completedAt?: Date | null;
  providerMessageHash: string | null;
  errorCode?: string | null;
  errorReason?: string | null;
};

type FakeEvent = {
  id: string;
  organizationId: string;
  providerEventId: string;
  providerMessageHash: string;
  messageId: string | null;
  attemptId: string | null;
  status: WhatsAppMessageStatus;
};

class TransactionLocks {
  private readonly tails = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(
      key,
      previous.then(() => current),
    );
    await previous;
    return release;
  }
}

function createWebhookPrisma(input?: {
  messages?: FakeMessage[];
  attempts?: FakeAttempt[];
}) {
  const messages = input?.messages ?? [];
  const attempts = input?.attempts ?? [];
  const events: FakeEvent[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const locks = new TransactionLocks();
  let eventSequence = 1;
  let attemptSequence = 1;

  function matchesValue(current: unknown, expected: unknown): boolean {
    if (expected instanceof Date)
      return (
        current instanceof Date && current.getTime() === expected.getTime()
      );
    if (!expected || typeof expected !== "object") return current === expected;
    const condition = expected as {
      gt?: number;
      lt?: Date;
      lte?: Date;
      not?: unknown;
    };
    if (condition.gt !== undefined)
      return typeof current === "number" && current > condition.gt;
    if (condition.lt)
      return (
        current instanceof Date && current.getTime() < condition.lt.getTime()
      );
    if (condition.lte)
      return (
        current instanceof Date && current.getTime() <= condition.lte.getTime()
      );
    if ("not" in condition)
      return condition.not === null
        ? current !== null && current !== undefined
        : current !== condition.not;
    return true;
  }

  function attemptMatches(
    attempt: FakeAttempt,
    where: Record<string, unknown>,
  ): boolean {
    const and = where.AND as Array<Record<string, unknown>> | undefined;
    const or = where.OR as Array<Record<string, unknown>> | undefined;
    if (and && !and.every((condition) => attemptMatches(attempt, condition)))
      return false;
    if (or && !or.some((condition) => attemptMatches(attempt, condition)))
      return false;
    for (const field of [
      "id",
      "organizationId",
      "messageId",
      "number",
      "origin",
      "idempotencyKey",
      "dispatchedAt",
      "completedAt",
      "providerMessageHash",
    ] as const) {
      if (field in where && !matchesValue(attempt[field], where[field]))
        return false;
    }
    return true;
  }

  function messageMatches(
    candidate: FakeMessage,
    where: Record<string, unknown>,
  ): boolean {
    for (const field of [
      "id",
      "organizationId",
      "patientId",
      "appointmentId",
      "status",
      "providerMessageHash",
      "nextAttemptAt",
      "leaseUntil",
      "uncertainAt",
    ] as const) {
      if (field in where && !matchesValue(candidate[field], where[field]))
        return false;
    }
    const and = where.AND as
      | Array<{
          scopedAttempts?: {
            some?: Record<string, unknown>;
            none?: Record<string, unknown>;
          };
        }>
      | undefined;
    if (!and) return true;
    const scopedAttempts = attempts.filter(
      (attempt) =>
        attempt.organizationId === candidate.organizationId &&
        attempt.messageId === candidate.id,
    );
    return and.every((condition) => {
      if (!condition.scopedAttempts) return true;
      if (
        condition.scopedAttempts.some &&
        !scopedAttempts.some((attempt) =>
          attemptMatches(attempt, condition.scopedAttempts?.some ?? {}),
        )
      )
        return false;
      if (
        condition.scopedAttempts.none &&
        scopedAttempts.some((attempt) =>
          attemptMatches(attempt, condition.scopedAttempts?.none ?? {}),
        )
      )
        return false;
      return true;
    });
  }

  const messageDelegate = {
    findMany: async ({
      where,
      take,
    }: {
      where: Record<string, unknown>;
      take?: number;
    }) =>
      messages
        .filter((item) => messageMatches(item, where))
        .slice(0, take ?? messages.length),
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      messages.find((item) => messageMatches(item, where)) ?? null,
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<FakeMessage>;
    }) => {
      const matching = messages.filter((item) => messageMatches(item, where));
      for (const item of matching) Object.assign(item, data);
      return { count: matching.length };
    },
  };

  const attemptDelegate = {
    findUnique: async ({
      where,
    }: {
      where: {
        organizationId_providerMessageHash: {
          organizationId: string;
          providerMessageHash: string;
        };
      };
    }) => {
      const key = where.organizationId_providerMessageHash;
      return (
        attempts.find(
          (attempt) =>
            attempt.organizationId === key.organizationId &&
            attempt.providerMessageHash === key.providerMessageHash,
        ) ?? null
      );
    },
    findMany: async ({
      where,
      take,
    }: {
      where: {
        organizationId: null;
        messageId: string;
        providerMessageHash: string;
      };
      take: number;
    }) =>
      attempts
        .filter(
          (attempt) =>
            attempt.organizationId === null &&
            attempt.messageId === where.messageId &&
            attempt.providerMessageHash === where.providerMessageHash,
        )
        .sort((left, right) => right.number - left.number)
        .slice(0, take),
    findFirst: async ({
      where,
      orderBy,
    }: {
      where: Record<string, unknown>;
      orderBy?: { number: "desc" };
    }) => {
      const matching = attempts.filter((attempt) =>
        attemptMatches(attempt, where),
      );
      if (orderBy?.number === "desc")
        matching.sort((left, right) => right.number - left.number);
      return matching[0] ?? null;
    },
    create: async ({
      data,
    }: {
      data: Omit<FakeAttempt, "id" | "dispatchedAt" | "providerMessageHash">;
    }) => {
      const attempt: FakeAttempt = {
        ...data,
        id: `created-attempt-${attemptSequence++}`,
        dispatchedAt: null,
        completedAt: null,
        providerMessageHash: null,
        errorCode: null,
        errorReason: null,
      };
      attempts.push(attempt);
      return attempt;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<FakeAttempt>;
    }) => {
      const matching = attempts.filter((attempt) =>
        attemptMatches(attempt, where),
      );
      for (const attempt of matching) Object.assign(attempt, data);
      return { count: matching.length };
    },
  };

  const eventDelegate = {
    findUnique: async ({
      where,
    }: {
      where: {
        organizationId_providerEventId: {
          organizationId: string;
          providerEventId: string;
        };
      };
    }) => {
      const key = where.organizationId_providerEventId;
      return (
        events.find(
          (event) =>
            event.organizationId === key.organizationId &&
            event.providerEventId === key.providerEventId,
        ) ?? null
      );
    },
    create: async ({ data }: { data: Omit<FakeEvent, "id"> }) => {
      if (
        events.some(
          (event) =>
            event.organizationId === data.organizationId &&
            event.providerEventId === data.providerEventId,
        )
      )
        throw { code: "P2002" };
      const event = { ...data, id: `event-${eventSequence++}` };
      events.push(event);
      return event;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<FakeEvent>;
    }) => {
      let count = 0;
      for (const event of events) {
        const alternatives = where.OR as
          | Array<{ attemptId: string | null }>
          | undefined;
        const matchesAlternative =
          !alternatives ||
          alternatives.some(
            (alternative) => event.attemptId === alternative.attemptId,
          );
        if (
          event.organizationId === where.organizationId &&
          event.providerMessageHash === where.providerMessageHash &&
          (where.messageId === undefined ||
            event.messageId === where.messageId) &&
          (where.attemptId === undefined ||
            event.attemptId === where.attemptId) &&
          matchesAlternative
        ) {
          Object.assign(event, data);
          count += 1;
        }
      }
      return { count };
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) =>
      events
        .filter(
          (event) =>
            event.organizationId === where.organizationId &&
            (where.attemptId !== undefined
              ? event.attemptId === where.attemptId
              : event.providerMessageHash === where.providerMessageHash &&
                event.messageId === where.messageId &&
                event.attemptId === null),
        )
        .map(({ status }) => ({ status })),
  };

  const preferenceDelegate = {
    findFirst: async () => ({ id: "preference" }),
  };
  const appointmentDelegate = {
    findFirst: async () => ({
      version: 2,
      status: "RESERVED",
      scheduledAt: new Date(Date.now() + 86_400_000),
      patient: { phone: "11987654321", fullName: "Pessoa" },
      professional: { fullName: "Profissional" },
      organization: { name: "Clínica", timezone: "America/Sao_Paulo" },
    }),
  };
  const sessionDelegate = {
    findFirst: async ({ where }: { where: { providerSessionName: string } }) =>
      where.providerSessionName === "other"
        ? { organizationId: otherOrganizationId }
        : { organizationId },
    findUnique: async () => ({ providerSessionName: "private" }),
  };

  const prisma = {
    whatsAppMessage: messageDelegate,
    whatsAppMessageAttempt: attemptDelegate,
    whatsAppWebhookEvent: eventDelegate,
    whatsAppPreference: preferenceDelegate,
    appointment: appointmentDelegate,
    whatsAppSession: sessionDelegate,
    whatsAppTemplateVersion: {
      findFirst: async () => ({
        id: "template-version",
        content: "Consulta de {paciente_nome} em {data} às {hora}.",
      }),
    },
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const tx = {
        whatsAppMessage: messageDelegate,
        whatsAppMessageAttempt: attemptDelegate,
        whatsAppWebhookEvent: eventDelegate,
        whatsAppPreference: preferenceDelegate,
        appointment: appointmentDelegate,
        auditLog: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            audits.push(data);
            return { ...data, id: `audit-${audits.length}` };
          },
        },
        $queryRaw: async (
          query: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          const sql = query.join("?");
          if (sql.includes("pg_advisory_xact_lock")) {
            releases.push(
              await locks.acquire(
                `advisory:${String(values[0])}:${String(values[1])}`,
              ),
            );
            return [{ lockEvaluated: true }];
          }
          if (sql.includes("FOR SHARE OF preference"))
            return [{ id: "preference" }];
          if (sql.includes('FROM "WhatsAppMessage"')) {
            releases.push(
              await locks.acquire(
                `message:${String(values[0])}:${String(values[1])}`,
              ),
            );
            return messages.some(
              (message) =>
                message.organizationId === values[0] &&
                message.id === values[1],
            )
              ? [{ id: values[1] }]
              : [];
          }
          if (sql.includes('FROM "WhatsAppPreference"'))
            return [{ id: "preference" }];
          throw new Error(`Unexpected SQL in webhook harness: ${sql}`);
        },
      };
      try {
        return await operation(tx);
      } finally {
        for (const release of releases.reverse()) release();
      }
    },
  } as unknown as PrismaClient;

  return { prisma, messages, attempts, events, audits };
}

async function acknowledge(
  service: CommunicationsMessageService,
  providerMessageId: string,
  ackName: "ERROR" | "SERVER" | "DEVICE" | "READ",
  ack: -1 | 1 | 2 | 3,
  session = "private",
) {
  const raw = JSON.stringify({
    event: "message.ack",
    session,
    payload: { id: providerMessageId, ackName, ack },
  });
  await service.webhook(
    raw,
    createHmac("sha512", secret).update(raw).digest("hex"),
    `request-${Math.random()}`,
    String(Date.now()),
    secret,
  );
  return hashWebhookEvent(raw);
}

function message(
  id: string,
  organization: string,
  providerMessageHash: string | null,
  status: WhatsAppMessageStatus = "QUEUED",
): FakeMessage {
  return {
    id,
    organizationId: organization,
    patientId,
    appointmentId,
    templateVersionId: "template-version",
    eventId: `${appointmentId}:2`,
    type: "APPOINTMENT_CREATED",
    status,
    scheduledFor: new Date(Date.now() - 60_000),
    sentAt: status === "SENT" ? new Date() : null,
    providerMessageHash,
    attemptCount: 1,
    nextAttemptAt: new Date(Date.now() - 60_000),
    leaseUntil: null,
    uncertainAt: null,
    errorCode: null,
    errorReason: null,
  };
}

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function raceOldAckBeforeManualFence(
  ackName: "ERROR" | "READ",
  ack: -1 | 3,
) {
  const oldProviderId = `old-before-dispatch-${ackName}`;
  const oldHash = hashProviderMessageId(oldProviderId);
  const currentMessage = message("message-reserved", organizationId, oldHash);
  const reservedAttempt: FakeAttempt = {
    id: "attempt-reserved",
    organizationId,
    messageId: currentMessage.id,
    number: 2,
    origin: "MANUAL",
    idempotencyKey: "original-resend-key",
    requestedById: actorUserId,
    startedAt: new Date(Date.now() - 120_000),
    dispatchedAt: null,
    completedAt: null,
    providerMessageHash: null,
    errorCode: null,
    errorReason: null,
  };
  const state = createWebhookPrisma({
    messages: [currentMessage],
    attempts: [
      {
        id: "attempt-old",
        organizationId,
        messageId: currentMessage.id,
        number: 1,
        origin: "AUTOMATIC",
        startedAt: new Date(Date.now() - 300_000),
        dispatchedAt: new Date(Date.now() - 240_000),
        completedAt: new Date(Date.now() - 230_000),
        providerMessageHash: oldHash,
      },
      reservedAttempt,
    ],
  });
  const workerReachedProviderCheck = gate();
  const resumeWorker = gate();
  let sendCalls = 0;
  const provider: WhatsAppProvider = {
    getSession: async () => {
      workerReachedProviderCheck.open();
      await resumeWorker.promise;
      return { status: "WORKING" };
    },
    createSession: async () => ({ status: "WORKING" }),
    restartSession: async () => {},
    getQr: async () => null,
    sendText: async () => {
      sendCalls += 1;
      return "unexpected-provider-message";
    },
  };
  const workerRun = new WhatsAppQueueWorker(
    state.prisma,
    provider,
  ).processBatch(1);

  await workerReachedProviderCheck.promise;
  expect(currentMessage.leaseUntil).toBeInstanceOf(Date);

  await acknowledge(
    new CommunicationsMessageService(state.prisma),
    oldProviderId,
    ackName,
    ack,
  );
  resumeWorker.open();
  expect(await workerRun).toBe(1);

  return { ...state, currentMessage, reservedAttempt, sendCalls };
}

describe("WhatsApp webhook attempt reconciliation", () => {
  test("associates each ACK to the scoped attempt and isolates organizations", async () => {
    const providerMessageId = "same-provider-id";
    const providerMessageHash = hashProviderMessageId(providerMessageId);
    const state = createWebhookPrisma({
      messages: [
        message("message-own", organizationId, providerMessageHash, "SENT"),
        message(
          "message-other",
          otherOrganizationId,
          providerMessageHash,
          "SENT",
        ),
      ],
      attempts: [
        {
          id: "attempt-own",
          organizationId,
          messageId: "message-own",
          number: 1,
          dispatchedAt: new Date(),
          providerMessageHash,
        },
        {
          id: "attempt-other",
          organizationId: otherOrganizationId,
          messageId: "message-other",
          number: 1,
          dispatchedAt: new Date(),
          providerMessageHash,
        },
      ],
    });
    const service = new CommunicationsMessageService(state.prisma);

    await acknowledge(service, providerMessageId, "READ", 3);

    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      organizationId,
      messageId: "message-own",
      attemptId: "attempt-own",
      status: "READ",
    });
    expect(state.messages.find(({ id }) => id === "message-own")?.status).toBe(
      "READ",
    );
    expect(
      state.messages.find(({ id }) => id === "message-other")?.status,
    ).toBe("SENT");
  });

  test("keeps an early ACK unassociated and links it after the attempt hash is persisted", async () => {
    const providerMessageId = "early-provider-id";
    const providerMessageHash = hashProviderMessageId(providerMessageId);
    const state = createWebhookPrisma({
      messages: [message("message-early", organizationId, null)],
    });
    const service = new CommunicationsMessageService(state.prisma);

    const providerEventId = await acknowledge(
      service,
      providerMessageId,
      "READ",
      3,
    );
    expect(state.events[0]).toMatchObject({
      providerEventId,
      messageId: null,
      attemptId: null,
    });

    state.attempts.push({
      id: "attempt-early",
      organizationId,
      messageId: "message-early",
      number: 1,
      dispatchedAt: new Date(),
      providerMessageHash,
    });
    const currentMessage = state.messages[0];
    if (!currentMessage) throw new Error("missing test message");
    currentMessage.providerMessageHash = providerMessageHash;
    currentMessage.status = "SENT";
    currentMessage.sentAt = new Date();

    await acknowledge(service, providerMessageId, "READ", 3);

    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      messageId: "message-early",
      attemptId: "attempt-early",
    });
    expect(currentMessage.status as WhatsAppMessageStatus).toBe("READ");
  });

  test("cancels an unfenced manual resend and stale worker after an old ERROR ACK", async () => {
    const state = await raceOldAckBeforeManualFence("ERROR", -1);

    expect(state.currentMessage).toMatchObject({
      status: "FAILED",
      attemptCount: 2,
      leaseUntil: null,
      errorCode: "WAHA_ACK_ERROR",
    });
    expect(state.reservedAttempt).toMatchObject({
      dispatchedAt: null,
      providerMessageHash: null,
      errorCode: "MANUAL_RESEND_CANCELLED",
    });
    expect(state.reservedAttempt.completedAt).toBeInstanceOf(Date);
    expect(state.sendCalls).toBe(0);
    expect(state.events[0]).toMatchObject({
      attemptId: "attempt-old",
      status: "FAILED",
    });

    const service = new CommunicationsMessageService(state.prisma);
    expect(
      await service.authorizeManualResend(
        organizationId,
        state.currentMessage.id,
        actorUserId,
        "new-resend-key",
      ),
    ).toEqual({ status: "QUEUED" });
    expect(state.attempts).toHaveLength(3);
    expect(state.attempts[2]).toMatchObject({
      organizationId,
      messageId: state.currentMessage.id,
      number: 3,
      origin: "MANUAL",
      idempotencyKey: "new-resend-key",
    });

    expect(
      await service.authorizeManualResend(
        organizationId,
        state.currentMessage.id,
        actorUserId,
        "original-resend-key",
      ),
    ).toEqual({ status: "QUEUED" });
    expect(state.attempts).toHaveLength(3);
    expect(state.audits).toHaveLength(1);
  });

  test("cancels an unfenced manual resend and stale worker after an old READ ACK", async () => {
    const state = await raceOldAckBeforeManualFence("READ", 3);

    expect(state.currentMessage).toMatchObject({
      status: "READ",
      attemptCount: 2,
      leaseUntil: null,
      errorCode: null,
    });
    expect(state.reservedAttempt).toMatchObject({
      dispatchedAt: null,
      providerMessageHash: null,
      errorCode: "MANUAL_RESEND_CANCELLED",
    });
    expect(state.reservedAttempt.completedAt).toBeInstanceOf(Date);
    expect(state.sendCalls).toBe(0);
    expect(state.events[0]).toMatchObject({
      attemptId: "attempt-old",
      status: "READ",
    });
  });

  test("records a late old ACK without applying it after the new attempt is dispatched", async () => {
    const oldProviderId = "old-after-dispatch";
    const newProviderId = "new-after-dispatch";
    const oldHash = hashProviderMessageId(oldProviderId);
    const newHash = hashProviderMessageId(newProviderId);
    const currentMessage = message("message-resent", organizationId, oldHash);
    const claimedLease = new Date(Date.now() + 60_000);
    currentMessage.leaseUntil = claimedLease;
    const newAttempt: FakeAttempt = {
      id: "attempt-new",
      organizationId,
      messageId: currentMessage.id,
      number: 2,
      origin: "MANUAL",
      idempotencyKey: "fenced-resend-key",
      requestedById: actorUserId,
      startedAt: new Date(Date.now() - 30_000),
      dispatchedAt: new Date(),
      completedAt: null,
      providerMessageHash: null,
      errorCode: null,
      errorReason: null,
    };
    const state = createWebhookPrisma({
      messages: [currentMessage],
      attempts: [
        {
          id: "attempt-old",
          organizationId,
          messageId: currentMessage.id,
          number: 1,
          dispatchedAt: new Date(Date.now() - 60_000),
          providerMessageHash: oldHash,
        },
        newAttempt,
      ],
    });
    const service = new CommunicationsMessageService(state.prisma);

    await acknowledge(service, oldProviderId, "READ", 3);
    expect(currentMessage.status).toBe("QUEUED");
    expect(currentMessage.leaseUntil).toEqual(claimedLease);
    expect(newAttempt.completedAt).toBeNull();
    expect(newAttempt.errorCode).toBeNull();
    expect(state.events[0]).toMatchObject({
      attemptId: "attempt-old",
      status: "READ",
    });

    newAttempt.providerMessageHash = newHash;
    currentMessage.providerMessageHash = newHash;
    currentMessage.status = "SENT";
    currentMessage.sentAt = new Date();
    await acknowledge(service, newProviderId, "DEVICE", 2);

    expect(currentMessage.status as WhatsAppMessageStatus).toBe("DELIVERED");
    expect(state.events[1]).toMatchObject({
      attemptId: "attempt-new",
      status: "DELIVERED",
    });
  });

  test("preserves the #296 fallback for a legacy attempt without organizationId", async () => {
    const providerMessageId = "legacy-provider-id";
    const providerMessageHash = hashProviderMessageId(providerMessageId);
    const state = createWebhookPrisma({
      messages: [
        message("message-legacy", organizationId, providerMessageHash, "SENT"),
      ],
      attempts: [
        {
          id: "attempt-legacy",
          organizationId: null,
          messageId: "message-legacy",
          number: 1,
          dispatchedAt: null,
          providerMessageHash,
        },
      ],
    });

    await acknowledge(
      new CommunicationsMessageService(state.prisma),
      providerMessageId,
      "READ",
      3,
    );

    expect(state.messages[0]?.status).toBe("READ");
    expect(state.events[0]).toMatchObject({
      messageId: "message-legacy",
      attemptId: null,
      status: "READ",
    });
  });

  test("serializes duplicate ACKs for the same hash into one idempotent event", async () => {
    const providerMessageId = "concurrent-provider-id";
    const providerMessageHash = hashProviderMessageId(providerMessageId);
    const state = createWebhookPrisma({
      messages: [
        message(
          "message-concurrent",
          organizationId,
          providerMessageHash,
          "SENT",
        ),
      ],
      attempts: [
        {
          id: "attempt-concurrent",
          organizationId,
          messageId: "message-concurrent",
          number: 1,
          dispatchedAt: new Date(),
          providerMessageHash,
        },
      ],
    });
    const service = new CommunicationsMessageService(state.prisma);

    await Promise.all([
      acknowledge(service, providerMessageId, "READ", 3),
      acknowledge(service, providerMessageId, "READ", 3),
    ]);

    expect(state.events).toHaveLength(1);
    expect(state.events[0]?.attemptId).toBe("attempt-concurrent");
    expect(state.messages[0]?.status).toBe("READ");
  });
});
