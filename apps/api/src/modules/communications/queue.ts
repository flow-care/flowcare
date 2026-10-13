import type {
  Prisma,
  WhatsAppMessageType,
} from "../../generated/prisma/client";

const PHONE = /^\d{10,13}$/;
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
  if (!patient || !PHONE.test(patient.phone.replace(/\D/g, ""))) return;
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

export async function cancelQueuedAppointmentMessages(
  tx: Prisma.TransactionClient,
  organizationId: string,
  appointmentId: string,
) {
  await tx.whatsAppMessage.updateMany({
    where: {
      organizationId,
      appointmentId,
      status: "QUEUED",
      leaseUntil: null,
    },
    data: {
      status: "FAILED",
      errorCode: "APPOINTMENT_CHANGED",
      errorReason: "Agendamento alterado antes do envio.",
    },
  });
}
