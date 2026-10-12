import { t } from "elysia";

const date = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
export const uuid = t.String({
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

export const confirmationDecisionStatus = t.Union([
  t.Literal("PENDING"),
  t.Literal("CONFIRMED"),
  t.Literal("DECLINED"),
]);

export const confirmationDecisionOrigin = t.Union([
  t.Literal("PHONE_CALL"),
  t.Literal("WHATSAPP_MANUAL"),
  t.Literal("IN_PERSON"),
  t.Literal("OTHER"),
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

export const pendingConfirmationsQuery = t.Object({
  status: t.Optional(confirmationDecisionStatus),
  professionalId: t.Optional(uuid),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
  cursor: t.Optional(uuid),
});

export const optionalIdempotencyHeaders = t.Object(
  {
    "idempotency-key": t.Optional(t.String({ minLength: 8, maxLength: 128 })),
  },
  { additionalProperties: true },
);

export const confirmationDecisionParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  appointmentId: uuid,
});

export const confirmationDecisionBody = t.Object(
  {
    decision: confirmationDecisionStatus,
    origin: t.Optional(confirmationDecisionOrigin),
    source: t.Optional(confirmationDecisionOrigin),
    note: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
    originalMessage: t.Optional(t.Never()),
    originalMessageId: t.Optional(t.Never()),
    originalMessageAt: t.Optional(t.Never()),
    decidedById: t.Optional(t.Never()),
    decidedAt: t.Optional(t.Never()),
    organizationId: t.Optional(t.Never()),
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

export const confirmationItem = t.Object({
  id: t.String(),
  appointmentId: t.String(),
  organizationId: t.String(),
  patientId: t.String(),
  professionalId: t.String(),
  scheduledAt: t.String(),
  localScheduledAt: t.String(),
  durationMinutes: t.Integer(),
  appointmentStatus: appointmentStatus,
  status: confirmationDecisionStatus,
  decision: confirmationDecisionStatus,
  origin: t.Nullable(confirmationDecisionOrigin),
  source: t.Nullable(confirmationDecisionOrigin),
  originalMessage: t.Nullable(t.String()),
  originalMessageId: t.Nullable(t.String()),
  originalMessageAt: t.Nullable(t.String()),
  note: t.Nullable(t.String()),
  decidedById: t.Nullable(t.String()),
  decidedAt: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const pendingConfirmationsResponse = t.Object({
  timeZone: t.String(),
  data: t.Array(confirmationItem),
  pageInfo: t.Object({
    nextCursor: t.Nullable(t.String()),
    hasNextPage: t.Boolean(),
  }),
});

export const confirmationDecisionResponse = t.Object({
  confirmation: confirmationItem,
});

export type ListQuery = typeof listQuery.static;
export type AvailabilityQuery = typeof availabilityQuery.static;
export type PendingConfirmationsQuery = typeof pendingConfirmationsQuery.static;
export type ConfirmationDecisionBody = typeof confirmationDecisionBody.static;
export type ConfirmationItem = typeof confirmationItem.static;
export type PendingConfirmationsResponse =
  typeof pendingConfirmationsResponse.static;
export type ConfirmationDecisionResponse =
  typeof confirmationDecisionResponse.static;
