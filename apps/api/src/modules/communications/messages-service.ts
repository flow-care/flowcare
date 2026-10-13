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

const rank: Record<WhatsAppMessageStatus, number> = {
  QUEUED: 0,
  FAILED: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
};

export class CommunicationsMessageService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(organizationId: string, query: typeof messageQuery.static) {
    const limit = query.limit ?? 25;
    if (query.from && query.to && query.from > query.to)
      throw new ApiError("VALIDATION_ERROR", 400, "Período inválido.");
    const where: Prisma.WhatsAppMessageWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.from || query.to
        ? {
            sentAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
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
      orderBy: [{ sentAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
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
          source: body.source.trim(),
          recordedById: actorUserId,
          recordedAt: now,
        },
        update: {
          optedIn: body.whatsappOptIn,
          source: body.source.trim(),
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
          metadata: { optedIn: body.whatsappOptIn, source: body.source.trim() },
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
    const ack = event.payload?.ackName;
    const nextStatus =
      ack === "READ" || ack === "PLAYED"
        ? "READ"
        : ack === "DEVICE"
          ? "DELIVERED"
          : ack === "SERVER"
            ? "SENT"
            : null;
    if (
      typeof event.session !== "string" ||
      typeof providerMessageId !== "string" ||
      !nextStatus
    )
      throw new ApiError("VALIDATION_ERROR", 400, "Webhook inválido.");
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
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.whatsAppWebhookEvent.create({
          data: {
            providerEventId: requestId,
            messageId: message.id,
            status: nextStatus,
          },
        });
        if (rank[message.status] < rank[nextStatus])
          await tx.whatsAppMessage.updateMany({
            where: {
              id: message.id,
              organizationId: binding.organizationId,
              status: {
                in: Object.keys(rank).filter(
                  (key) =>
                    rank[key as WhatsAppMessageStatus] < rank[nextStatus],
                ) as WhatsAppMessageStatus[],
              },
            },
            data: { status: nextStatus, errorCode: null, errorReason: null },
          });
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
    return { accepted: true };
  }
}
