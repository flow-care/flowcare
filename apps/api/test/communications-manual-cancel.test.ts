import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { CommunicationsMessageService } from "../src/modules/communications/messages-service";
import {
  cancelQueuedAppointmentMessages,
  cancelQueuedPatientMessages,
} from "../src/modules/communications/queue";
import { WhatsAppQueueWorker } from "../src/modules/communications/worker";
import type { WhatsAppProvider } from "../src/services/waha-client";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "99999999-9999-4999-8999-999999999999";
const messageId = "22222222-2222-4222-8222-222222222222";
const patientId = "33333333-3333-4333-8333-333333333333";
const appointmentId = "44444444-4444-4444-8444-444444444444";
const idempotencyKey = "resend-key-1";

type Message = {
  id: string;
  organizationId: string;
  patientId: string;
  appointmentId: string;
  status: "QUEUED" | "FAILED";
  attemptCount: number;
  leaseUntil: Date | null;
  uncertainAt: Date | null;
  nextAttemptAt: Date;
  errorCode: string | null;
  errorReason: string | null;
};

type Attempt = {
  id: string;
  organizationId: string;
  messageId: string;
  number: number;
  origin: "MANUAL" | "AUTOMATIC";
  idempotencyKey: string | null;
  startedAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
  providerMessageHash: string | null;
  errorCode: string | null;
  errorReason: string | null;
};

type Options = {
  attempts?: Attempt[];
  message?: Partial<Message>;
  afterDueRead?: (prisma: PrismaClient) => Promise<void>;
};

function manualAttempt(overrides: Partial<Attempt> = {}): Attempt {
  return {
    id: "manual-attempt",
    organizationId,
    messageId,
    number: 4,
    origin: "MANUAL",
    idempotencyKey,
    startedAt: new Date(Date.now() - 120_000),
    dispatchedAt: null,
    completedAt: null,
    providerMessageHash: null,
    errorCode: null,
    errorReason: null,
    ...overrides,
  };
}

function inFilter(value: unknown, actual: unknown): boolean {
  if (value && typeof value === "object" && "in" in value)
    return (value as { in: unknown[] }).in.includes(actual);
  if (value instanceof Date)
    return actual instanceof Date && actual.getTime() === value.getTime();
  return value === actual;
}

function createFake(options: Options = {}) {
  const state = {
    message: {
      id: messageId,
      organizationId,
      patientId,
      appointmentId,
      status: "QUEUED",
      attemptCount: 3,
      leaseUntil: null,
      uncertainAt: null,
      nextAttemptAt: new Date(Date.now() - 60_000),
      errorCode: null,
      errorReason: null,
      ...options.message,
    } as Message,
    attempts: options.attempts ?? [manualAttempt()],
    sendCalls: 0,
    attemptCreates: 0,
    optedIn: true,
  };
  let dueReads = 0;

  const messageMatches = (where: Record<string, unknown>) =>
    (["id", "organizationId", "status", "leaseUntil"] as const).every(
      (field) =>
        !(field in where) || inFilter(where[field], state.message[field]),
    );
  const attemptMatches = (attempt: Attempt, where: Record<string, unknown>) =>
    (
      [
        "id",
        "organizationId",
        "messageId",
        "number",
        "origin",
        "dispatchedAt",
        "completedAt",
        "providerMessageHash",
        "idempotencyKey",
      ] as const
    ).every(
      (field) =>
        !(field in where) || inFilter(where[field], attempt[field] ?? null),
    );

  const prisma: PrismaClient = {
    whatsAppMessage: {
      findMany: async () => {
        const due =
          state.message.status === "QUEUED" &&
          state.message.leaseUntil === null &&
          state.message.nextAttemptAt.getTime() <= Date.now()
            ? [{ ...state.message }]
            : [];
        if (dueReads++ === 0 && options.afterDueRead)
          await options.afterDueRead(prisma);
        return due;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        messageMatches(where) ? { ...state.message } : null,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Message>;
      }) => {
        if (where.AND || (where.leaseUntil as { lt?: Date } | null)?.lt)
          return { count: 0 };
        if (!messageMatches(where)) return { count: 0 };
        Object.assign(state.message, data);
        return { count: 1 };
      },
    },
    whatsAppMessageAttempt: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        state.attempts
          .filter((attempt) => attemptMatches(attempt, where))
          .sort((left, right) => left.number - right.number)
          .map((attempt) => ({ ...attempt })),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const found = state.attempts.find((attempt) =>
          attemptMatches(attempt, where),
        );
        return found ? { ...found } : null;
      },
      create: async () => {
        state.attemptCreates += 1;
        return { id: "unexpected-attempt" };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Attempt>;
      }) => {
        const found = state.attempts.find((attempt) =>
          attemptMatches(attempt, where),
        );
        if (!found) return { count: 0 };
        Object.assign(found, data);
        return { count: 1 };
      },
    },
    whatsAppPreference: {
      upsert: async ({ update }: { update: { optedIn: boolean } }) => {
        state.optedIn = update.optedIn;
        return {};
      },
      findFirst: async () => (state.optedIn ? { id: "preference" } : null),
    },
    patient: { findFirst: async () => ({ id: patientId }) },
    appointment: {
      findFirst: async () => ({
        version: 2,
        status: "RESERVED",
        scheduledAt: new Date(Date.now() + 86_400_000),
        patient: { phone: "11987654321", fullName: "Pessoa" },
        professional: { fullName: "Profissional" },
        organization: { name: "Clínica", timezone: "America/Sao_Paulo" },
      }),
    },
    whatsAppSession: { findUnique: async () => ({ providerSessionName: "s" }) },
    whatsAppTemplateVersion: {
      findFirst: async () => ({ id: "t", content: "Olá {paciente_nome}" }),
    },
    auditLog: { create: async () => ({}) },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      if (!sql.includes('FROM "WhatsAppMessage"')) return [];
      const byPatient = sql.includes('"patientId" =');
      const [org, scope] = values;
      const message = state.message;
      const matches =
        message.organizationId === org &&
        (byPatient ? message.patientId : message.appointmentId) === scope &&
        message.status === "QUEUED" &&
        message.leaseUntil === null;
      return matches
        ? [{ id: message.id, attemptCount: message.attemptCount }]
        : [];
    },
    $transaction: async (operation: (tx: unknown) => unknown) =>
      operation(prisma),
  } as unknown as PrismaClient;

  const provider: WhatsAppProvider = {
    getSession: async () => ({ status: "WORKING" }),
    createSession: async () => ({ status: "WORKING" }),
    restartSession: async () => {},
    getQr: async () => null,
    sendText: async () => {
      state.sendCalls += 1;
      return "provider-message";
    },
  };

  return { prisma, provider, state };
}

function expectCancelledBeforeDispatch(
  state: ReturnType<typeof createFake>["state"],
  failureCode: string,
) {
  const attempt = state.attempts[0];
  expect(attempt?.completedAt).toBeInstanceOf(Date);
  expect(attempt?.errorCode).toBe("MANUAL_RESEND_CANCELLED");
  expect(attempt?.dispatchedAt).toBeNull();
  expect(attempt?.providerMessageHash).toBeNull();
  expect(attempt?.idempotencyKey).toBe(idempotencyKey);
  expect(attempt?.number).toBe(4);
  expect(state.message).toMatchObject({
    status: "FAILED",
    attemptCount: 4,
    leaseUntil: null,
    errorCode: failureCode,
  });
}

describe("reserved manual attempts closed before the worker claim", () => {
  test("opt-out closes the reserved attempt without dispatch data", async () => {
    const { prisma, state } = createFake();

    await new CommunicationsMessageService(prisma).preference(
      organizationId,
      patientId,
      "actor",
      { whatsappOptIn: false, source: "PATIENT_REQUEST" },
    );

    expectCancelledBeforeDispatch(state, "OPTED_OUT");
  });

  test("appointment cancellation or change closes the reserved attempt", async () => {
    const { prisma, state } = createFake();

    await cancelQueuedAppointmentMessages(
      prisma,
      organizationId,
      appointmentId,
    );

    expectCancelledBeforeDispatch(state, "APPOINTMENT_CHANGED");
  });

  test("replaying the original Idempotency-Key does not create another attempt", async () => {
    const { prisma, state } = createFake();
    await cancelQueuedPatientMessages(prisma, organizationId, patientId);
    const before = structuredClone(state.attempts);

    const replay = await new CommunicationsMessageService(
      prisma,
    ).authorizeManualResend(organizationId, messageId, "actor", idempotencyKey);

    expect(replay).toEqual({ status: "QUEUED" });
    expect(state.attemptCreates).toBe(0);
    expect(state.attempts).toEqual(before);
    expect(state.message.status).toBe("FAILED");
  });

  test("a worker with a stale due read never dispatches the cancelled attempt", async () => {
    const { prisma, provider, state } = createFake({
      afterDueRead: (client) =>
        cancelQueuedPatientMessages(client, organizationId, patientId),
    });

    expect(await new WhatsAppQueueWorker(prisma, provider).processBatch()).toBe(
      0,
    );

    expect(state.sendCalls).toBe(0);
    expectCancelledBeforeDispatch(state, "OPTED_OUT");
  });

  test("the worker does not send after the cancellation committed", async () => {
    const { prisma, provider, state } = createFake();
    await cancelQueuedAppointmentMessages(
      prisma,
      organizationId,
      appointmentId,
    );

    expect(await new WhatsAppQueueWorker(prisma, provider).processBatch()).toBe(
      0,
    );
    expect(state.sendCalls).toBe(0);
  });

  test("never touches an attempt that was fenced or hashed", async () => {
    for (const fence of [
      { dispatchedAt: new Date(Date.now() - 1_000) },
      { providerMessageHash: "hash" },
    ]) {
      const { prisma, state } = createFake({
        attempts: [manualAttempt(fence)],
      });

      await cancelQueuedPatientMessages(prisma, organizationId, patientId);

      expect(state.attempts[0]?.completedAt).toBeNull();
      expect(state.attempts[0]?.errorCode).toBeNull();
      expect(state.message.status).toBe("QUEUED");
      expect(state.message.attemptCount).toBe(3);
    }
  });

  test("does not cross organizations", async () => {
    const { prisma, state } = createFake();

    await cancelQueuedPatientMessages(prisma, otherOrganizationId, patientId);

    expect(state.attempts[0]?.completedAt).toBeNull();
    expect(state.message.status).toBe("QUEUED");
  });

  test("a message already leased by a worker is left to the worker protocol", async () => {
    const { prisma, state } = createFake({
      message: { leaseUntil: new Date(Date.now() + 60_000) },
    });

    await cancelQueuedPatientMessages(prisma, organizationId, patientId);

    expect(state.attempts[0]?.completedAt).toBeNull();
    expect(state.message.status).toBe("QUEUED");
  });

  test("automatic messages keep the #296 behavior and attempt count", async () => {
    const automatic = [1, 2, 3].map((number) =>
      manualAttempt({
        id: `automatic-${number}`,
        number,
        origin: "AUTOMATIC",
        idempotencyKey: null,
        completedAt: new Date(),
        errorCode: "TEMPORARY",
      }),
    );
    const { prisma, state } = createFake({ attempts: automatic });
    const before = structuredClone(state.attempts);

    await cancelQueuedPatientMessages(prisma, organizationId, patientId);

    expect(state.attempts).toEqual(before);
    expect(state.message).toMatchObject({
      status: "FAILED",
      attemptCount: 3,
      errorCode: "OPTED_OUT",
    });
  });
});
