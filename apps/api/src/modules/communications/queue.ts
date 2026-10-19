import type {
  Prisma,
  WhatsAppMessageType,
} from "../../generated/prisma/client";
import { normalizeWhatsAppDestination } from "./phone";

export async function enqueueAppointmentEvent(
  tx: Prisma.TransactionClient,
  event: {
    id: string;
    organizationId: string;
    patientId: string;
    scheduledAt: Date;
    version: number;
    type: WhatsAppMessageType;
  },
) {
  const preference = await tx.whatsAppPreference.findFirst({
    where: {
      organizationId: event.organizationId,
      patientId: event.patientId,
      optedIn: true,
    },
    select: { id: true },
  });
  if (!preference) return;
  const patient = await tx.patient.findFirst({
    where: { id: event.patientId, organizationId: event.organizationId },
    select: { phone: true },
  });
  if (!patient || !normalizeWhatsAppDestination(patient.phone)) return;
  const scheduledFor =
    event.type === "APPOINTMENT_REMINDER"
      ? new Date(event.scheduledAt.getTime() - 86_400_000)
      : new Date();
  if (event.type === "APPOINTMENT_REMINDER" && scheduledFor <= new Date())
    return;
  await tx.whatsAppMessage.create({
    data: {
      organizationId: event.organizationId,
      patientId: event.patientId,
      appointmentId: event.id,
      eventId: `${event.id}:${event.version}`,
      type: event.type,
      scheduledFor,
      nextAttemptAt: scheduledFor,
    },
  });
}

type LockedQueuedMessageRow = { id: string; attemptCount: number };

/**
 * Fails unclaimed QUEUED messages that stopped being eligible and closes any
 * MANUAL attempt reserved for them that was never dispatched.
 *
 * Lock protocol: callers have already written the preference/appointment row
 * (eligibility rows first), then message rows are locked in ascending id order,
 * the same order the manual worker uses (eligibility rows, then message). The
 * worker re-checks status/lease under that message lock before it fences
 * `dispatchedAt`, so either its fence wins (lease held, the message is skipped
 * here) or this cancellation wins and the worker's CAS finds the attempt closed.
 */
async function cancelQueuedMessages(
  tx: Prisma.TransactionClient,
  organizationId: string,
  rows: LockedQueuedMessageRow[],
  failure: { errorCode: string; errorReason: string; attemptReason: string },
  scope: { patientId: string } | { appointmentId: string },
) {
  if (rows.length === 0) return;
  const ids = rows.map((row) => row.id);
  const attemptCounts = new Map(rows.map((row) => [row.id, row.attemptCount]));

  const open = await tx.whatsAppMessageAttempt.findMany({
    where: {
      organizationId,
      messageId: { in: ids },
      origin: "MANUAL",
      completedAt: null,
    },
    orderBy: { number: "asc" },
    select: {
      id: true,
      messageId: true,
      number: true,
      startedAt: true,
      dispatchedAt: true,
      providerMessageHash: true,
    },
  });
  // A fenced attempt may have reached WAHA; its message is owned by the
  // dispatch/reconciliation protocol and must not be changed here.
  const fencedMessages = new Set(
    open
      .filter((attempt) => attempt.dispatchedAt || attempt.providerMessageHash)
      .map((attempt) => attempt.messageId),
  );
  const reserved = open.filter(
    (attempt) =>
      !fencedMessages.has(attempt.messageId) &&
      !attempt.dispatchedAt &&
      !attempt.providerMessageHash,
  );

  const highestCancelled = new Map<string, number>();
  for (const attempt of reserved) {
    if (attempt.number <= (attemptCounts.get(attempt.messageId) ?? 0)) continue;
    const cancelled = await tx.whatsAppMessageAttempt.updateMany({
      where: {
        id: attempt.id,
        organizationId,
        messageId: attempt.messageId,
        number: attempt.number,
        origin: "MANUAL",
        dispatchedAt: null,
        completedAt: null,
        providerMessageHash: null,
      },
      data: {
        completedAt: new Date(
          Math.max(Date.now(), attempt.startedAt.getTime()),
        ),
        errorCode: "MANUAL_RESEND_CANCELLED",
        errorReason: failure.attemptReason,
      },
    });
    if (cancelled.count !== 1)
      throw new Error("Reserved manual attempt cancellation lost its fence.");
    highestCancelled.set(
      attempt.messageId,
      Math.max(highestCancelled.get(attempt.messageId) ?? 0, attempt.number),
    );
  }

  for (const [messageId, attemptCount] of highestCancelled) {
    const failed = await tx.whatsAppMessage.updateMany({
      where: {
        id: messageId,
        organizationId,
        status: "QUEUED",
        leaseUntil: null,
      },
      data: {
        status: "FAILED",
        attemptCount,
        errorCode: failure.errorCode,
        errorReason: failure.errorReason,
      },
    });
    if (failed.count !== 1)
      throw new Error("Manual attempt cancellation lost its message.");
  }

  const remaining = ids.filter(
    (id) => !highestCancelled.has(id) && !fencedMessages.has(id),
  );
  if (remaining.length === 0) return;
  await tx.whatsAppMessage.updateMany({
    where: {
      organizationId,
      ...scope,
      id: { in: remaining },
      status: "QUEUED",
      leaseUntil: null,
    },
    data: {
      status: "FAILED",
      errorCode: failure.errorCode,
      errorReason: failure.errorReason,
    },
  });
}

export async function cancelQueuedAppointmentMessages(
  tx: Prisma.TransactionClient,
  organizationId: string,
  appointmentId: string,
) {
  const rows = await tx.$queryRaw<LockedQueuedMessageRow[]>`
    SELECT "id", "attemptCount"
    FROM "WhatsAppMessage"
    WHERE "organizationId" = ${organizationId}::uuid
      AND "appointmentId" = ${appointmentId}::uuid
      AND "status" = 'QUEUED'
      AND "leaseUntil" IS NULL
    ORDER BY "id"
    FOR UPDATE
  `;
  await cancelQueuedMessages(
    tx,
    organizationId,
    rows,
    {
      errorCode: "APPOINTMENT_CHANGED",
      errorReason: "Agendamento alterado antes do envio.",
      attemptReason:
        "Tentativa manual cancelada: agendamento alterado antes do envio.",
    },
    { appointmentId },
  );
}

export async function cancelQueuedPatientMessages(
  tx: Prisma.TransactionClient,
  organizationId: string,
  patientId: string,
) {
  const rows = await tx.$queryRaw<LockedQueuedMessageRow[]>`
    SELECT "id", "attemptCount"
    FROM "WhatsAppMessage"
    WHERE "organizationId" = ${organizationId}::uuid
      AND "patientId" = ${patientId}::uuid
      AND "status" = 'QUEUED'
      AND "leaseUntil" IS NULL
    ORDER BY "id"
    FOR UPDATE
  `;
  await cancelQueuedMessages(
    tx,
    organizationId,
    rows,
    {
      errorCode: "OPTED_OUT",
      errorReason: "Preferência de WhatsApp revogada.",
      attemptReason:
        "Tentativa manual cancelada: preferência de WhatsApp revogada.",
    },
    { patientId },
  );
}
