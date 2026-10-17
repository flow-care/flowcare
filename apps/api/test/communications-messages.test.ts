import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Elysia } from "elysia";
import type { PrismaClient } from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import {
  communicationsModule,
  whatsappWebhookModule,
} from "../src/modules/communications";
import {
  CommunicationsMessageService,
  hashProviderMessageId,
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
    const events = new Set<string>();
    let messageStatus = "SENT";
    const prisma = {
      whatsAppSession: { findFirst: async () => ({ organizationId: org }) },
      whatsAppMessage: {
        findFirst: async () => ({ id: "msg", status: messageStatus }),
        updateMany: async ({ data }: { data: { status: string } }) => {
          messageStatus = data.status;
        },
      },
      whatsAppWebhookEvent: {
        create: async ({ data }: { data: { providerEventId: string } }) => {
          if (events.has(data.providerEventId)) throw { code: "P2002" };
          events.add(data.providerEventId);
        },
      },
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
    await service.webhook(
      raw,
      signature,
      "event-1",
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
      const prisma = {
        whatsAppSession: { findFirst: async () => ({ organizationId: org }) },
        whatsAppMessage: {
          findFirst: async () => ({ id: "msg", status: messageStatus }),
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
        whatsAppWebhookEvent: { create: async () => ({ id: "event" }) },
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
    const prisma = {
      whatsAppSession: { findFirst: async () => ({ organizationId: org }) },
      whatsAppMessage: {
        findFirst: async () => ({ id: "msg", status: "UNCERTAIN" }),
        updateMany: async ({ data }: { data: Record<string, unknown> }) => {
          update = data;
          return { count: 1 };
        },
      },
      whatsAppWebhookEvent: { create: async () => ({ id: "event" }) },
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

  test("webhook route verifies HMAC over raw body before updating status", async () => {
    const prisma = {
      whatsAppSession: { findFirst: async () => ({ organizationId: org }) },
      whatsAppMessage: {
        findFirst: async () => ({ id: "msg", status: "SENT" }),
        updateMany: async () => ({ count: 1 }),
      },
      whatsAppWebhookEvent: { create: async () => ({ id: "evt" }) },
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
        create: async () => ({ id: "attempt" }),
        update: async () => ({}),
      },
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
        create: async () => ({ id: "attempt" }),
        update: async () => ({}),
      },
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

  test("an explicitly safe provider failure schedules a bounded retry", async () => {
    const message = {
      id: "msg",
      organizationId: org,
      patientId: patient,
      appointmentId: "apt",
      eventId: "apt:0",
      type: "APPOINTMENT_CREATED",
      status: "QUEUED",
      attemptCount: 0,
      templateVersionId: null,
    };
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
        create: async () => ({ id: "attempt" }),
        update: async () => ({}),
      },
      $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
    } as unknown as PrismaClient;
    const failingProvider = {
      ...provider,
      getSession: async () => ({ status: "WORKING" }),
      sendText: async () => {
        throw new WahaSendError("temporary", "SAFE_RETRYABLE_FAILURE");
      },
    };
    await new WhatsAppQueueWorker(prisma, failingProvider).processBatch();
    expect(update?.errorCode).toBe("SAFE_RETRYABLE_FAILURE");
    expect(update?.attemptCount).toBe(1);
    expect(update?.nextAttemptAt).toBeInstanceOf(Date);
    expect(update?.status).toBeUndefined();
  });
});
