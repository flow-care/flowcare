import { t } from "elysia";

const date = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const isoUtcDateTime = t.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,3})?)?Z$",
});
const nonBlankKey = "^\\s*\\S(?:[\\s\\S]*\\S)?\\s*$";
const uuid = t.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});

export const organizationParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});

export const idempotencyHeaders = t.Object(
  {
    "idempotency-key": t.String({
      minLength: 1,
      maxLength: 128,
      pattern: nonBlankKey,
    }),
  },
  { additionalProperties: true },
);

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

export const createAppointmentBody = t.Object(
  {
    patientId: uuid,
    professionalId: uuid,
    scheduledAt: isoUtcDateTime,
    durationMinutes: t.Integer({ minimum: 1, maximum: 1440 }),
    notes: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
  },
  { additionalProperties: false },
);

export const appointment = t.Object({
  id: t.String(),
  patientId: t.String(),
  professionalId: t.String(),
  scheduledAt: t.String(),
  localScheduledAt: t.String(),
  durationMinutes: t.Integer(),
  status: appointmentStatus,
});

export const createdAppointment = t.Object({
  id: t.String(),
  patientId: t.String(),
  professionalId: t.String(),
  scheduledAt: t.String(),
  endsAt: t.String(),
  localScheduledAt: t.String(),
  localEndsAt: t.String(),
  durationMinutes: t.Integer(),
  status: appointmentStatus,
  notes: t.Nullable(t.String()),
  createdAt: t.String(),
});

export const createAppointmentResponse = t.Object({
  timeZone: t.String(),
  appointment: createdAppointment,
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
export type CreateAppointmentBody = typeof createAppointmentBody.static;
export type CreateAppointmentResponse = typeof createAppointmentResponse.static;
