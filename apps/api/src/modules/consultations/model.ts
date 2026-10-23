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

export const consultationIdParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  consultationId: uuid,
});

export const startConsultationBody = t.Object({
  /** Opcional quando `appointmentId` é informado: a clínica resolve o paciente. */
  patientId: t.Optional(uuid),
  appointmentId: t.Optional(uuid),
  scheduledAt: t.Optional(t.String()),
  notes: t.Optional(t.String({ maxLength: 5000 })),
  professionalId: t.Optional(uuid),
});

export const anamnesisTopicsInput = t.Union([
  t.Record(t.String(), t.Nullable(t.String())),
  t.Array(
    t.Object({
      key: t.String(),
      value: t.Nullable(t.String()),
    }),
  ),
]);

export const saveConsultationDraftBody = t.Object({
  version: t.Integer({ minimum: 0 }),
  chiefComplaint: t.Optional(t.Nullable(t.String({ maxLength: 5000 }))),
  clinicalNotes: t.Optional(t.Nullable(t.String({ maxLength: 20000 }))),
  topics: t.Optional(anamnesisTopicsInput),
});

export const approveConsultationBody = t.Object({
  version: t.Integer({ minimum: 0 }),
  chiefComplaint: t.Optional(t.Nullable(t.String({ maxLength: 5000 }))),
  clinicalNotes: t.Optional(t.Nullable(t.String({ maxLength: 20000 }))),
  topics: t.Optional(anamnesisTopicsInput),
});

export const consultationDetailResponse = t.Object({
  id: t.String(),
  consultationId: t.String(),
  organizationId: t.String(),
  appointmentId: t.Nullable(t.String()),
  patientId: t.String(),
  professionalId: t.String(),
  scheduledAt: t.String(),
  localScheduledAt: t.Optional(t.String()),
  startedAt: t.Nullable(t.String()),
  completedAt: t.Nullable(t.String()),
  status: consultationStatus,
  anamnesisStatus: anamnesisStatus,
  anamnesisTopicRevisionId: t.Optional(t.Nullable(t.String())),
  chiefComplaint: t.Optional(t.Nullable(t.String())),
  clinicalNotes: t.Optional(t.Nullable(t.String())),
  anamnesisDraft: t.Optional(t.Nullable(t.Any())),
  draftSavedAt: t.Optional(t.Nullable(t.String())),
  draftSavedById: t.Optional(t.Nullable(t.String())),
  approvedAt: t.Optional(t.Nullable(t.String())),
  approvedById: t.Optional(t.Nullable(t.String())),
  signedBy: t.Optional(t.Nullable(t.String())),
  anamnesisSnapshot: t.Optional(t.Nullable(t.Any())),
  snapshotHash: t.Optional(t.Nullable(t.String())),
  version: t.Integer({ minimum: 0 }),
  createdAt: t.String(),
  updatedAt: t.String(),
  patient: t.Optional(consultationPatientSummary),
  professional: t.Optional(consultationProfessionalSummary),
  consultation: t.Optional(t.Any()),
});

export const approveConsultationResponse = t.Object({
  status: t.Literal("APPROVED"),
  signedBy: t.String(),
  approvedAt: t.String(),
  consultationId: t.String(),
  version: t.Integer({ minimum: 0 }),
  snapshotHash: t.String(),
  snapshot: t.Optional(t.Any()),
  consultation: t.Optional(consultationDetailResponse),
});

export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

export const uploadAudioBody = t.Object({
  audioFile: t.File({ maxSize: MAX_AUDIO_BYTES }),
  consentConfirmed: t.Union([t.String(), t.Boolean()]),
});

export const prepareAudioBody = t.Object({
  contentType: t.Union([
    t.Literal("audio/webm"),
    t.Literal("audio/mpeg"),
    t.Literal("audio/mp4"),
  ]),
  sizeBytes: t.Integer({ minimum: 1, maximum: MAX_AUDIO_BYTES }),
  consentConfirmed: t.Boolean(),
});

export const audioResponse = t.Object({
  audioId: t.String(),
  status: t.Literal("UPLOADED"),
});

export const prepareAudioResponse = t.Object({
  audioId: t.String(),
  uploadUrl: t.String(),
  expiresInSeconds: t.Literal(600),
  status: t.Literal("PENDING_UPLOAD"),
});

export const audioIdParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  consultationId: uuid,
  audioId: uuid,
});

const nonBlankKey = "^\\s*\\S(?:[\\s\\S]*\\S)?\\s*$";

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

export const transcriptionJobStatus = t.Union([
  t.Literal("QUEUED"),
  t.Literal("PROCESSING"),
  t.Literal("COMPLETED"),
  t.Literal("FAILED"),
]);

export const transcriptionResponse = t.Object({
  jobId: t.String(),
  status: transcriptionJobStatus,
});

/** Status do job com o texto quando concluído (usado pelo polling da web). */
export const transcriptionStatusResponse = t.Object({
  jobId: t.String(),
  status: transcriptionJobStatus,
  text: t.Optional(t.Nullable(t.String())),
  error: t.Optional(t.Nullable(t.String())),
});

export type OrgSlugParams = typeof orgSlugParams.static;
export type ConsultationIdParams = typeof consultationIdParams.static;
export type ConsultationStatus = typeof consultationStatus.static;
export type AnamnesisStatus = typeof anamnesisStatus.static;
export type ListConsultationsQuery = typeof listConsultationsQuery.static;
export type StartConsultationBody = typeof startConsultationBody.static;
export type ConsultationPatientSummary =
  typeof consultationPatientSummary.static;
export type ConsultationProfessionalSummary =
  typeof consultationProfessionalSummary.static;
export type ConsultationListItem = typeof consultationListItem.static;
export type ConsultationsPageInfo = typeof consultationsPageInfo.static;
export type ListConsultationsResponse = typeof listConsultationsResponse.static;
export type ConsultationDetailResponse =
  typeof consultationDetailResponse.static;
export type UploadAudioBody = typeof uploadAudioBody.static;
export type PrepareAudioBody = typeof prepareAudioBody.static;
export type IdempotencyHeaders = typeof idempotencyHeaders.static;
export type TranscriptionJobStatus = typeof transcriptionJobStatus.static;
export type TranscriptionResponse = typeof transcriptionResponse.static;
export type TranscriptionStatusResponse =
  typeof transcriptionStatusResponse.static;
export type AnamnesisTopicsInput = typeof anamnesisTopicsInput.static;
export type SaveConsultationDraftBody = typeof saveConsultationDraftBody.static;
export type ApproveConsultationBody = typeof approveConsultationBody.static;
export type ApproveConsultationResponse =
  typeof approveConsultationResponse.static;
