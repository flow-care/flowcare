import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  WhatsAppMessageStatus,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { recordAuditEvent } from "../../services/audit-logger";
import { resolveWhatsAppDeliveryEligibility } from "./delivery-eligibility";
import type { messageQuery, preferenceBody } from "./model";
import { cancelQueuedPatientMessages } from "./queue";

export function maskPatientPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const local =
    digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (local.length < 10 || local.length > 11) return "****";
  return `(${local.slice(0, 2)}) ${local.slice(2, -4)}-****`;
}

export function hashProviderMessageId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}

export function hashWebhookEvent(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function verifyWahaWebhook(
  raw: string,
  signature: string | null,
  secret: string | null | undefined,
): boolean {
  if (!secret || !signature || !/^[a-f0-9]{128}$/i.test(signature))
    return false;
  const expected = createHmac("sha512", secret).update(raw).digest();
  const actual = Buffer.from(signature, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const wahaAckValues = {
  ERROR: -1,
  PENDING: 0,
  SERVER: 1,
  DEVICE: 2,
  READ: 3,
  PLAYED: 4,
} as const;

const messageStatusByAck: Record<
  keyof typeof wahaAckValues,
  WhatsAppMessageStatus | null
> = {
  ERROR: "FAILED",
  PENDING: null,
  SERVER: "SENT",
  DEVICE: "DELIVERED",
  READ: "READ",
  PLAYED: "READ",
};

type CorrelatedMessage = {
  id: string;
  status: WhatsAppMessageStatus;
  sentAt: Date | null;
};

type CorrelatedAttempt = {
  id: string;
  organizationId: string | null;
  messageId: string;
  number: number;
  dispatchedAt: Date | null;
  providerMessageHash: string | null;
};

type ReservedManualAttempt = {
  id: string;
  number: number;
  startedAt: Date;
};

type AdvisoryLockRow = {
  lockEvaluated: boolean;
};

type LockedMessageRow = {
  id: string;
};

const queuedManualResend = { status: "QUEUED" as const };

function messageStateConflict(): ApiError {
  return new ApiError(
    "MESSAGE_STATE_CONFLICT",
    409,
    "A mensagem não pode ser reenviada.",
  );
}

function idempotencyConflict(): ApiError {
  return new ApiError(
    "IDEMPOTENCY_CONFLICT",
    409,
    "A chave de idempotência já foi usada em outra solicitação.",
  );
}

type ManualResendUniqueConflict =
  | "ATTEMPT_NUMBER"
  | "IDEMPOTENCY_KEY"
  | "OTHER";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function matchesUniqueConstraint(
  value: unknown,
  fields: readonly string[],
  constraintName: string,
): boolean {
  if (Array.isArray(value)) {
    const actualFields = value.filter(
      (field): field is string => typeof field === "string",
    );
    return (
      actualFields.length === fields.length &&
      fields.every((field) => actualFields.includes(field))
    );
  }
  if (typeof value === "string") return value === constraintName;

  const record = asRecord(value);
  if (!record) return false;
  return [record.fields, record.name, record.index].some((candidate) =>
    matchesUniqueConstraint(candidate, fields, constraintName),
  );
}

function classifyManualResendUniqueConflict(
  error: unknown,
): ManualResendUniqueConflict | null {
  const record = asRecord(error);
  if (record?.code !== "P2002") return null;

  const metadata = asRecord(record.meta);
  const adapterError = asRecord(metadata?.driverAdapterError);
  const adapterCause = asRecord(adapterError?.cause);
  const candidates = [
    metadata?.target,
    metadata?.constraint,
    adapterCause?.constraint,
  ];

  if (
    candidates.some((candidate) =>
      matchesUniqueConstraint(
        candidate,
        ["organizationId", "idempotencyKey"],
        "WhatsAppMessageAttempt_organizationId_idempotencyKey_key",
      ),
    )
  )
    return "IDEMPOTENCY_KEY";

  if (
    candidates.some((candidate) =>
      matchesUniqueConstraint(
        candidate,
        ["messageId", "number"],
        "WhatsAppMessageAttempt_messageId_number_key",
      ),
    )
  )
    return "ATTEMPT_NUMBER";

  return "OTHER";
}

async function lockManualResendKey(
  tx: Prisma.TransactionClient,
  organizationId: string,
  idempotencyKey: string,
) {
  await tx.$queryRaw<AdvisoryLockRow[]>`
    SELECT pg_advisory_xact_lock(
      hashtext(${organizationId}),
      hashtext(${`whatsapp-manual-resend:${idempotencyKey}`})
    ) IS NULL AS "lockEvaluated"
  `;
}

async function lockManualResendMessage(
  tx: Prisma.TransactionClient,
  organizationId: string,
  messageId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<LockedMessageRow[]>`
    SELECT "id"
    FROM "WhatsAppMessage"
    WHERE "organizationId" = ${organizationId}::uuid
      AND "id" = ${messageId}::uuid
    FOR UPDATE
  `;
  return rows.length === 1;
}

function reconciledWebhookStatus(
  current: WhatsAppMessageStatus,
  events: readonly WhatsAppMessageStatus[],
): WhatsAppMessageStatus {
  const observed = new Set(events);
  if (current === "READ" || observed.has("READ")) return "READ";
  if (current === "DELIVERED" || observed.has("DELIVERED")) return "DELIVERED";
  if (current === "FAILED" || observed.has("FAILED")) return "FAILED";
  if (current === "SENT" || observed.has("SENT")) return "SENT";
  return current;
}

export async function lockWhatsAppProviderMessage(
  tx: Prisma.TransactionClient,
  organizationId: string,
  providerMessageHash: string,
) {
  await tx.$queryRaw<AdvisoryLockRow[]>`
    SELECT pg_advisory_xact_lock(
      hashtext(${organizationId}),
      hashtext(${providerMessageHash})
    ) IS NULL AS "lockEvaluated"
  `;
}

async function findWhatsAppAttemptByProviderHash(
  tx: Prisma.TransactionClient,
  organizationId: string,
  providerMessageHash: string,
  messageId?: string,
): Promise<CorrelatedAttempt | null> {
  const scoped = await tx.whatsAppMessageAttempt.findUnique({
    where: {
      organizationId_providerMessageHash: {
        organizationId,
        providerMessageHash,
      },
    },
    select: {
      id: true,
      organizationId: true,
      messageId: true,
      number: true,
      dispatchedAt: true,
      providerMessageHash: true,
    },
  });
  if (scoped || !messageId) return scoped;

  // During the expansion rollout, the #296 worker can still create attempts
  // without organizationId. Keep this fallback constrained to the already
  // tenant-scoped message and require an unambiguous hash match.
  const legacy = await tx.whatsAppMessageAttempt.findMany({
    where: {
      organizationId: null,
      messageId,
      providerMessageHash,
    },
    orderBy: { number: "desc" },
    take: 2,
    select: {
      id: true,
      organizationId: true,
      messageId: true,
      number: true,
      dispatchedAt: true,
      providerMessageHash: true,
    },
  });
  return legacy.length === 1 ? (legacy[0] ?? null) : null;
}

async function findActiveWhatsAppAttempt(
  tx: Prisma.TransactionClient,
  organizationId: string,
  messageId: string,
): Promise<CorrelatedAttempt | null> {
  return tx.whatsAppMessageAttempt.findFirst({
    where: {
      messageId,
      AND: [
        { OR: [{ organizationId }, { organizationId: null }] },
        {
          OR: [
            { dispatchedAt: { not: null } },
            { providerMessageHash: { not: null } },
          ],
        },
      ],
    },
    orderBy: { number: "desc" },
    select: {
      id: true,
      organizationId: true,
      messageId: true,
      number: true,
      dispatchedAt: true,
      providerMessageHash: true,
    },
  });
}

async function findReservedManualAttempt(
  tx: Prisma.TransactionClient,
  organizationId: string,
  messageId: string,
  attemptCount: number,
): Promise<ReservedManualAttempt | null> {
  return tx.whatsAppMessageAttempt.findFirst({
    where: {
      organizationId,
      messageId,
      origin: "MANUAL",
      number: { gt: attemptCount },
      dispatchedAt: null,
      completedAt: null,
      providerMessageHash: null,
    },
    orderBy: { number: "desc" },
    select: {
      id: true,
      number: true,
      startedAt: true,
    },
  });
}

export async function reconcileWhatsAppWebhookEvents(
  tx: Prisma.TransactionClient,
  organizationId: string,
  providerMessageHash: string,
  message: CorrelatedMessage,
  correlatedAttempt?: CorrelatedAttempt | null,
) {
  const attempt =
    correlatedAttempt === undefined
      ? await findWhatsAppAttemptByProviderHash(
          tx,
          organizationId,
          providerMessageHash,
          message.id,
        )
      : correlatedAttempt;

  if (!(await lockManualResendMessage(tx, organizationId, message.id))) return;

  const currentMessage = await tx.whatsAppMessage.findFirst({
    where: { id: message.id, organizationId },
    select: {
      id: true,
      status: true,
      sentAt: true,
      attemptCount: true,
    },
  });
  if (!currentMessage) return;

  const scopedAttempt =
    attempt?.organizationId === organizationId ? attempt : null;
  if (scopedAttempt)
    await tx.whatsAppWebhookEvent.updateMany({
      where: {
        organizationId,
        providerMessageHash,
        OR: [{ attemptId: null }, { attemptId: scopedAttempt.id }],
      },
      data: { messageId: message.id, attemptId: scopedAttempt.id },
    });
  else
    await tx.whatsAppWebhookEvent.updateMany({
      where: {
        organizationId,
        providerMessageHash,
        messageId: null,
        attemptId: null,
      },
      data: { messageId: message.id },
    });
  const events = await tx.whatsAppWebhookEvent.findMany({
    where: scopedAttempt
      ? { organizationId, attemptId: scopedAttempt.id }
      : {
          organizationId,
          providerMessageHash,
          messageId: message.id,
          attemptId: null,
        },
    select: { status: true },
  });

  const activeAttempt = await findActiveWhatsAppAttempt(
    tx,
    organizationId,
    message.id,
  );
  if (activeAttempt && activeAttempt.id !== attempt?.id) return;

  const status = reconciledWebhookStatus(
    currentMessage.status,
    events.map((event) => event.status),
  );
  const marksAccepted = ["SENT", "DELIVERED", "READ"].includes(status);
  if (
    status === currentMessage.status &&
    (!marksAccepted || currentMessage.sentAt)
  )
    return;

  let cancelledManualAttempt: ReservedManualAttempt | null = null;
  if (currentMessage.status === "QUEUED" && status !== "QUEUED") {
    // The message row is already locked. The manual worker acquires the same
    // row before fencing its attempt, so either its dispatchedAt wins and the
    // active-attempt check above returns, or this cancellation wins first.
    cancelledManualAttempt = await findReservedManualAttempt(
      tx,
      organizationId,
      message.id,
      currentMessage.attemptCount,
    );
    if (cancelledManualAttempt) {
      const completedAt = new Date(
        Math.max(Date.now(), cancelledManualAttempt.startedAt.getTime()),
      );
      const cancelled = await tx.whatsAppMessageAttempt.updateMany({
        where: {
          id: cancelledManualAttempt.id,
          organizationId,
          messageId: message.id,
          number: cancelledManualAttempt.number,
          origin: "MANUAL",
          dispatchedAt: null,
          completedAt: null,
          providerMessageHash: null,
        },
        data: {
          completedAt,
          errorCode: "MANUAL_RESEND_CANCELLED",
          errorReason:
            "Tentativa manual cancelada por ACK da tentativa anterior.",
        },
      });
      if (cancelled.count !== 1)
        throw new Error("Reserved manual attempt cancellation lost its fence.");
    }
  }

  const transitioned = await tx.whatsAppMessage.updateMany({
    where: {
      id: message.id,
      organizationId,
      providerMessageHash,
      status: currentMessage.status,
    },
    data:
      status === "FAILED"
        ? {
            status,
            leaseUntil: null,
            ...(cancelledManualAttempt
              ? { attemptCount: cancelledManualAttempt.number }
              : {}),
            uncertainAt: null,
            errorCode: "WAHA_ACK_ERROR",
            errorReason: "O provedor confirmou falha na entrega.",
          }
        : {
            status,
            leaseUntil: null,
            ...(cancelledManualAttempt
              ? { attemptCount: cancelledManualAttempt.number }
              : {}),
            sentAt: currentMessage.sentAt ?? new Date(),
            uncertainAt: null,
            errorCode: null,
            errorReason: null,
          },
  });
  if (cancelledManualAttempt && transitioned.count !== 1)
    throw new Error("Webhook transition lost its cancelled manual attempt.");
}

async function lockManualResendEligibilityRows(
  tx: Prisma.TransactionClient,
  organizationId: string,
  messageId: string,
) {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT preference."id"
    FROM "WhatsAppMessage" AS message
    JOIN "WhatsAppPreference" AS preference
      ON preference."organizationId" = message."organizationId"
     AND preference."patientId" = message."patientId"
    JOIN "Appointment" AS appointment
      ON appointment."id" = message."appointmentId"
     AND appointment."organizationId" = message."organizationId"
     AND appointment."patientId" = message."patientId"
    JOIN "Patient" AS patient
      ON patient."id" = appointment."patientId"
     AND patient."organizationId" = appointment."organizationId"
    WHERE message."organizationId" = ${organizationId}::uuid
      AND message."id" = ${messageId}::uuid
    FOR SHARE OF preference, appointment, patient
  `;
}
export class CommunicationsMessageService {
  constructor(private readonly prisma: PrismaClient) {}

  async authorizeManualResend(
    organizationId: string,
    messageId: string,
    actorUserId: string,
    idempotencyKey: string,
  ): Promise<{ status: "QUEUED" }> {
    const key = idempotencyKey.trim();
    if (!key)
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Cabeçalho Idempotency-Key é obrigatório.",
        { field: "idempotencyKey" },
      );

    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockManualResendKey(tx, organizationId, key);

        const replay = await tx.whatsAppMessageAttempt.findFirst({
          where: { organizationId, idempotencyKey: key },
          select: { messageId: true },
        });
        if (replay) {
          if (replay.messageId !== messageId) throw idempotencyConflict();
          return queuedManualResend;
        }

        await lockManualResendEligibilityRows(tx, organizationId, messageId);

        if (!(await lockManualResendMessage(tx, organizationId, messageId)))
          throw new ApiError("NOT_FOUND", 404, "Mensagem não encontrada.");

        const message = await tx.whatsAppMessage.findFirst({
          where: { id: messageId, organizationId },
          select: {
            id: true,
            organizationId: true,
            patientId: true,
            appointmentId: true,
            eventId: true,
            type: true,
            status: true,
            attemptCount: true,
            leaseUntil: true,
          },
        });
        if (!message)
          throw new ApiError("NOT_FOUND", 404, "Mensagem não encontrada.");
        // A residual lease may still represent a worker capable of dispatching
        // this message. Recovery belongs in the worker and must prove that the
        // reserved attempt was not dispatched before releasing the lease.
        if (message.status !== "FAILED" || message.leaseUntil !== null)
          throw messageStateConflict();

        const now = new Date();
        if (!(await resolveWhatsAppDeliveryEligibility(tx, message, now)))
          throw messageStateConflict();

        const latestAttempt = await tx.whatsAppMessageAttempt.findFirst({
          where: { messageId: message.id },
          orderBy: { number: "desc" },
          select: { number: true },
        });
        const attemptNumber =
          Math.max(message.attemptCount, latestAttempt?.number ?? 0) + 1;
        const attempt = await tx.whatsAppMessageAttempt.create({
          data: {
            organizationId,
            messageId: message.id,
            number: attemptNumber,
            origin: "MANUAL",
            idempotencyKey: key,
            requestedById: actorUserId,
            startedAt: now,
          },
          select: { id: true },
        });

        const queued = await tx.whatsAppMessage.updateMany({
          where: {
            id: message.id,
            organizationId,
            status: "FAILED",
            leaseUntil: null,
          },
          data: {
            status: "QUEUED",
            nextAttemptAt: now,
            uncertainAt: null,
          },
        });
        if (queued.count !== 1) throw messageStateConflict();

        await recordAuditEvent(
          tx,
          {
            organizationId,
            actorUserId,
            action: "WHATSAPP_MESSAGE_RESEND_AUTHORIZED",
            targetType: "WHATSAPP_MESSAGE",
            targetId: message.id,
            metadata: {
              attemptId: attempt.id,
              attemptNumber,
              operation: "MANUAL_RESEND",
            },
          },
          { requirePersistence: true },
        );

        return queuedManualResend;
      });
    } catch (error) {
      if (classifyManualResendUniqueConflict(error) !== "IDEMPOTENCY_KEY")
        throw error;

      const replay = await this.prisma.whatsAppMessageAttempt.findFirst({
        where: { organizationId, idempotencyKey: key },
        select: { messageId: true },
      });
      if (!replay) throw error;
      if (replay.messageId !== messageId) throw idempotencyConflict();
      return queuedManualResend;
    }
  }

  async list(organizationId: string, query: typeof messageQuery.static) {
    const limit = query.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Limite de paginação inválido.",
      );
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime())) ||
      (from && to && from.getTime() > to.getTime())
    )
      throw new ApiError("VALIDATION_ERROR", 400, "Período inválido.");
    const where: Prisma.WhatsAppMessageWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(from || to
        ? {
            sentAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    };
    if (query.cursor) {
      const cursor = await this.prisma.whatsAppMessage.findFirst({
        where: { id: query.cursor, ...where },
        select: { id: true },
      });
      if (!cursor)
        throw new ApiError("VALIDATION_ERROR", 400, "Cursor inválido.");
    }
    const rows = await this.prisma.whatsAppMessage.findMany({
      where,
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [
        { sentAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      select: {
        id: true,
        type: true,
        status: true,
        patientId: true,
        appointmentId: true,
        createdAt: true,
        sentAt: true,
        errorCode: true,
        errorReason: true,
        patient: { select: { phone: true } },
      },
    });
    const hasNext = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      items: page.map(({ patient, createdAt, sentAt, ...row }) => ({
        ...row,
        phoneMasked: maskPatientPhone(patient.phone),
        createdAt: createdAt.toISOString(),
        sentAt: sentAt?.toISOString() ?? null,
      })),
      nextCursor: hasNext ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async preference(
    organizationId: string,
    patientId: string,
    actorUserId: string,
    body: typeof preferenceBody.static,
  ) {
    const source = body.source.trim();
    if (!source)
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "A origem da preferência é obrigatória.",
      );
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, organizationId },
      select: { id: true },
    });
    if (!patient)
      throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.whatsAppPreference.upsert({
        where: { patientId },
        create: {
          organizationId,
          patientId,
          optedIn: body.whatsappOptIn,
          source,
          recordedById: actorUserId,
          recordedAt: now,
        },
        update: {
          optedIn: body.whatsappOptIn,
          source,
          recordedById: actorUserId,
          recordedAt: now,
        },
      });
      if (!body.whatsappOptIn)
        await cancelQueuedPatientMessages(tx, organizationId, patientId);
      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: "WHATSAPP_PREFERENCE_UPDATED",
          targetType: "PATIENT",
          targetId: patientId,
          metadata: { optedIn: body.whatsappOptIn, source },
        },
      });
    });
    return { whatsappOptIn: body.whatsappOptIn, recordedAt: now.toISOString() };
  }

  async webhook(
    raw: string,
    signature: string | null,
    requestId: string | null,
    timestamp: string | null,
    secret: string | null | undefined,
  ) {
    if (!verifyWahaWebhook(raw, signature, secret))
      throw new ApiError("UNAUTHORIZED", 401, "Webhook não autorizado.");
    if (
      !requestId ||
      requestId.length > 200 ||
      !timestamp ||
      !/^\d{13}$/.test(timestamp) ||
      Math.abs(Date.now() - Number(timestamp)) > 300_000
    )
      throw new ApiError("UNAUTHORIZED", 401, "Webhook não autorizado.");
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ApiError("VALIDATION_ERROR", 400, "Webhook inválido.");
    }
    if (!value || typeof value !== "object")
      throw new ApiError("VALIDATION_ERROR", 400, "Webhook inválido.");
    const event = value as {
      event?: unknown;
      session?: unknown;
      payload?: { id?: unknown; ackName?: unknown; ack?: unknown };
    };
    if (event.event !== "message.ack") return { accepted: true };
    const providerMessageId = event.payload?.id;
    if (
      typeof event.session !== "string" ||
      event.session.length === 0 ||
      typeof providerMessageId !== "string" ||
      providerMessageId.length === 0 ||
      typeof event.payload?.ackName !== "string" ||
      !(event.payload.ackName in wahaAckValues)
    )
      throw new ApiError("VALIDATION_ERROR", 400, "Webhook inválido.");
    const ackName = event.payload.ackName as keyof typeof wahaAckValues;
    if (
      event.payload.ack !== undefined &&
      event.payload.ack !== wahaAckValues[ackName]
    )
      throw new ApiError("VALIDATION_ERROR", 400, "Webhook inválido.");
    const nextStatus = messageStatusByAck[ackName];
    const binding = await this.prisma.whatsAppSession.findFirst({
      where: { providerSessionName: event.session },
      select: { organizationId: true },
    });
    if (!binding)
      throw new ApiError("NOT_FOUND", 404, "Sessão não encontrada.");
    if (!nextStatus) return { accepted: true };
    const providerMessageHash = hashProviderMessageId(providerMessageId);
    const providerEventId = hashWebhookEvent(raw);
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockWhatsAppProviderMessage(
          tx,
          binding.organizationId,
          providerMessageHash,
        );
        const duplicate = await tx.whatsAppWebhookEvent.findUnique({
          where: {
            organizationId_providerEventId: {
              organizationId: binding.organizationId,
              providerEventId,
            },
          },
          select: { providerMessageHash: true, status: true },
        });
        if (duplicate) {
          if (
            duplicate.providerMessageHash !== providerMessageHash ||
            duplicate.status !== nextStatus
          )
            return;
        }
        let attempt = await findWhatsAppAttemptByProviderHash(
          tx,
          binding.organizationId,
          providerMessageHash,
        );
        const message = await tx.whatsAppMessage.findFirst({
          where: attempt
            ? {
                id: attempt.messageId,
                organizationId: binding.organizationId,
              }
            : {
                organizationId: binding.organizationId,
                providerMessageHash,
              },
          select: { id: true, status: true, sentAt: true },
        });
        if (!attempt && message)
          attempt = await findWhatsAppAttemptByProviderHash(
            tx,
            binding.organizationId,
            providerMessageHash,
            message.id,
          );
        const scopedAttempt =
          attempt?.organizationId === binding.organizationId ? attempt : null;
        if (!duplicate)
          await tx.whatsAppWebhookEvent.create({
            data: {
              organizationId: binding.organizationId,
              providerEventId,
              providerMessageHash,
              messageId: message?.id ?? null,
              attemptId: scopedAttempt?.id ?? null,
              status: nextStatus,
            },
          });
        if (!message) return;
        await reconcileWhatsAppWebhookEvents(
          tx,
          binding.organizationId,
          providerMessageHash,
          message,
          attempt,
        );
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
    return { accepted: true };
  }
}
