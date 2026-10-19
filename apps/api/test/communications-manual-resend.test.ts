import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { PrismaClient } from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { communicationsModule } from "../src/modules/communications";
import { resolveWhatsAppDeliveryEligibility } from "../src/modules/communications/delivery-eligibility";
import { CommunicationsMessageService } from "../src/modules/communications/messages-service";
import { signSessionToken } from "../src/services/session-token";
import type { WhatsAppProvider } from "../src/services/waha-client";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "99999999-9999-4999-8999-999999999999";
const messageId = "22222222-2222-4222-8222-222222222222";
const patientId = "33333333-3333-4333-8333-333333333333";
const appointmentId = "44444444-4444-4444-8444-444444444444";
const actorUserId = "55555555-5555-4555-8555-555555555555";

type MessageStatus =
  | "QUEUED"
  | "UNCERTAIN"
  | "SENT"
  | "DELIVERED"
  | "READ"
  | "FAILED";

type MessageType =
  | "APPOINTMENT_CREATED"
  | "APPOINTMENT_CANCELLED"
  | "APPOINTMENT_REMINDER";

type FakeAttempt = {
  id: string;
  organizationId: string | null;
  messageId: string;
  number: number;
  origin: "AUTOMATIC" | "MANUAL";
  idempotencyKey: string | null;
  requestedById: string | null;
  startedAt: Date;
};

type AttemptCreateFailure = {
  error: unknown;
  persistedAttempt?: FakeAttempt;
};

type FakeState = {
  membershipRole: "RECEPTIONIST" | "PROFESSIONAL";
  message: {
    id: string;
    organizationId: string;
    patientId: string;
    appointmentId: string;
    eventId: string;
    type: MessageType;
    status: MessageStatus;
    attemptCount: number;
    leaseUntil: Date | null;
    nextAttemptAt: Date;
    uncertainAt: Date | null;
  };
  optedIn: boolean;
  appointmentMatches: boolean;
  appointment: {
    version: number;
    status: "RESERVED" | "CONFIRMED" | "CANCELLED";
    scheduledAt: Date;
    patient: { phone: string };
  };
  attempts: FakeAttempt[];
  attemptCreateFailure: AttemptCreateFailure | null;
  audits: Array<Record<string, unknown>>;
  failAudit: boolean;
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

function createFakePrisma(overrides: Partial<FakeState> = {}): {
  prisma: PrismaClient;
  state: FakeState;
} {
  const state: FakeState = {
    membershipRole: "RECEPTIONIST",
    message: {
      id: messageId,
      organizationId,
      patientId,
      appointmentId,
      eventId: `${appointmentId}:2`,
      type: "APPOINTMENT_CREATED",
      status: "FAILED",
      attemptCount: 3,
      leaseUntil: null,
      nextAttemptAt: new Date("2026-10-18T10:00:00.000Z"),
      uncertainAt: null,
    },
    optedIn: true,
    appointmentMatches: true,
    appointment: {
      version: 2,
      status: "RESERVED",
      scheduledAt: new Date(Date.now() + 86_400_000),
      patient: { phone: "11987654321" },
    },
    attempts: [],
    attemptCreateFailure: null,
    audits: [],
    failAudit: false,
    ...overrides,
  };
  const locks = new TransactionLocks();
  let nextAttemptId = 1;

  const attemptDelegate = {
    findFirst: async ({
      where,
      orderBy,
    }: {
      where: {
        organizationId?: string;
        idempotencyKey?: string;
        messageId?: string;
      };
      orderBy?: { number: "desc" };
    }) => {
      if (where.idempotencyKey !== undefined)
        return (
          state.attempts.find(
            (attempt) =>
              attempt.organizationId === where.organizationId &&
              attempt.idempotencyKey === where.idempotencyKey,
          ) ?? null
        );
      const matching = state.attempts.filter(
        (attempt) => attempt.messageId === where.messageId,
      );
      if (orderBy?.number === "desc")
        matching.sort((left, right) => right.number - left.number);
      return matching[0] ?? null;
    },
  };
  const preferenceDelegate = {
    findFirst: async () => (state.optedIn ? { id: "preference" } : null),
  };
  const appointmentDelegate = {
    findFirst: async () =>
      state.appointmentMatches ? state.appointment : null,
  };

  const prisma = {
    session: {
      findFirst: async () => ({ id: "session", lastActiveAt: new Date() }),
    },
    membership: {
      findFirst: async () => ({
        id: "membership",
        organizationId,
        role: state.membershipRole,
        status: "ACTIVE",
      }),
    },
    whatsAppMessageAttempt: attemptDelegate,
    whatsAppPreference: preferenceDelegate,
    appointment: appointmentDelegate,
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      const releases: Array<() => void> = [];
      const createdAttemptIds = new Set<string>();
      const createdAudits = new Set<Record<string, unknown>>();
      let messageBeforeUpdate: FakeState["message"] | null = null;

      const tx = {
        $queryRaw: async (
          strings: TemplateStringsArray,
          ...values: unknown[]
        ) => {
          const sql = strings.join("?");
          if (sql.includes("pg_advisory_xact_lock")) {
            releases.push(
              await locks.acquire(
                `key:${String(values[0])}:${String(values[1])}`,
              ),
            );
            return [{ lockEvaluated: true }];
          }
          if (sql.includes("FOR SHARE OF preference"))
            return [{ id: "preference" }];
          if (sql.includes('FROM "WhatsAppMessage"')) {
            const scopedOrganizationId = String(values[0]);
            const scopedMessageId = String(values[1]);
            releases.push(
              await locks.acquire(
                `message:${scopedOrganizationId}:${scopedMessageId}`,
              ),
            );
            return state.message.organizationId === scopedOrganizationId &&
              state.message.id === scopedMessageId
              ? [{ id: scopedMessageId }]
              : [];
          }
          throw new Error(`Unexpected SQL in fake transaction: ${sql}`);
        },
        whatsAppMessageAttempt: {
          ...attemptDelegate,
          create: async ({ data }: { data: Omit<FakeAttempt, "id"> }) => {
            if (state.attemptCreateFailure) {
              const { error, persistedAttempt } = state.attemptCreateFailure;
              state.attemptCreateFailure = null;
              if (persistedAttempt) state.attempts.push(persistedAttempt);
              throw error;
            }
            const duplicateKey = state.attempts.some(
              (attempt) =>
                attempt.organizationId === data.organizationId &&
                attempt.idempotencyKey !== null &&
                attempt.idempotencyKey === data.idempotencyKey,
            );
            const duplicateNumber = state.attempts.some(
              (attempt) =>
                attempt.messageId === data.messageId &&
                attempt.number === data.number,
            );
            if (duplicateKey)
              throw {
                code: "P2002",
                meta: {
                  target: ["organizationId", "idempotencyKey"],
                },
              };
            if (duplicateNumber)
              throw {
                code: "P2002",
                meta: { target: ["messageId", "number"] },
              };
            const attempt = {
              ...data,
              id: `manual-attempt-${nextAttemptId++}`,
            };
            state.attempts.push(attempt);
            createdAttemptIds.add(attempt.id);
            return attempt;
          },
        },
        whatsAppMessage: {
          findFirst: async ({
            where,
          }: {
            where: { id: string; organizationId: string };
          }) =>
            state.message.id === where.id &&
            state.message.organizationId === where.organizationId
              ? { ...state.message }
              : null,
          updateMany: async ({
            where,
            data,
          }: {
            where: {
              id: string;
              organizationId: string;
              status: MessageStatus;
              leaseUntil: null;
            };
            data: Partial<FakeState["message"]>;
          }) => {
            if (
              state.message.id !== where.id ||
              state.message.organizationId !== where.organizationId ||
              state.message.status !== where.status ||
              state.message.leaseUntil !== where.leaseUntil
            )
              return { count: 0 };
            messageBeforeUpdate ??= { ...state.message };
            Object.assign(state.message, data);
            return { count: 1 };
          },
        },
        whatsAppPreference: preferenceDelegate,
        appointment: appointmentDelegate,
        auditLog: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            if (state.failAudit) throw new Error("audit unavailable");
            state.audits.push(data);
            createdAudits.add(data);
            return {
              ...data,
              id: `audit-${state.audits.length}`,
              createdAt: new Date(),
            };
          },
        },
      };

      try {
        return await operation(tx);
      } catch (error) {
        state.attempts = state.attempts.filter(
          (attempt) => !createdAttemptIds.has(attempt.id),
        );
        state.audits = state.audits.filter(
          (audit) => !createdAudits.has(audit),
        );
        if (messageBeforeUpdate) state.message = messageBeforeUpdate;
        throw error;
      } finally {
        for (const release of releases.reverse()) release();
      }
    },
  } as unknown as PrismaClient;

  return { prisma, state };
}

describe("WhatsApp manual resend authorization", () => {
  test("uses the shared eligibility resolver with the current appointment and normalized destination", async () => {
    const { prisma, state } = createFakePrisma();

    const eligibility = await resolveWhatsAppDeliveryEligibility(
      prisma,
      state.message,
      new Date("2026-10-18T10:00:00.000Z"),
    );

    expect(eligibility?.appointment.version).toBe(state.appointment.version);
    expect(eligibility?.appointment.status).toBe(state.appointment.status);
    expect(eligibility?.appointment.scheduledAt).toBe(
      state.appointment.scheduledAt,
    );
    expect(eligibility?.destination).toEqual({
      e164: "+5511987654321",
      chatId: "5511987654321@c.us",
    });
  });

  test("reserves a monotonic manual attempt, queues with CAS and audits without sensitive data", async () => {
    const previousAttempt: FakeAttempt = {
      id: "automatic-attempt-4",
      organizationId,
      messageId,
      number: 4,
      origin: "AUTOMATIC",
      idempotencyKey: null,
      requestedById: null,
      startedAt: new Date("2026-10-18T09:00:00.000Z"),
    };
    const { prisma, state } = createFakePrisma({ attempts: [previousAttempt] });

    const result = await new CommunicationsMessageService(
      prisma,
    ).authorizeManualResend(
      organizationId,
      messageId,
      actorUserId,
      "  resend-key-1  ",
    );

    expect(result).toEqual({ status: "QUEUED" });
    expect(state.message.status).toBe("QUEUED");
    expect(state.message.attemptCount).toBe(3);
    expect(state.attempts).toHaveLength(2);
    expect(state.attempts[1]).toMatchObject({
      organizationId,
      messageId,
      number: 5,
      origin: "MANUAL",
      idempotencyKey: "resend-key-1",
      requestedById: actorUserId,
    });
    expect(state.attempts[1]?.startedAt).toBeInstanceOf(Date);
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]).toMatchObject({
      organizationId,
      actorUserId,
      action: "WHATSAPP_MESSAGE_RESEND_AUTHORIZED",
      targetType: "WHATSAPP_MESSAGE",
      targetId: messageId,
      metadata: {
        attemptId: "manual-attempt-1",
        attemptNumber: 5,
        operation: "MANUAL_RESEND",
      },
    });
    expect(JSON.stringify(state.audits[0])).not.toContain("resend-key-1");
    expect(JSON.stringify(state.audits[0])).not.toContain("11987654321");
  });

  test("returns the original response on replay without checking the current message state", async () => {
    const { prisma, state } = createFakePrisma();
    const service = new CommunicationsMessageService(prisma);

    await service.authorizeManualResend(
      organizationId,
      messageId,
      actorUserId,
      "same-key",
    );
    state.message.status = "READ";

    expect(
      await service.authorizeManualResend(
        organizationId,
        messageId,
        actorUserId,
        "same-key",
      ),
    ).toEqual({ status: "QUEUED" });
    expect(state.attempts).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
  });

  test("recovers only a proven idempotency-key collision as a replay", async () => {
    const winningAttempt: FakeAttempt = {
      id: "concurrent-manual-attempt",
      organizationId,
      messageId,
      number: 4,
      origin: "MANUAL",
      idempotencyKey: "p2002-key",
      requestedById: actorUserId,
      startedAt: new Date(),
    };
    const { prisma, state } = createFakePrisma({
      attemptCreateFailure: {
        error: {
          code: "P2002",
          meta: { target: ["organizationId", "idempotencyKey"] },
        },
        persistedAttempt: winningAttempt,
      },
    });

    expect(
      await new CommunicationsMessageService(prisma).authorizeManualResend(
        organizationId,
        messageId,
        actorUserId,
        "p2002-key",
      ),
    ).toEqual({ status: "QUEUED" });
    expect(state.attempts).toEqual([winningAttempt]);
    expect(state.audits).toHaveLength(0);
  });

  test("does not convert an attempt-number collision into an idempotency response", async () => {
    const collision = {
      code: "P2002",
      meta: { target: ["messageId", "number"] },
    };
    const { prisma, state } = createFakePrisma({
      attemptCreateFailure: { error: collision },
    });

    let caught: unknown;
    try {
      await new CommunicationsMessageService(prisma).authorizeManualResend(
        organizationId,
        messageId,
        actorUserId,
        "number-collision",
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(collision);
    expect(state.message.status).toBe("FAILED");
    expect(state.attempts).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  test("does not convert an unknown unique violation into an idempotency response", async () => {
    const unexpectedUniqueViolation = {
      code: "P2002",
      meta: { target: ["organizationId", "providerMessageHash"] },
    };
    const { prisma, state } = createFakePrisma({
      attemptCreateFailure: { error: unexpectedUniqueViolation },
    });

    let caught: unknown;
    try {
      await new CommunicationsMessageService(prisma).authorizeManualResend(
        organizationId,
        messageId,
        actorUserId,
        "unexpected-unique",
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBe(unexpectedUniqueViolation);
    expect(state.message.status).toBe("FAILED");
    expect(state.attempts).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  test("rejects reuse of an organization key for another message", async () => {
    const { prisma } = createFakePrisma();
    const service = new CommunicationsMessageService(prisma);
    await service.authorizeManualResend(
      organizationId,
      messageId,
      actorUserId,
      "conflicting-key",
    );

    await expect(
      service.authorizeManualResend(
        organizationId,
        "66666666-6666-4666-8666-666666666666",
        actorUserId,
        "conflicting-key",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", httpStatus: 409 });
  });

  test("isolates message lookup and idempotency keys by organization", async () => {
    const { prisma, state } = createFakePrisma();
    await expect(
      new CommunicationsMessageService(prisma).authorizeManualResend(
        otherOrganizationId,
        messageId,
        actorUserId,
        "tenant-key",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
    expect(state.attempts).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  test("rejects non-failed states and every residual legacy lease", async () => {
    for (const status of [
      "QUEUED",
      "UNCERTAIN",
      "SENT",
      "DELIVERED",
      "READ",
    ] as const) {
      const { prisma } = createFakePrisma({
        message: {
          ...createFakePrisma().state.message,
          status,
        },
      });
      await expect(
        new CommunicationsMessageService(prisma).authorizeManualResend(
          organizationId,
          messageId,
          actorUserId,
          `state-${status}`,
        ),
      ).rejects.toMatchObject({
        code: "MESSAGE_STATE_CONFLICT",
        httpStatus: 409,
      });
    }

    for (const [label, leaseUntil] of [
      ["active", new Date(Date.now() + 60_000)],
      ["expired", new Date(Date.now() - 60_000)],
    ] as const) {
      const base = createFakePrisma().state.message;
      const { prisma } = createFakePrisma({
        message: { ...base, leaseUntil },
      });
      await expect(
        new CommunicationsMessageService(prisma).authorizeManualResend(
          organizationId,
          messageId,
          actorUserId,
          `${label}-lease`,
        ),
      ).rejects.toMatchObject({
        code: "MESSAGE_STATE_CONFLICT",
        httpStatus: 409,
      });
    }
  });

  test("revalidates opt-in, phone, appointment association, version, state and reminder time", async () => {
    const cases: Array<Partial<FakeState>> = [
      { optedIn: false },
      {
        appointment: {
          ...createFakePrisma().state.appointment,
          patient: { phone: "invalid" },
        },
      },
      { appointmentMatches: false },
      {
        appointment: {
          ...createFakePrisma().state.appointment,
          version: 3,
        },
      },
      {
        appointment: {
          ...createFakePrisma().state.appointment,
          status: "CANCELLED",
        },
      },
      {
        message: {
          ...createFakePrisma().state.message,
          type: "APPOINTMENT_REMINDER",
        },
        appointment: {
          ...createFakePrisma().state.appointment,
          scheduledAt: new Date(Date.now() - 60_000),
        },
      },
    ];

    for (const [index, overrides] of cases.entries()) {
      const { prisma, state } = createFakePrisma(overrides);
      await expect(
        new CommunicationsMessageService(prisma).authorizeManualResend(
          organizationId,
          messageId,
          actorUserId,
          `eligibility-${index}`,
        ),
      ).rejects.toMatchObject({
        code: "MESSAGE_STATE_CONFLICT",
        httpStatus: 409,
      });
      expect(state.attempts).toHaveLength(0);
      expect(state.audits).toHaveLength(0);
    }
  });

  test("serializes simultaneous requests with the same key into one attempt and audit", async () => {
    const { prisma, state } = createFakePrisma();
    const service = new CommunicationsMessageService(prisma);

    const results = await Promise.all([
      service.authorizeManualResend(
        organizationId,
        messageId,
        actorUserId,
        "concurrent-key",
      ),
      service.authorizeManualResend(
        organizationId,
        messageId,
        actorUserId,
        "concurrent-key",
      ),
    ]);

    expect(results).toEqual([{ status: "QUEUED" }, { status: "QUEUED" }]);
    expect(state.attempts).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
  });

  test("allows only one of two simultaneous keys for the same message", async () => {
    const { prisma, state } = createFakePrisma();
    const service = new CommunicationsMessageService(prisma);

    const results = await Promise.allSettled([
      service.authorizeManualResend(
        organizationId,
        messageId,
        actorUserId,
        "concurrent-key-a",
      ),
      service.authorizeManualResend(
        organizationId,
        messageId,
        actorUserId,
        "concurrent-key-b",
      ),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "MESSAGE_STATE_CONFLICT", httpStatus: 409 },
    });
    expect(state.attempts).toHaveLength(1);
    expect(state.audits).toHaveLength(1);
  });

  test("rolls back the reservation and queue transition when audit persistence fails", async () => {
    const { prisma, state } = createFakePrisma({ failAudit: true });

    await expect(
      new CommunicationsMessageService(prisma).authorizeManualResend(
        organizationId,
        messageId,
        actorUserId,
        "audit-failure",
      ),
    ).rejects.toThrow("audit unavailable");
    expect(state.message.status).toBe("FAILED");
    expect(state.attempts).toHaveLength(0);
    expect(state.audits).toHaveLength(0);
  });

  test("exposes the resend through an authenticated, authorized and idempotent HTTP route", async () => {
    const { prisma, state } = createFakePrisma();
    const provider = {
      getSession: async () => null,
      createSession: async () => ({ status: "WORKING" as const }),
      restartSession: async () => {},
      getQr: async () => null,
    } satisfies WhatsAppProvider;
    const app = new Elysia()
      .onError(({ code, error, status }) => {
        if (error instanceof ApiError)
          return status(error.httpStatus, { error: { code: error.code } });
        if (code === "VALIDATION")
          return status(400, { error: { code: "VALIDATION_ERROR" } });
        return status(500, { error: { code: "INTERNAL" } });
      })
      .use(communicationsModule({ prisma, jwtSecret: "jwt-secret", provider }));
    const token = signSessionToken(
      { sid: "session", sub: actorUserId },
      "jwt-secret",
      60,
    );
    const url = `http://localhost/organizations/own/communications/messages/${messageId}/resend`;

    const missingKey = await app.handle(
      new Request(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(missingKey.status).toBe(400);
    expect(state.attempts).toHaveLength(0);

    state.membershipRole = "PROFESSIONAL";
    const forbidden = await app.handle(
      new Request(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": "forbidden-route-key",
        },
      }),
    );
    expect(forbidden.status).toBe(403);
    expect(state.attempts).toHaveLength(0);

    state.membershipRole = "RECEPTIONIST";
    const response = await app.handle(
      new Request(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": "  route-resend-key  ",
        },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ status: "QUEUED" });
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({
      organizationId,
      messageId,
      requestedById: actorUserId,
      idempotencyKey: "route-resend-key",
    });
  });
});
