import { t } from "elysia";

const uuid = t.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});

const dateString = t.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
});

export const orgSlugParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});

export const consultationStatus = t.Union([
  t.Literal("SCHEDULED"),
  t.Literal("IN_PROGRESS"),
  t.Literal("COMPLETED"),
  t.Literal("CANCELLED"),
]);

export const anamnesisStatus = t.Union([
  t.Literal("PENDING"),
  t.Literal("DRAFT"),
  t.Literal("APPROVED"),
]);

export const listConsultationsQuery = t.Object({
  startDate: t.Optional(dateString),
  endDate: t.Optional(dateString),
  professionalId: t.Optional(uuid),
  patientId: t.Optional(uuid),
  status: t.Optional(consultationStatus),
  anamnesisStatus: t.Optional(anamnesisStatus),
  search: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  q: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
  page: t.Optional(t.Integer({ minimum: 1 })),
  cursor: t.Optional(uuid),
});

export const consultationPatientSummary = t.Object({
  id: t.String(),
  fullName: t.String(),
});

export const consultationProfessionalSummary = t.Object({
  id: t.String(),
  fullName: t.String(),
  professionalTitle: t.Nullable(t.String()),
  registrationNumber: t.Nullable(t.String()),
});

export const consultationListItem = t.Object({
  id: t.String(),
  appointmentId: t.Nullable(t.String()),
  patientId: t.String(),
  professionalId: t.String(),
  scheduledAt: t.String(),
  localScheduledAt: t.String(),
  startedAt: t.Nullable(t.String()),
  completedAt: t.Nullable(t.String()),
  status: consultationStatus,
  anamnesisStatus: anamnesisStatus,
  patient: consultationPatientSummary,
  professional: consultationProfessionalSummary,
  version: t.Integer({ minimum: 0 }),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const consultationsPageInfo = t.Object({
  limit: t.Integer({ minimum: 1, maximum: 100 }),
  page: t.Integer({ minimum: 1 }),
  totalCount: t.Integer({ minimum: 0 }),
  hasNextPage: t.Boolean(),
  nextCursor: t.Nullable(t.String()),
});

export const listConsultationsResponse = t.Object({
  timeZone: t.String(),
  data: t.Array(consultationListItem),
  items: t.Array(consultationListItem),
  pageInfo: consultationsPageInfo,
});

export type OrgSlugParams = typeof orgSlugParams.static;
export type ConsultationStatus = typeof consultationStatus.static;
export type AnamnesisStatus = typeof anamnesisStatus.static;
export type ListConsultationsQuery = typeof listConsultationsQuery.static;
export type ConsultationPatientSummary =
  typeof consultationPatientSummary.static;
export type ConsultationProfessionalSummary =
  typeof consultationProfessionalSummary.static;
export type ConsultationListItem = typeof consultationListItem.static;
export type ConsultationsPageInfo = typeof consultationsPageInfo.static;
export type ListConsultationsResponse = typeof listConsultationsResponse.static;
