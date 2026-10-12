import { t } from "elysia";

const date = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const uuid = t.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});

export const appointmentStatus = t.Union([
  t.Literal("RESERVED"),
  t.Literal("CONFIRMED"),
  t.Literal("CANCELLED"),
  t.Literal("COMPLETED"),
  t.Literal("NO_SHOW"),
]);

export const listQuery = t.Object({
  startDate: date,
  endDate: date,
  professionalId: t.Optional(uuid),
  status: t.Optional(appointmentStatus),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 50 })),
  cursor: t.Optional(uuid),
});

export const availabilityQuery = t.Object({
  date,
  professionalId: uuid,
});

export const appointment = t.Object({
  id: t.String(),
  patientId: t.String(),
  professionalId: t.String(),
  scheduledAt: t.String(),
  localScheduledAt: t.String(),
  durationMinutes: t.Integer(),
  status: appointmentStatus,
});

export const listResponse = t.Object({
  timeZone: t.String(),
  appointments: t.Array(appointment),
  nextCursor: t.Nullable(t.String()),
});

export const availabilitySlot = t.Object({
  startsAt: t.String(),
  endsAt: t.String(),
  localStartsAt: t.String(),
  localEndsAt: t.String(),
});

export const availabilityResponse = t.Object({
  date,
  professionalId: t.String(),
  timeZone: t.String(),
  slots: t.Array(availabilitySlot),
});

export type ListQuery = typeof listQuery.static;
export type AvailabilityQuery = typeof availabilityQuery.static;
