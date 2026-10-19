import { describe, expect, test } from "bun:test";
import type {
  PrismaClient,
  WhatsAppMessageStatus,
} from "../src/generated/prisma/client";
import { hashProviderMessageId } from "../src/modules/communications/messages-service";
import { WhatsAppQueueWorker } from "../src/modules/communications/worker";
import {
  WahaSendError,
  type WhatsAppProvider,
} from "../src/services/waha-client";

const organizationId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const patientId = "33333333-3333-4333-8333-333333333333";
const appointmentId = "44444444-4444-4444-8444-444444444444";

type ManualMessage = {
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

type ManualAttempt = {
  id: string;
  organizationId: string;
  messageId: string;
  number: number;
  origin: "MANUAL";
  startedAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  providerMessageHash: string | null;
  errorCode: string | null;
  errorReason: string | null;
};

type HarnessOptions = {
  leaseUntil?: Date | null;
  dispatchedAt?: Date | null;
  revokeOptInOnDispatchValidation?: boolean;
  appointmentOnDispatchValidation?: {
    version?: number;
    status?: "RESERVED" | "CONFIRMED" | "CANCELLED";
  };
  ambiguousAuthorizationCommit?: boolean;
  sendText?: () => Promise<string>;
};

function sameDate(left: unknown, right: unknown): boolean {
  return (
    left instanceof Date &&
    right instanceof Date &&
    left.getTime() === right.getTime()
  );
}

function matchesValue(current: unknown, expected: unknown): boolean {
  if (expected instanceof Date) return sameDate(current, expected);
  if (!expected || typeof expected !== "object") return current === expected;
  const condition = expected as { lt?: Date; not?: unknown; gt?: number };
  if (condition.lt)
    return (
      current instanceof Date && current.getTime() < condition.lt.getTime()
    );
  if (condition.gt !== undefined)
    return typeof current === "number" && current > condition.gt;
  if ("not" in condition)
    return condition.not === null
      ? current !== null
      : current !== condition.not;
  return true;
}

function createManualWorkerHarness(options: HarnessOptions = {}) {
  const state: {
    message: ManualMessage;
    attempt: ManualAttempt;
    preferenceReads: number;
    appointmentReads: number;
    attemptCreates: number;
    sendCalls: number;
    transactionCalls: number;
    manualAttemptScopes: string[];
  } = {
    message: {
      id: messageId,
      organizationId,
      patientId,
      appointmentId,
      templateVersionId: "template-version",
      eventId: `${appointmentId}:2`,
      type: "APPOINTMENT_CREATED",
      status: "QUEUED",
      scheduledFor: new Date(Date.now() - 60_000),
      sentAt: null,
      providerMessageHash: null,
      attemptCount: 3,
      nextAttemptAt: new Date(Date.now() - 60_000),
      leaseUntil: options.leaseUntil ?? null,
      uncertainAt: null,
      errorCode: null,
      errorReason: null,
    },
    attempt: {
      id: "manual-attempt",
      organizationId,
      messageId,
      number: 4,
      origin: "MANUAL",
      startedAt: new Date(Date.now() - 120_000),
      dispatchedAt: options.dispatchedAt ?? null,
      completedAt: null,
      providerMessageHash: null,
      errorCode: null,
      errorReason: null,
    },
    preferenceReads: 0,
    appointmentReads: 0,
    attemptCreates: 0,
    sendCalls: 0,
    transactionCalls: 0,
    manualAttemptScopes: [],
  };

  const appointment = {
    version: 2,
    status: "RESERVED" as const,
    scheduledAt: new Date(Date.now() + 86_400_000),
    patient: { phone: "11987654321", fullName: "Pessoa" },
    professional: { fullName: "Profissional" },
    organization: { name: "Clínica", timezone: "America/Sao_Paulo" },
  };

  function messageMatches(where: Record<string, unknown>): boolean {
    for (const field of [
      "id",
      "organizationId",
      "status",
      "leaseUntil",
      "uncertainAt",
      "providerMessageHash",
    ] as const) {
      if (field in where && !matchesValue(state.message[field], where[field]))
        return false;
    }
    return true;
  }

  function attemptMatches(where: Record<string, unknown>): boolean {
    for (const field of [
      "id",
      "organizationId",
      "messageId",
      "number",
      "origin",
      "dispatchedAt",
      "completedAt",
      "providerMessageHash",
    ] as const) {
      if (field in where && !matchesValue(state.attempt[field], where[field]))
        return false;
    }
    return true;
  }

  const messageDelegate = {
    findMany: async () =>
      state.message.status === "QUEUED" &&
      state.message.leaseUntil === null &&
      state.message.nextAttemptAt.getTime() <= Date.now()
        ? [{ ...state.message }]
        : [],
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      messageMatches(where) ? { ...state.message } : null,
    update: async ({ data }: { data: Partial<ManualMessage> }) => {
      Object.assign(state.message, data);
      return { ...state.message };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<ManualMessage>;
    }) => {
      if (where.AND) {
        const expired =
          state.message.status === "QUEUED" &&
          state.message.uncertainAt === null &&
          state.message.leaseUntil instanceof Date &&
          state.message.leaseUntil.getTime() <
            (where.leaseUntil as { lt: Date }).lt.getTime();
        const safelyRecoverable =
          state.attempt.completedAt === null &&
          state.attempt.dispatchedAt === null;
        if (!expired || !safelyRecoverable) return { count: 0 };
      } else if (!messageMatches(where)) return { count: 0 };
      Object.assign(state.message, data);
      return { count: 1 };
    },
  };

  const attemptDelegate = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      if (where.origin === "MANUAL") {
        state.manualAttemptScopes.push(String(where.organizationId));
        return attemptMatches(where) ? { ...state.attempt } : null;
      }
      const active =
        state.attempt.messageId === where.messageId &&
        (state.attempt.dispatchedAt !== null ||
          state.attempt.providerMessageHash !== null);
      return active ? { ...state.attempt } : null;
    },
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
      return state.attempt.organizationId === key.organizationId &&
        state.attempt.providerMessageHash === key.providerMessageHash
        ? { ...state.attempt }
        : null;
    },
    findMany: async () => [],
    create: async () => {
      state.attemptCreates += 1;
      return { id: "unexpected-automatic-attempt" };
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Partial<ManualAttempt>;
    }) => {
      if (!attemptMatches(where)) return { count: 0 };
      Object.assign(state.attempt, data);
      return { count: 1 };
    },
  };

  const prisma = {
    whatsAppMessage: messageDelegate,
    whatsAppMessageAttempt: attemptDelegate,
    whatsAppPreference: {
      findFirst: async () => {
        state.preferenceReads += 1;
        if (
          options.revokeOptInOnDispatchValidation &&
          state.preferenceReads >= 2
        )
          return null;
        return { id: "preference" };
      },
    },
    appointment: {
      findFirst: async () => {
        state.appointmentReads += 1;
        if (state.appointmentReads < 2)
          return {
            ...appointment,
            patient: { ...appointment.patient },
          };
        return {
          ...appointment,
          ...options.appointmentOnDispatchValidation,
          patient: { ...appointment.patient },
        };
      },
    },
    whatsAppSession: {
      findUnique: async () => ({ providerSessionName: "private" }),
    },
    whatsAppTemplateVersion: {
      findFirst: async () => ({
        id: "template-version",
        content: "Consulta de {paciente_nome} em {data} às {hora}.",
      }),
    },
    whatsAppWebhookEvent: {
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [],
    },
    $queryRaw: async () => [{ id: messageId }],
    $transaction: async (operation: (tx: unknown) => unknown) => {
      state.transactionCalls += 1;
      const result = await operation(prisma);
      if (options.ambiguousAuthorizationCommit && state.transactionCalls === 1)
        throw new Error("ambiguous transaction commit");
      return result;
    },
  } as unknown as PrismaClient;

  const provider: WhatsAppProvider = {
    getSession: async () => ({ status: "WORKING" }),
    createSession: async () => ({ status: "WORKING" }),
    restartSession: async () => {},
    getQr: async () => null,
    sendText: async () => {
      state.sendCalls += 1;
      expect(state.attempt.dispatchedAt).toBeInstanceOf(Date);
      return options.sendText
        ? options.sendText()
        : Promise.resolve("manual-provider-message");
    },
  };

  return { prisma, provider, state };
}

describe("WhatsApp manual resend worker", () => {
  test("consumes the reserved attempt once with the same identity and a committed dispatch fence", async () => {
    const { prisma, provider, state } = createManualWorkerHarness();
    const worker = new WhatsAppQueueWorker(prisma, provider);

    expect(await worker.processBatch()).toBe(1);
    expect(await worker.processBatch()).toBe(0);

    expect(state.sendCalls).toBe(1);
    expect(state.attemptCreates).toBe(0);
    expect(state.attempt).toMatchObject({
      id: "manual-attempt",
      organizationId,
      messageId,
      number: 4,
      origin: "MANUAL",
      providerMessageHash: hashProviderMessageId("manual-provider-message"),
    });
    expect(state.attempt.completedAt).toBeInstanceOf(Date);
    expect(state.message).toMatchObject({
      organizationId,
      id: messageId,
      attemptCount: 4,
      status: "SENT",
      leaseUntil: null,
    });
    expect(state.manualAttemptScopes).toEqual([organizationId, organizationId]);
  });

  test("allows only one of two concurrent workers to call WAHA", async () => {
    const { prisma, provider, state } = createManualWorkerHarness();
    const first = new WhatsAppQueueWorker(prisma, provider);
    const second = new WhatsAppQueueWorker(prisma, provider);

    const processed = await Promise.all([
      first.processBatch(),
      second.processBatch(),
    ]);

    expect(processed.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(state.sendCalls).toBe(1);
    expect(state.attemptCreates).toBe(0);
  });

  test("reclaims the same unfenced manual attempt after a pre-dispatch restart", async () => {
    const { prisma, provider, state } = createManualWorkerHarness({
      leaseUntil: new Date(Date.now() - 60_000),
    });

    expect(await new WhatsAppQueueWorker(prisma, provider).processBatch()).toBe(
      1,
    );
    expect(state.sendCalls).toBe(1);
    expect(state.attempt.id).toBe("manual-attempt");
    expect(state.attempt.number).toBe(4);
    expect(state.attemptCreates).toBe(0);
  });

  test("never calls WAHA again after a fenced dispatch survives a restart", async () => {
    const dispatchedAt = new Date(Date.now() - 120_000);
    const { prisma, provider, state } = createManualWorkerHarness({
      leaseUntil: new Date(Date.now() - 60_000),
      dispatchedAt,
    });

    expect(await new WhatsAppQueueWorker(prisma, provider).processBatch()).toBe(
      0,
    );
    expect(state.sendCalls).toBe(0);
    expect(state.message.status).toBe("UNCERTAIN");
    expect(state.message.errorCode).toBe("PROVIDER_OUTCOME_UNKNOWN");
    expect(state.attempt.dispatchedAt).toEqual(dispatchedAt);
    expect(state.attempt.completedAt).toBeNull();
  });

  test("does not call WAHA when the dispatch-fence commit result is ambiguous", async () => {
    const { prisma, provider, state } = createManualWorkerHarness({
      ambiguousAuthorizationCommit: true,
    });
    const worker = new WhatsAppQueueWorker(prisma, provider);

    await expect(worker.processBatch()).rejects.toThrow(
      "ambiguous transaction commit",
    );
    expect(state.sendCalls).toBe(0);
    expect(state.attempt.dispatchedAt).toBeInstanceOf(Date);

    state.message.leaseUntil = new Date(Date.now() - 60_000);
    expect(await worker.processBatch()).toBe(0);
    expect(state.sendCalls).toBe(0);
    expect(state.message.status).toBe("UNCERTAIN");
  });

  test("turns an ambiguous WAHA timeout into UNCERTAIN without retrying", async () => {
    const { prisma, provider, state } = createManualWorkerHarness({
      sendText: async () => {
        throw new WahaSendError("uncertain", "WAHA_TIMEOUT");
      },
    });
    const worker = new WhatsAppQueueWorker(prisma, provider);

    expect(await worker.processBatch()).toBe(1);
    expect(await worker.processBatch()).toBe(0);

    expect(state.sendCalls).toBe(1);
    expect(state.message.status).toBe("UNCERTAIN");
    expect(state.message.nextAttemptAt.getTime()).toBeLessThan(Date.now());
    expect(state.attempt.completedAt).toBeInstanceOf(Date);
    expect(state.attempt.errorCode).toBe("WAHA_TIMEOUT");
  });

  test("finalizes a definitive provider failure without an automatic attempt", async () => {
    const { prisma, provider, state } = createManualWorkerHarness({
      sendText: async () => {
        throw new WahaSendError("temporary", "SAFE_RETRYABLE_FAILURE");
      },
    });
    const worker = new WhatsAppQueueWorker(prisma, provider);

    expect(await worker.processBatch()).toBe(1);
    expect(await worker.processBatch()).toBe(0);

    expect(state.sendCalls).toBe(1);
    expect(state.attemptCreates).toBe(0);
    expect(state.attempt.completedAt).toBeInstanceOf(Date);
    expect(state.message.status).toBe("FAILED");
    expect(state.message.errorCode).toBe("SAFE_RETRYABLE_FAILURE");
  });

  test("blocks dispatch when opt-in is revoked after the initial worker check", async () => {
    const { prisma, provider, state } = createManualWorkerHarness({
      revokeOptInOnDispatchValidation: true,
    });

    await new WhatsAppQueueWorker(prisma, provider).processBatch();

    expect(state.preferenceReads).toBe(2);
    expect(state.sendCalls).toBe(0);
    expect(state.attempt.dispatchedAt).toBeNull();
    expect(state.attempt.completedAt).toBeInstanceOf(Date);
    expect(state.message.status).toBe("FAILED");
    expect(state.message.errorCode).toBe("NOT_ELIGIBLE");
  });

  test("blocks dispatch when the appointment is cancelled or its version changes", async () => {
    for (const appointmentOnDispatchValidation of [
      { status: "CANCELLED" as const },
      { version: 3 },
    ]) {
      const { prisma, provider, state } = createManualWorkerHarness({
        appointmentOnDispatchValidation,
      });

      await new WhatsAppQueueWorker(prisma, provider).processBatch();

      expect(state.appointmentReads).toBe(2);
      expect(state.sendCalls).toBe(0);
      expect(state.attempt.dispatchedAt).toBeNull();
      expect(state.attempt.completedAt).toBeInstanceOf(Date);
      expect(state.message.status).toBe("FAILED");
      expect(state.message.errorCode).toBe("NOT_ELIGIBLE");
    }
  });
});
