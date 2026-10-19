import type { Prisma, WhatsAppMessage } from "../../generated/prisma/client";
import { normalizeWhatsAppDestination } from "./phone";

type DeliveryEligibilityClient = Pick<
  Prisma.TransactionClient,
  "appointment" | "whatsAppPreference"
>;

export type WhatsAppDeliveryCandidate = Pick<
  WhatsAppMessage,
  "appointmentId" | "eventId" | "organizationId" | "patientId" | "type"
>;

/**
 * Resolves the current delivery context while enforcing the same eligibility
 * rules used by the WhatsApp queue. The narrow client type accepts both the
 * regular Prisma client and an interactive transaction client.
 */
export async function resolveWhatsAppDeliveryEligibility(
  client: DeliveryEligibilityClient,
  message: WhatsAppDeliveryCandidate,
  now = new Date(),
) {
  const [preference, appointment] = await Promise.all([
    client.whatsAppPreference.findFirst({
      where: {
        organizationId: message.organizationId,
        patientId: message.patientId,
        optedIn: true,
      },
      select: { id: true },
    }),
    client.appointment.findFirst({
      where: {
        id: message.appointmentId,
        organizationId: message.organizationId,
        patientId: message.patientId,
      },
      include: {
        patient: { select: { fullName: true, phone: true } },
        organization: { select: { name: true, timezone: true } },
        professional: { select: { fullName: true } },
      },
    }),
  ]);
  if (!preference || !appointment) return null;

  const eventVersion = Number(message.eventId.split(":").at(-1));
  const appointmentStateIsCurrent =
    appointment.version === eventVersion &&
    (message.type === "APPOINTMENT_CANCELLED"
      ? appointment.status === "CANCELLED"
      : appointment.status === "RESERVED" ||
        appointment.status === "CONFIRMED");
  const reminderIsCurrent =
    message.type !== "APPOINTMENT_REMINDER" || appointment.scheduledAt > now;
  const destination = normalizeWhatsAppDestination(appointment.patient.phone);

  if (!appointmentStateIsCurrent || !reminderIsCurrent || !destination)
    return null;

  return { appointment, destination };
}
