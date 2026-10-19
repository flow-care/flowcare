import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Elysia } from "elysia";
import type {
  PrismaClient,
  WhatsAppMessageStatus,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import {
  communicationsModule,
  whatsappWebhookModule,
} from "../src/modules/communications";
import {
  CommunicationsMessageService,
  hashProviderMessageId,
  hashWebhookEvent,
  maskPatientPhone,
  verifyWahaWebhook,
} from "../src/modules/communications/messages-service";
import { enqueueAppointmentEvent } from "../src/modules/communications/queue";
import { WhatsAppQueueWorker } from "../src/modules/communications/worker";
import { signSessionToken } from "../src/services/session-token";
import {
  WahaSendError,
  type WhatsAppProvider,
} from "../src/services/waha-client";

const org = "11111111-1111-4111-8111-111111111111";
const patient = "22222222-2222-4222-8222-222222222222";
const secret = "test-webhook-secret";
const provider: WhatsAppProvider = {
  getSession: async () => null,
  createSession: async () => ({ status: "WORKING" }),
  restartSession: async () => {},
  getQr: async () => null,
};

const queuedMessage = () => ({
  id: "msg",
  organizationId: org,
  patientId: patient,
  appointmentId: "apt",
  templateVersionId: null,
  eventId: "apt:0",
  type: "APPOINTMENT_CREATED" as const,
  status: "QUEUED" as const,
  attemptCount: 0,
});

const eligibleAppointment = (phone = "11987654321") => ({
  version: 0,
  status: "RESERVED",
  scheduledAt: new Date("2026-10-14T12:00:00Z"),
  patient: { phone, fullName: "Pessoa" },
  professional: { fullName: "Profissional" },
  organization: { name: "Clínica", timezone: "America/Sao_Paulo" },
});

const noCorrelatedAttempts = () => ({
  findUnique: async () => null,
  findMany: async () => [],
  findFirst: async () => null,
});

describe("WhatsApp messages", () => {
  test("masks local and international numbers", () => {
    expect(maskPatientPhone("(11) 98765-4321")).toBe("(11) 98765-****");
    expect(maskPatientPhone("+55 11 98765-4321")).toBe("(11) 98765-****");
    expect(maskPatientPhone("bad")).toBe("****");
    expect(
      hashProviderMessageId("true_5511987654321@c.us_random"),
    ).not.toContain("5511987654321");
  });

  test("outbox enqueues only an opted-in patient and a valid phone", async () => {
    const created: unknown[] = [];
    let optedIn = false;
    let phone = "11987654321";
    const tx = {
      whatsAppPreference: {
        findFirst: async () => (optedIn ? { id: "pref" } : null),
      },
      patient: { findFirst: async () => ({ phone }) },
      whatsAppMessage: {
        create: async ({ data }: { data: unknown }) => {
          created.push(data);
        },
      },
    } as never;
    const event = {
      id: "appointment",
      organizationId: org,
      patientId: patient,
      scheduledAt: new Date(Date.now() + 172_800_000),
      version: 0,
      type: "APPOINTMENT_CREATED" as const,
    };
    await enqueueAppointmentEvent(tx, event);
    expect(created).toHaveLength(0);
    optedIn = true;
    phone = "invalid";
    await enqueueAppointmentEvent(tx, event);
    expect(created).toHaveLength(0);
    phone = "11987654321";
    await enqueueAppointmentEvent(tx, event);
    expect(created).toHaveLength(1);
  });

  test("opt-out is audited and cancels queued messages", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const audits: Array<Record<string, unknown>> = [];
    const prisma = {
      patient: { findFirst: async () => ({ id: patient }) },
      whatsAppPreference: { upsert: async () => ({}) },
      whatsAppMessage: {
        updateMany: async ({ where }: { where: Record<string, unknown> }) => {
          updates.push(where);
          return { count: 1 };
        },
      },
      whatsAppMessageAttempt: { findMany: async () => [] },
      $queryRaw: async () => [{ id: "message", attemptCount: 0 }],
      auditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          audits.push(data);
        },
      },
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    } as unknown as PrismaClient;
    const result = await new CommunicationsMessageService(prisma).preference(
      org,
      patient,
      "actor",
      { whatsappOptIn: false, source: "PATIENT_REQUEST" },
    );
    expect(result.whatsappOptIn).toBe(false);
    expect(updates[0]?.organizationId).toBe(org);
    expect(updates[0]?.patientId).toBe(patient);
    expect(audits[0]?.action).toBe("WHATSAPP_PREFERENCE_UPDATED");
  });

  test("rejects a whitespace-only preference source before persistence", async () => {
    let reads = 0;
    const prisma = {
      patient: {
        findFirst: async () => {
          reads += 1;
          return { id: patient };
        },
      },
    } as unknown as PrismaClient;

    await expect(
      new CommunicationsMessageService(prisma).preference(
        org,
        patient,
        "actor",
        { whatsappOptIn: true, source: "   \t  " },
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", httpStatus: 400 });
    expect(reads).toBe(0);
  });

  test("history is filtered by clinic, status, dates and patient, with no full phone", async () => {
    let where: Record<string, unknown> = {};
    let orderBy: unknown;
    const prisma = {
      whatsAppMessage: {
        findMany: async ({
          where: value,
          orderBy: ordering,
        }: {
          where: Record<string, unknown>;
          orderBy: unknown;
        }) => {
          where = value;
          orderBy = ordering;
          return [
            {
              id: "msg",
              type: "APPOINTMENT_CREATED",
              status: "SENT",
              patientId: patient,
              appointmentId: "apt",
              createdAt: new Date("2026-10-13T12:00:00Z"),
              sentAt: new Date("2026-10-13T12:01:00Z"),
              errorCode: null,
              errorReason: null,
              patient: { phone: "11987654321" },
            },
          ];
        },
      },
    } as unknown as PrismaClient;
    const service = new CommunicationsMessageService(prisma);
    const result = await service.list(org, {
      status: "SENT",
      patientId: patient,
      from: "2026-10-13T00:00:00Z",
      to: "2026-10-14T00:00:00Z",
    });
    expect(where.organizationId).toBe(org);
    expect(where.status).toBe("SENT");
    expect(where.patientId).toBe(patient);
    expect(JSON.stringify(where)).toContain("sentAt");
    expect(orderBy).toEqual([
      { sentAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(result.items[0]?.phoneMasked).toBe("(11) 98765-****");
    expect(JSON.stringify(result)).not.toContain("4321");
  });

  test("history compares offset timestamps by instant and preserves cursor pagination", async () => {
    let queryArgs: Record<string, unknown> = {};
    const row = (id: string) => ({
      id,
      type: "APPOINTMENT_CREATED",
      status: "SENT",
      patientId: patient,
      appointmentId: "apt",
      createdAt: new Date("2026-10-13T12:00:00Z"),
      sentAt: new Date("2026-10-13T12:01:00Z"),
      errorCode: null,
      errorReason: null,
      patient: { phone: "11987654321" },
    });
    const prisma = {
      whatsAppMessage: {
        findFirst: async () => ({ id: "cursor" }),
        findMany: async (args: Record<string, unknown>) => {
          queryArgs = args;
          return [row("one"), row("two"), row("three")];
        },
      },
    } as unknown as PrismaClient;
    const service = new CommunicationsMessageService(prisma);

    const result = await service.list(org, {
      from: "2026-10-13T13:00:00+03:00",
      to: "2026-10-13T12:00:00Z",
      cursor: "cursor",
      limit: 2,
    });

    expect(queryArgs).toMatchObject({
      take: 3,
      cursor: { id: "cursor" },
      skip: 1,
    });
    expect(
      (queryArgs.where as { sentAt: { gte: Date; lte: Date } }).sentAt.gte,
    ).toEqual(new Date("2026-10-13T10:00:00Z"));
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe("two");

    await expect(
      service.list(org, {
        from: "2026-10-13T10:00:00-03:00",
        to: "2026-10-13T12:30:00Z",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", httpStatus: 400 });
  });

  test("webhook rejects invalid signatures and deduplicates status events", async () => {
    const events = new Map<
      string,
      {
        providerMessageHash: string;
        messageId: string | null;
        status: "DELIVERED" | "READ";
      }
    >();
    let messageStatus = "SENT";
    const prisma = {
      whatsAppSession: { findFirst: async () => ({ organizationId: org }) },
      whatsAppMessage: {
        findFirst: async () => ({ id: "msg", status: messageStatus }),
        updateMany: async ({ data }: { data: { status: string } }) => {
          messageStatus = data.status;
        },
      },
      whatsAppMessageAttempt: noCorrelatedAttempts(),
      whatsAppWebhookEvent: {
        findUnique: async ({
          where,
        }: {
          where: {
            organizationId_providerEventId: { providerEventId: string };
          };
        }) =>
          events.get(where.organizationId_providerEventId.providerEventId) ??
          null,
        create: async ({
          data,
        }: {
          data: {
            providerEventId: string;
            providerMessageHash: string;
            messageId: string | null;
            status: "DELIVERED" | "READ";
          };
        }) => {
          events.set(data.providerEventId, data);
        },
        updateMany: async () => ({ count: 0 }),
        findMany: async () =>
          [...events.values()].map(({ status }) => ({ status })),
      },
      $queryRaw: async () => [{ lockEvaluated: true }],
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    } as unknown as PrismaClient;
    const service = new CommunicationsMessageService(prisma);
    const raw = JSON.stringify({
      event: "message.ack",
      session: "private",
      payload: { id: "wa-id", ackName: "READ" },
    });
    const signature = createHmac("sha512", secret).update(raw).digest("hex");
    expect(verifyWahaWebhook(raw, "bad", secret)).toBe(false);
    await expect(
      service.webhook(raw, "bad", "event-1", String(Date.now()), secret),
    ).rejects.toMatchObject({ httpStatus: 401 });
    await expect(
      service.webhook(
        raw,
        signature,
        "event-stale",
        String(Date.now() - 600_000),
        secret,
      ),
    ).rejects.toMatchObject({ httpStatus: 401 });
    await service.webhook(
      raw,
      signature,
      "replay-with-a-different-request-id",
      String(Date.now()),
      secret,
    );
    await service.webhook(
      raw,
      signature,
      "event-1",
      String(Date.now()),
      secret,
    );
    expect(events.size).toBe(1);
    expect(messageStatus).toBe("READ");
    const old = JSON.stringify({
      event: "message.ack",
      session: "private",
      payload: { id: "wa-id", ackName: "DEVICE" },
    });
    await service.webhook(
      old,
      createHmac("sha512", secret).update(old).digest("hex"),
      "event-2",
      String(Date.now()),
      secret,
    );
    expect(messageStatus).toBe("READ");
  });

  test("persists an early acknowledgement and reconciles it after the worker stores the provider hash", async () => {
    const providerMessageId = "provider-message-id";
    const providerMessageHash = hashProviderMessageId(providerMessageId);
    const raw = JSON.stringify({
      event: "message.ack",
      session: "private",
      payload: { id: providerMessageId, ack: 3, ackName: "READ" },
    });
    const providerEventId = hashWebhookEvent(raw);
    const otherOrganizationId = "33333333-3333-4333-8333-333333333333";
    const correlationLocks: Array<[string, string]> = [];
    type StoredWebhookEvent = {
      organizationId: string;
      providerEventId: string;
      providerMessageHash: string;
      messageId: string | null;
      status: "FAILED" | "READ";
    };
    const message = {
      ...queuedMessage(),
      status: "QUEUED" as WhatsAppMessageStatus,
      providerMessageHash: null as string | null,
      sentAt: null as Date | null,
    };
    const events: StoredWebhookEvent[] = [
      {
        organizationId: otherOrganizationId,
        providerEventId,
        providerMessageHash,
        messageId: null as string | null,
        status: "FAILED" as const,
      },
    ];
    const prisma = {
      whatsAppSession: {
        findFirst: async () => ({ organizationId: org }),
        findUnique: async () => ({ providerSessionName: "private" }),
      },
      whatsAppMessage: {
        findFirst: async ({
          where,
        }: {
          where: {
            id?: string;
            organizationId: string;
            providerMessageHash?: string;
          };
        }) =>
          where.organizationId === org &&
          (where.id === message.id ||
            message.providerMessageHash === where.providerMessageHash)
            ? {
                id: message.id,
                status: message.status,
                sentAt: message.sentAt,
              }
            : null,
        findMany: async () => [message],
        updateMany: async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          if (
            data.status === "UNCERTAIN" &&
            typeof where.leaseUntil === "object"
          )
            return { count: 0 };
          Object.assign(message, data);
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(message, data);
          return message;
        },
      },
      whatsAppWebhookEvent: {
        findUnique: async ({
          where,
        }: {
          where: {
            organizationId_providerEventId: {
              organizationId: string;
              providerEventId: string;
            };
          };
        }) =>
          events.find(
            (event) =>
              event.organizationId ===
                where.organizationId_providerEventId.organizationId &&
              event.providerEventId ===
                where.organizationId_providerEventId.providerEventId,
          ) ?? null,
        create: async ({ data }: { data: StoredWebhookEvent }) => {
          events.push(data);
          return data;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: {
            organizationId: string;
            providerMessageHash: string;
            messageId: null;
          };
          data: { messageId: string };
        }) => {
          let count = 0;
          for (const event of events) {
            if (
              event.organizationId === where.organizationId &&
              event.providerMessageHash === where.providerMessageHash &&
              event.messageId === where.messageId
            ) {
              event.messageId = data.messageId;
              count += 1;
            }
          }
          return { count };
        },
        findMany: async ({
          where,
        }: {
          where: { organizationId: string; messageId: string };
        }) =>
          events
            .filter(
              (event) =>
                event.organizationId === where.organizationId &&
                event.messageId === where.messageId,
            )
            .map(({ status }) => ({ status })),
      },
      whatsAppPreference: { findFirst: async () => ({ id: "pref" }) },
      appointment: { findFirst: async () => eligibleAppointment() },
      whatsAppTemplate: {
        findUnique: async () => ({ id: "template", version: 1 }),
      },
      whatsAppTemplateVersion: {
        findUnique: async () => ({
          id: "template-version",
          content: "Consulta de {paciente_nome} em {data} às {hora}.",
        }),
      },
      whatsAppMessageAttempt: {
        ...noCorrelatedAttempts(),
        create: async () => ({ id: "attempt" }),
        update: async () => ({}),
      },
      $queryRaw: async (
        query: TemplateStringsArray,
        organizationId: string,
        lockedProviderMessageHash: string,
      ) => {
        if (query.join("?").includes("pg_advisory_xact_lock")) {
          correlationLocks.push([organizationId, lockedProviderMessageHash]);
          return [{ lockEvaluated: true }];
        }
        return [{ id: message.id }];
      },
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    } as unknown as PrismaClient;
    const service = new CommunicationsMessageService(prisma);

    await service.webhook(
      raw,
      createHmac("sha512", secret).update(raw).digest("hex"),
      "early-event-replay",
      String(Date.now()),
      secret,
    );
    await service.webhook(
      raw,
      createHmac("sha512", secret).update(raw).digest("hex"),
      "early-event",
      String(Date.now()),
      secret,
    );

    expect(
      events.find(
        (event) =>
          event.organizationId === org &&
          event.providerEventId === providerEventId,
      ),
    ).toMatchObject({
      organizationId: org,
      providerMessageHash,
      messageId: null,
      status: "READ",
    });
    expect(
      events.filter(
        (event) =>
          event.organizationId === org &&
          event.providerEventId === providerEventId,
      ),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.providerEventId === providerEventId),
    ).toHaveLength(2);

    await new WhatsAppQueueWorker(prisma, {
      ...provider,
      getSession: async () => ({ status: "WORKING" }),
      sendText: async () => providerMessageId,
    }).processBatch();

    expect(message.status).toBe("READ");
    expect(message.providerMessageHash).toBe(providerMessageHash);
    expect(
      events.find(
        (event) =>
          event.organizationId === org &&
          event.providerEventId === providerEventId,
      )?.messageId,
    ).toBe(message.id);
    expect(correlationLocks).toEqual([
      [org, providerMessageHash],
      [org, providerMessageHash],
      [org, providerMessageHash],
    ]);
    expect(events[0]?.messageId).toBeNull();
  });

  test("webhook accepts repeated PENDING acknowledgements without changing state", async () => {
    let transactions = 0;
    const prisma = {
      whatsAppSession: { findFirst: async () => ({ organizationId: org }) },
      whatsAppMessage: {
        findFirst: async () => ({ id: "msg", status: "UNCERTAIN" }),
      },
      $transaction: async () => {
        transactions += 1;
      },
    } as unknown as PrismaClient;
    const service = new CommunicationsMessageService(prisma);
    const raw = JSON.stringify({
      event: "message.ack",
      session: "private",
      payload: { id: "wa-id", ack: 0, ackName: "PENDING" },
    });
    const signature = createHmac("sha512", secret).update(raw).digest("hex");

    await service.webhook(
      raw,
      signature,
      "pending-1",
      String(Date.now()),
      secret,
    );
    await service.webhook(
      raw,
      signature,
      "pending-1",
      String(Date.now()),
      secret,
    );

    expect(transactions).toBe(0);
  });

  test("ERROR fails pending delivery but never regresses delivered or read messages", async () => {
    for (const initialStatus of [
      "QUEUED",
      "UNCERTAIN",
      "SENT",
      "DELIVERED",
      "READ",
    ] as const) {
      let messageStatus: string = initialStatus;
      let diagnostic: string | undefined;
      let eventStatus: "FAILED" | undefined;
      const prisma = {
        whatsAppSession: { findFirst: async () => ({ organizationId: org }) },
        whatsAppMessage: {
          findFirst: async () => ({
            id: "msg",
            status: messageStatus,
            sentAt: ["SENT", "DELIVERED", "READ"].includes(messageStatus)
              ? new Date()
              : null,
          }),
          updateMany: async ({
            data,
          }: {
            data: { status: string; errorCode?: string };
          }) => {
            messageStatus = data.status;
            diagnostic = data.errorCode;
            return { count: 1 };
          },
        },
        whatsAppMessageAttempt: noCorrelatedAttempts(),
        whatsAppWebhookEvent: {
          findUnique: async () => null,
          create: async ({ data }: { data: { status: "FAILED" } }) => {
            eventStatus = data.status;
            return { id: "event" };
          },
          updateMany: async () => ({ count: 0 }),
          findMany: async () => (eventStatus ? [{ status: eventStatus }] : []),
        },
        $queryRaw: async () => [{ lockEvaluated: true }],
        $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
      } as unknown as PrismaClient;
      const service = new CommunicationsMessageService(prisma);
      const raw = JSON.stringify({
        event: "message.ack",
        session: "private",
        payload: { id: "wa-id", ack: -1, ackName: "ERROR" },
      });

      await service.webhook(
        raw,
        createHmac("sha512", secret).update(raw).digest("hex"),
        `error-${initialStatus}`,
        String(Date.now()),
        secret,
      );

      const shouldFail = ["QUEUED", "UNCERTAIN", "SENT"].includes(
        initialStatus,
      );
      expect(messageStatus).toBe(shouldFail ? "FAILED" : initialStatus);
      expect(diagnostic).toBe(shouldFail ? "WAHA_ACK_ERROR" : undefined);
    }
  });

  test("reconciles out-of-order FAILED, SENT, DELIVERED and READ acknowledgements", async () => {
    type StoredWebhookEvent = {
      organizationId: string;
      providerEventId: string;
      providerMessageHash: string;
      messageId: string | null;
      status: WhatsAppMessageStatus;
    };
    const providerMessageHash = hashProviderMessageId("wa-id");
    const events: StoredWebhookEvent[] = [];
    const message: {
      id: string;
      status: WhatsAppMessageStatus;
      sentAt: Date | null;
    } = {
      id: "msg",
      status: "SENT",
      sentAt: new Date("2026-10-17T12:00:00Z"),
    };
    const prisma = {
      whatsAppSession: { findFirst: async () => ({ organizationId: org }) },
      whatsAppMessage: {
        findFirst: async () => ({ ...message }),
        updateMany: async ({
          where,
          data,
        }: {
          where: { status: WhatsAppMessageStatus };
          data: { status: WhatsAppMessageStatus; sentAt?: Date };
        }) => {
          if (where.status !== message.status) return { count: 0 };
          message.status = data.status;
          if (data.sentAt) message.sentAt = data.sentAt;
          return { count: 1 };
        },
      },
      whatsAppMessageAttempt: noCorrelatedAttempts(),
      whatsAppWebhookEvent: {
        findUnique: async ({
          where,
        }: {
          where: {
            organizationId_providerEventId: {
              organizationId: string;
              providerEventId: string;
            };
          };
        }) =>
          events.find(
            (event) =>
              event.organizationId ===
                where.organizationId_providerEventId.organizationId &&
              event.providerEventId ===
                where.organizationId_providerEventId.providerEventId,
          ) ?? null,
        create: async ({ data }: { data: StoredWebhookEvent }) => {
          events.push(data);
          return data;
        },
        updateMany: async () => ({ count: 0 }),
        findMany: async ({
          where,
        }: {
          where: { organizationId: string; messageId: string };
        }) =>
          events
            .filter(
              (event) =>
                event.organizationId === where.organizationId &&
                event.messageId === where.messageId,
            )
            .map(({ status }) => ({ status })),
      },
      $queryRaw: async () => [{ lockEvaluated: true }],
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    } as unknown as PrismaClient;
    const service = new CommunicationsMessageService(prisma);
    const acknowledge = async (
      requestId: string,
      ackName: "ERROR" | "SERVER" | "DEVICE" | "READ",
      ack: -1 | 1 | 2 | 3,
    ) => {
      const raw = JSON.stringify({
        event: "message.ack",
        session: "private",
        payload: { id: "wa-id", ackName, ack },
      });
      await service.webhook(
        raw,
        createHmac("sha512", secret).update(raw).digest("hex"),
        requestId,
        String(Date.now()),
        secret,
      );
    };

    await acknowledge("failed", "ERROR", -1);
    expect(message.status).toBe("FAILED");
    await acknowledge("late-sent", "SERVER", 1);
    expect(message.status).toBe("FAILED");
    await acknowledge("delivered", "DEVICE", 2);
    expect(message.status).toBe("DELIVERED");
    await acknowledge("late-failed", "ERROR", -1);
    expect(message.status).toBe("DELIVERED");
    await acknowledge("read", "READ", 3);
    expect(message.status).toBe("READ");
    await acknowledge("late-delivered", "DEVICE", 2);
    expect(message.status).toBe("READ");
    await acknowledge("read", "READ", 3);

    expect(message.status).toBe("READ");
    expect(events).toHaveLength(4);
    expect(new Set(events.map((event) => event.status))).toEqual(
      new Set(["FAILED", "SENT", "DELIVERED", "READ"]),
    );
    expect(events.every((event) => event.organizationId === org)).toBe(true);
    expect(
      events.every(
        (event) => event.providerMessageHash === providerMessageHash,
      ),
    ).toBe(true);
  });

  test("webhook rejects unknown or contradictory acknowledgement values", async () => {
    const service = new CommunicationsMessageService({} as PrismaClient);
    for (const payload of [
      { id: "wa-id", ack: 99, ackName: "UNKNOWN" },
      { id: "wa-id", ack: 2, ackName: "READ" },
    ]) {
      const raw = JSON.stringify({
        event: "message.ack",
        session: "private",
        payload,
      });
      await expect(
        service.webhook(
          raw,
          createHmac("sha512", secret).update(raw).digest("hex"),
          `invalid-${payload.ack}`,
          String(Date.now()),
          secret,
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", httpStatus: 400 });
    }
  });

  test("a later provider acknowledgement reconciles a correlated uncertain message", async () => {
    let update: Record<string, unknown> | undefined;
    let eventStatus: "SENT" | undefined;
    const prisma = {
      whatsAppSession: { findFirst: async () => ({ organizationId: org }) },
      whatsAppMessage: {
        findFirst: async () => ({ id: "msg", status: "UNCERTAIN" }),
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          update = data;
          return { count: 1 };
        },
      },
      whatsAppMessageAttempt: noCorrelatedAttempts(),
      whatsAppWebhookEvent: {
        findUnique: async () => null,
        create: async ({ data }: { data: { status: "SENT" } }) => {
          eventStatus = data.status;
          return { id: "event" };
        },
        updateMany: async () => ({ count: 0 }),
        findMany: async () => (eventStatus ? [{ status: eventStatus }] : []),
      },
      $queryRaw: async () => [{ lockEvaluated: true }],
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    } as unknown as PrismaClient;
    const service = new CommunicationsMessageService(prisma);
    const raw = JSON.stringify({
      event: "message.ack",
      session: "private",
      payload: { id: "wa-id", ackName: "SERVER" },
    });

    await service.webhook(
      raw,
      createHmac("sha512", secret).update(raw).digest("hex"),
      "event-late-ack",
      String(Date.now()),
      secret,
    );

    expect(update).toMatchObject({
      status: "SENT",
      uncertainAt: null,
      errorCode: null,
      errorReason: null,
    });
  });

  test("an expired delivery lease becomes visible as uncertain and is not requeued", async () => {
    let recovery: Record<string, unknown> | undefined;
    const prisma = {
      whatsAppMessage: {
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          recovery = data;
          return { count: 1 };
        },
        findMany: async () => [],
      },
    } as unknown as PrismaClient;

    expect(await new WhatsAppQueueWorker(prisma, provider).processBatch()).toBe(
      0,
    );
    expect(recovery?.status).toBe("UNCERTAIN");
    expect(recovery?.uncertainAt).toBeInstanceOf(Date);
  });

  test("history route enforces membership and clinic isolation", async () => {
    const prisma = {
      session: {
        findFirst: async () => ({ id: "sid", lastActiveAt: new Date() }),
      },
      membership: {
        findFirst: async ({
          where,
        }: {
          where: { organization: { slug: string } };
        }) =>
          where.organization.slug === "own"
            ? {
                id: "mem",
                organizationId: org,
                role: "RECEPTIONIST",
                status: "ACTIVE",
              }
            : null,
      },
      whatsAppMessage: { findMany: async () => [] },
    } as unknown as PrismaClient;
    const app = new Elysia()
      .onError(({ error, status }) =>
        error instanceof ApiError
          ? status(error.httpStatus, { error: { code: error.code } })
          : status(500, { error: { code: "INTERNAL" } }),
      )
      .use(communicationsModule({ prisma, jwtSecret: "jwt-secret", provider }));
    const token = signSessionToken(
      { sid: "sid", sub: "user" },
      "jwt-secret",
      60,
    );
    const own = await app.handle(
      new Request(
        "http://localhost/organizations/own/communications/messages",
        { headers: { authorization: `Bearer ${token}` } },
      ),
    );
    const other = await app.handle(
      new Request(
        "http://localhost/organizations/other/communications/messages",
        { headers: { authorization: `Bearer ${token}` } },
      ),
    );
    expect(own.status).toBe(200);
    expect(other.status).toBe(404);
  });

  test("history route rejects invalid limits and accepts integer limits from 1 to 100", async () => {
    const observedTakes: number[] = [];
    const prisma = {
      session: {
        findFirst: async () => ({ id: "sid", lastActiveAt: new Date() }),
      },
      membership: {
        findFirst: async () => ({
          id: "mem",
          organizationId: org,
          role: "RECEPTIONIST",
          status: "ACTIVE",
        }),
      },
      whatsAppMessage: {
        findMany: async ({ take }: { take: number }) => {
          observedTakes.push(take);
          return [];
        },
      },
    } as unknown as PrismaClient;
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
      { sid: "sid", sub: "user" },
      "jwt-secret",
      60,
    );
    const request = (limit: string) =>
      app.handle(
        new Request(
          `http://localhost/organizations/own/communications/messages?limit=${limit}`,
          { headers: { authorization: `Bearer ${token}` } },
        ),
      );

    for (const limit of ["1.5", "0", "-1", "101", "abc", ""]) {
      const response = await request(limit);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }
    for (const limit of ["1", "100"])
      expect((await request(limit)).status).toBe(200);
    expect(observedTakes).toEqual([2, 101]);
  });

  test("webhook route verifies HMAC over raw body before updating status", async () => {
    let eventStatus: "READ" | undefined;
    const prisma = {
      whatsAppSession: { findFirst: async () => ({ organizationId: org }) },
      whatsAppMessage: {
        findFirst: async () => ({ id: "msg", status: "SENT" }),
        updateMany: async () => ({ count: 1 }),
      },
      whatsAppMessageAttempt: noCorrelatedAttempts(),
      whatsAppWebhookEvent: {
        findUnique: async () => null,
        create: async ({ data }: { data: { status: "READ" } }) => {
          eventStatus = data.status;
          return { id: "evt" };
        },
        updateMany: async () => ({ count: 0 }),
        findMany: async () => (eventStatus ? [{ status: eventStatus }] : []),
      },
      $queryRaw: async () => [{ lockEvaluated: true }],
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    } as unknown as PrismaClient;
    const app = new Elysia()
      .onError(({ error, status }) =>
        error instanceof ApiError
          ? status(error.httpStatus, { error: { code: error.code } })
          : status(500, { error: { code: "INTERNAL" } }),
      )
      .use(whatsappWebhookModule({ prisma, provider, secret }));
    const raw = JSON.stringify({
      event: "message.ack",
      session: "private",
      payload: { id: "wa-id", ackName: "READ" },
    });
    const url = "http://localhost/webhooks/whatsapp/status";
    const headers = {
      "content-type": "application/json",
      "x-webhook-request-id": "event-id",
      "x-webhook-timestamp": String(Date.now()),
      "x-webhook-hmac": createHmac("sha512", secret).update(raw).digest("hex"),
    };
    const accepted = await app.handle(
      new Request(url, { method: "POST", headers, body: raw }),
    );
    expect(accepted.status).toBe(200);
    const rejected = await app.handle(
      new Request(url, {
        method: "POST",
        headers: { ...headers, "x-webhook-hmac": "invalid" },
        body: raw,
      }),
    );
    expect(rejected.status).toBe(401);
  });

  test("worker pins and renders the organization template for a DDD 55 phone", async () => {
    const message = queuedMessage();
    let pinnedVersionId: string | undefined;
    let sentUpdate: Record<string, unknown> | undefined;
    let sent: { session: string; chatId: string; text: string } | undefined;
    const prisma = {
      whatsAppMessage: {
        findMany: async () => [message],
        findFirst: async () => ({
          id: message.id,
          status: (sentUpdate?.status ??
            message.status) as WhatsAppMessageStatus,
          sentAt: (sentUpdate?.sentAt as Date | undefined) ?? null,
        }),
        updateMany: async ({
          data,
        }: {
          data: { templateVersionId?: string };
        }) => {
          if (data.templateVersionId) pinnedVersionId = data.templateVersionId;
          return { count: 1 };
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          sentUpdate = data;
        },
      },
      whatsAppPreference: { findFirst: async () => ({ id: "pref" }) },
      appointment: {
        findFirst: async () => eligibleAppointment("(55) 99999-8888"),
      },
      whatsAppSession: {
        findUnique: async () => ({ providerSessionName: "private" }),
      },
      whatsAppTemplate: {
        findUnique: async () => ({ id: "template", version: 1 }),
      },
      whatsAppTemplateVersion: {
        findUnique: async () => ({
          id: "template-version",
          content: "{clinica_nome}|{paciente_nome}|{data}|{hora}|{medico_nome}",
        }),
      },
      whatsAppMessageAttempt: {
        ...noCorrelatedAttempts(),
        create: async () => ({ id: "attempt" }),
        update: async () => ({}),
      },
      whatsAppWebhookEvent: {
        updateMany: async () => ({ count: 0 }),
        findMany: async () => [],
      },
      $queryRaw: async () => [{ lockEvaluated: true }],
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    } as unknown as PrismaClient;
    const sendingProvider: WhatsAppProvider = {
      ...provider,
      getSession: async () => ({ status: "WORKING" }),
      sendText: async (session, chatId, text) => {
        sent = { session, chatId, text };
        return "provider-message-id";
      },
    };

    await new WhatsAppQueueWorker(prisma, sendingProvider).processBatch();

    expect(pinnedVersionId).toBe("template-version");
    expect(sent).toEqual({
      session: "private",
      chatId: "5555999998888@c.us",
      text: "Clínica|Pessoa|14/10/2026|09:00|Profissional",
    });
    expect(sentUpdate?.status).toBe("SENT");
  });

  test("worker refuses an overdue reminder after the appointment has started", async () => {
    const message = {
      ...queuedMessage(),
      type: "APPOINTMENT_REMINDER" as const,
    };
    let update: Record<string, unknown> | undefined;
    let sends = 0;
    const prisma = {
      whatsAppMessage: {
        findMany: async () => [message],
        findFirst: async () => ({
          id: message.id,
          status: (update?.status ?? message.status) as WhatsAppMessageStatus,
          sentAt: (update?.sentAt as Date | undefined) ?? null,
        }),
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          update = data;
        },
      },
      whatsAppPreference: { findFirst: async () => ({ id: "pref" }) },
      appointment: {
        findFirst: async () => ({
          ...eligibleAppointment(),
          scheduledAt: new Date(Date.now() - 60_000),
        }),
      },
      whatsAppMessageAttempt: noCorrelatedAttempts(),
      whatsAppSession: {
        findUnique: async () => ({ providerSessionName: "private" }),
      },
    } as unknown as PrismaClient;
    const sendingProvider: WhatsAppProvider = {
      ...provider,
      getSession: async () => ({ status: "WORKING" }),
      sendText: async () => {
        sends += 1;
        return "provider-message-id";
      },
    };

    await new WhatsAppQueueWorker(prisma, sendingProvider).processBatch();

    expect(sends).toBe(0);
    expect(update?.status).toBe("FAILED");
    expect(update?.errorCode).toBe("NOT_ELIGIBLE");
  });

  test("worker revalidates opt-in and appointment immediately before sending", async () => {
    const message = queuedMessage();
    let preferenceReads = 0;
    let appointmentReads = 0;
    let messageUpdate: Record<string, unknown> | undefined;
    let attemptUpdate: Record<string, unknown> | undefined;
    let sends = 0;
    const prisma = {
      whatsAppMessage: {
        findMany: async () => [message],
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          messageUpdate = data;
        },
      },
      whatsAppPreference: {
        findFirst: async () => {
          preferenceReads += 1;
          return preferenceReads === 1 ? { id: "pref" } : null;
        },
      },
      appointment: {
        findFirst: async () => {
          appointmentReads += 1;
          return eligibleAppointment();
        },
      },
      whatsAppSession: {
        findUnique: async () => ({ providerSessionName: "private" }),
      },
      whatsAppTemplate: {
        findUnique: async () => ({ id: "template", version: 1 }),
      },
      whatsAppTemplateVersion: {
        findUnique: async () => ({
          id: "template-version",
          content: "Consulta de {paciente_nome} em {data} às {hora}.",
        }),
      },
      whatsAppMessageAttempt: {
        ...noCorrelatedAttempts(),
        create: async () => ({ id: "attempt" }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          attemptUpdate = data;
        },
      },
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    } as unknown as PrismaClient;
    const sendingProvider: WhatsAppProvider = {
      ...provider,
      getSession: async () => ({ status: "WORKING" }),
      sendText: async () => {
        sends += 1;
        return "provider-message-id";
      },
    };

    await new WhatsAppQueueWorker(prisma, sendingProvider).processBatch();

    expect(preferenceReads).toBe(2);
    expect(appointmentReads).toBe(2);
    expect(sends).toBe(0);
    expect(attemptUpdate?.errorCode).toBe("NOT_ELIGIBLE");
    expect(messageUpdate?.status).toBe("FAILED");
    expect(messageUpdate?.attemptCount).toBe(1);
  });

  test("worker fails diagnostically without sending when no template exists", async () => {
    const message = queuedMessage();
    let update: Record<string, unknown> | undefined;
    let sends = 0;
    const prisma = {
      whatsAppMessage: {
        findMany: async () => [message],
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          update = data;
        },
      },
      whatsAppPreference: { findFirst: async () => ({ id: "pref" }) },
      appointment: { findFirst: async () => eligibleAppointment() },
      whatsAppSession: {
        findUnique: async () => ({ providerSessionName: "private" }),
      },
      whatsAppTemplate: { findUnique: async () => null },
      whatsAppMessageAttempt: noCorrelatedAttempts(),
    } as unknown as PrismaClient;
    const sendingProvider: WhatsAppProvider = {
      ...provider,
      getSession: async () => ({ status: "WORKING" }),
      sendText: async () => {
        sends += 1;
        return "provider-message-id";
      },
    };

    await new WhatsAppQueueWorker(prisma, sendingProvider).processBatch();

    expect(sends).toBe(0);
    expect(update?.status).toBe("FAILED");
    expect(update?.errorCode).toBe("TEMPLATE_NOT_CONFIGURED");
  });

  test("worker exposes ambiguous outcomes without scheduling another send", async () => {
    const message = queuedMessage();
    let update: Record<string, unknown> | undefined;
    const prisma = {
      whatsAppMessage: {
        findMany: async () => [message],
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          update = data;
        },
      },
      whatsAppPreference: { findFirst: async () => ({ id: "pref" }) },
      appointment: { findFirst: async () => eligibleAppointment() },
      whatsAppSession: {
        findUnique: async () => ({ providerSessionName: "private" }),
      },
      whatsAppTemplate: {
        findUnique: async () => ({ id: "template", version: 1 }),
      },
      whatsAppTemplateVersion: {
        findUnique: async () => ({
          id: "template-version",
          content: "Consulta de {paciente_nome} em {data} às {hora}.",
        }),
      },
      whatsAppMessageAttempt: {
        ...noCorrelatedAttempts(),
        create: async () => ({ id: "attempt" }),
        update: async () => ({}),
      },
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    } as unknown as PrismaClient;
    const ambiguousProvider: WhatsAppProvider = {
      ...provider,
      getSession: async () => ({ status: "WORKING" }),
      sendText: async () => {
        throw new WahaSendError("uncertain", "WAHA_HTTP_503");
      },
    };

    await new WhatsAppQueueWorker(prisma, ambiguousProvider).processBatch();

    expect(update?.status).toBe("UNCERTAIN");
    expect(update?.uncertainAt).toBeInstanceOf(Date);
    expect(update?.nextAttemptAt).toBeUndefined();
  });

  test("worker retains the provider hash when local persistence fails after acceptance", async () => {
    const message = queuedMessage();
    let transactions = 0;
    let update: Record<string, unknown> | undefined;
    const prisma = {
      whatsAppMessage: {
        findMany: async () => [message],
        findFirst: async () => ({
          id: message.id,
          status: (update?.status ?? message.status) as WhatsAppMessageStatus,
          sentAt: (update?.sentAt as Date | undefined) ?? null,
        }),
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          update = data;
        },
      },
      whatsAppPreference: { findFirst: async () => ({ id: "pref" }) },
      appointment: { findFirst: async () => eligibleAppointment() },
      whatsAppSession: {
        findUnique: async () => ({ providerSessionName: "private" }),
      },
      whatsAppTemplate: {
        findUnique: async () => ({ id: "template", version: 1 }),
      },
      whatsAppTemplateVersion: {
        findUnique: async () => ({
          id: "template-version",
          content: "Consulta de {paciente_nome} em {data} às {hora}.",
        }),
      },
      whatsAppMessageAttempt: {
        ...noCorrelatedAttempts(),
        create: async () => ({ id: "attempt" }),
        update: async () => ({}),
      },
      whatsAppWebhookEvent: {
        updateMany: async () => ({ count: 0 }),
        findMany: async () => [],
      },
      $queryRaw: async () => [{ lockEvaluated: true }],
      $transaction: async (fn: (tx: unknown) => unknown) => {
        transactions += 1;
        if (transactions === 1) throw new Error("database unavailable");
        return fn(prisma);
      },
    } as unknown as PrismaClient;
    const acceptedProvider: WhatsAppProvider = {
      ...provider,
      getSession: async () => ({ status: "WORKING" }),
      sendText: async () => "provider-message-id",
    };

    await new WhatsAppQueueWorker(prisma, acceptedProvider).processBatch();

    expect(update?.status).toBe("UNCERTAIN");
    expect(update?.providerMessageHash).toBe(
      hashProviderMessageId("provider-message-id"),
    );
  });

  test("worker releases a message without attempting delivery while WAHA is unavailable", async () => {
    const message = queuedMessage();
    let update: Record<string, unknown> | undefined;
    let attempts = 0;
    let sends = 0;
    const prisma = {
      whatsAppMessage: {
        findMany: async () => [message],
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          update = data;
        },
      },
      whatsAppPreference: { findFirst: async () => ({ id: "pref" }) },
      appointment: { findFirst: async () => eligibleAppointment() },
      whatsAppSession: {
        findUnique: async () => ({ providerSessionName: "private" }),
      },
      whatsAppTemplate: {
        findUnique: async () => ({ id: "template", version: 1 }),
      },
      whatsAppTemplateVersion: {
        findUnique: async () => ({
          id: "template-version",
          content: "Consulta de {paciente_nome} em {data} às {hora}.",
        }),
      },
      whatsAppMessageAttempt: {
        ...noCorrelatedAttempts(),
        create: async () => {
          attempts += 1;
          return { id: "attempt" };
        },
      },
    } as unknown as PrismaClient;
    const unavailableProvider: WhatsAppProvider = {
      ...provider,
      getSession: async () => {
        throw new Error("unavailable");
      },
      sendText: async () => {
        sends += 1;
        return "provider-message-id";
      },
    };

    await new WhatsAppQueueWorker(prisma, unavailableProvider).processBatch();

    expect(attempts).toBe(0);
    expect(sends).toBe(0);
    expect(update?.leaseUntil).toBeNull();
    expect(update?.nextAttemptAt).toBeInstanceOf(Date);
  });

  test("an explicitly safe provider failure stops after three automatic attempts", async () => {
    const message = {
      id: "msg",
      organizationId: org,
      patientId: patient,
      appointmentId: "apt",
      eventId: "apt:0",
      type: "APPOINTMENT_CREATED",
      status: "QUEUED",
      attemptCount: 0,
      nextAttemptAt: new Date(Date.now() - 1),
      templateVersionId: null,
    };
    let update: Record<string, unknown> | undefined;
    let sends = 0;
    const prisma = {
      whatsAppMessage: {
        findMany: async () => (message.status === "QUEUED" ? [message] : []),
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          update = data;
          Object.assign(message, data);
        },
      },
      whatsAppPreference: { findFirst: async () => ({ id: "pref" }) },
      appointment: {
        findFirst: async () => ({
          version: 0,
          status: "RESERVED",
          scheduledAt: new Date("2026-10-14T12:00:00Z"),
          patient: { phone: "11987654321", fullName: "Pessoa" },
          professional: { fullName: "Profissional" },
          organization: { name: "Clínica", timezone: "America/Sao_Paulo" },
        }),
      },
      whatsAppSession: {
        findUnique: async () => ({ providerSessionName: "private" }),
      },
      whatsAppTemplate: {
        findUnique: async () => ({ id: "template", version: 1 }),
      },
      whatsAppTemplateVersion: {
        findUnique: async () => ({
          id: "template-version",
          content:
            "Olá, {paciente_nome}. Consulta em {data} às {hora} com {medico_nome}, na {clinica_nome}.",
        }),
      },
      whatsAppMessageAttempt: {
        ...noCorrelatedAttempts(),
        create: async () => ({ id: "attempt" }),
        update: async () => ({}),
      },
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    } as unknown as PrismaClient;
    const failingProvider = {
      ...provider,
      getSession: async () => ({ status: "WORKING" }),
      sendText: async () => {
        sends += 1;
        throw new WahaSendError("temporary", "SAFE_RETRYABLE_FAILURE");
      },
    };
    const worker = new WhatsAppQueueWorker(prisma, failingProvider);
    for (const attemptNumber of [1, 2, 3]) {
      expect(await worker.processBatch()).toBe(1);
      expect(update?.attemptCount).toBe(attemptNumber);
      message.nextAttemptAt = new Date(Date.now() - 1);
    }
    expect(update?.errorCode).toBe("SAFE_RETRYABLE_FAILURE");
    expect(update?.attemptCount).toBe(3);
    expect(update?.status).toBe("FAILED");
    expect(await worker.processBatch()).toBe(0);
    expect(sends).toBe(3);
  });
});
