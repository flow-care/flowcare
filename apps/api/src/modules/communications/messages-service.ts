import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type {
  Prisma,
  PrismaClient,
  WhatsAppMessageStatus,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type { messageQuery, preferenceBody } from "./model";

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

function webhookTransitionSources(
  nextStatus: WhatsAppMessageStatus,
): WhatsAppMessageStatus[] {
  switch (nextStatus) {
    case "SENT":
      return ["QUEUED", "UNCERTAIN"];
    case "DELIVERED":
      return ["QUEUED", "UNCERTAIN", "FAILED", "SENT"];
    case "READ":
      return ["QUEUED", "UNCERTAIN", "FAILED", "SENT", "DELIVERED"];
    case "FAILED":
      return ["QUEUED", "UNCERTAIN", "SENT"];
    default:
      return [];
  }
}

export class CommunicationsMessageService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(organizationId: string, query: typeof messageQuery.static) {
    const limit = query.limit ?? 25;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApiError("VALIDATION_ERROR", 400, "Limite de paginação inválido.");
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
      if (!body.whatsappOptIn) {
        await tx.whatsAppMessage.updateMany({
          where: {
            organizationId,
            patientId,
            status: "QUEUED",
            leaseUntil: null,
          },
          data: {
            status: "FAILED",
            errorCode: "OPTED_OUT",
            errorReason: "Preferência de WhatsApp revogada.",
          },
        });
      }
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
    const message = await this.prisma.whatsAppMessage.findFirst({
      where: {
        organizationId: binding.organizationId,
        providerMessageHash: hashProviderMessageId(providerMessageId),
      },
      select: { id: true, status: true },
    });
    if (!message) return { accepted: true };
    if (!nextStatus) return { accepted: true };
    const transitionSources = webhookTransitionSources(nextStatus);
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.whatsAppWebhookEvent.create({
          data: {
            providerEventId: requestId,
            messageId: message.id,
            status: nextStatus,
          },
        });
        if (transitionSources.includes(message.status))
          await tx.whatsAppMessage.updateMany({
            where: {
              id: message.id,
              organizationId: binding.organizationId,
              status: { in: transitionSources },
            },
            data:
              nextStatus === "FAILED"
                ? {
                    status: "FAILED",
                    uncertainAt: null,
                    errorCode: "WAHA_ACK_ERROR",
                    errorReason: "O provedor confirmou falha na entrega.",
                  }
                : {
                    status: nextStatus,
                    uncertainAt: null,
                    errorCode: null,
                    errorReason: null,
                  },
          });
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
    return { accepted: true };
  }
}
