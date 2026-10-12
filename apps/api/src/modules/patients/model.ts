import { t } from "elysia";
import { FormatRegistry } from "elysia/type-system";
import { isValidCpf } from "../../lib/cpf";

if (!FormatRegistry.Has("cpf")) FormatRegistry.Set("cpf", isValidCpf);

const NON_BLANK_NAME = "^\\s*\\S(?:[\\s\\S]*\\S)?\\s*$";
const PHONE_PATTERN = "^(?:\\D*\\d){10,13}\\D*$";
const ISO_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

export const ALLOWED_PATIENT_UPDATE_FIELDS = [
  "version",
  "fullName",
  "cpf",
  "birthDate",
  "phone",
  "distinctPersonConfirmed",
] as const;

export const PATIENT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PATIENT_ATTACHMENT_URL_TTL_SECONDS = 900;
export const PATIENT_ATTACHMENT_ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const patientOrganizationParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});

export const patientIdParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  id: t.String({ minLength: 1, maxLength: 128 }),
});

export const patientParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  patientId: t.String({
    minLength: 1,
    maxLength: 120,
    pattern: "^\\S+$",
  }),
});

export const patientAttachmentParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  id: t.String({ minLength: 1, maxLength: 128, pattern: "^\\S+$" }),
  attachmentId: t.String({ minLength: 1, maxLength: 128, pattern: "^\\S+$" }),
});

export const idempotencyHeaders = t.Object(
  {
    "idempotency-key": t.String({ minLength: 8, maxLength: 128 }),
  },
  { additionalProperties: true },
);

export const listPatientsQuery = t.Object({
  search: t.Optional(t.String({ maxLength: 160 })),
  q: t.Optional(t.String({ maxLength: 160 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
});

export const createPatientBody = t.Object(
  {
    fullName: t.String({
      minLength: 2,
      maxLength: 160,
      pattern: NON_BLANK_NAME,
    }),
    cpf: t.String({ minLength: 11, maxLength: 14, format: "cpf" }),
    birthDate: t.String({ pattern: ISO_DATE_PATTERN }),
    phone: t.String({ minLength: 10, maxLength: 20, pattern: PHONE_PATTERN }),
    distinctPersonConfirmed: t.Optional(t.Boolean()),
  },
  { additionalProperties: false },
);

const forbiddenPatientUpdateFields = {
  id: t.Optional(t.Never()),
  organizationId: t.Optional(t.Never()),
  createdAt: t.Optional(t.Never()),
  updatedAt: t.Optional(t.Never()),
  allergies: t.Optional(t.Never()),
  comorbidities: t.Optional(t.Never()),
  clinicalAlerts: t.Optional(t.Never()),
  medicalNotes: t.Optional(t.Never()),
  clinicalNotes: t.Optional(t.Never()),
  confidentialNotes: t.Optional(t.Never()),
  anamnesis: t.Optional(t.Never()),
  diagnosis: t.Optional(t.Never()),
  prescription: t.Optional(t.Never()),
  medications: t.Optional(t.Never()),
  clinicalRecord: t.Optional(t.Never()),
  clinicalHistory: t.Optional(t.Never()),
  chiefComplaint: t.Optional(t.Never()),
  evolution: t.Optional(t.Never()),
  cid: t.Optional(t.Never()),
  attachments: t.Optional(t.Never()),
  documents: t.Optional(t.Never()),
  consultations: t.Optional(t.Never()),
};

export const updatePatientBody = t.Object(
  {
    version: t.Integer({ minimum: 0 }),
    fullName: t.Optional(
      t.String({
        minLength: 2,
        maxLength: 160,
        pattern: NON_BLANK_NAME,
      }),
    ),
    cpf: t.Optional(t.String({ minLength: 11, maxLength: 14, format: "cpf" })),
    birthDate: t.Optional(t.String({ pattern: ISO_DATE_PATTERN })),
    phone: t.Optional(
      t.String({ minLength: 10, maxLength: 20, pattern: PHONE_PATTERN }),
    ),
    distinctPersonConfirmed: t.Optional(t.Boolean()),
    ...forbiddenPatientUpdateFields,
  },
  { additionalProperties: false },
);

export const patientResponse = t.Object({
  patient: t.Object({
    id: t.String(),
    fullName: t.String(),
    cpf: t.String(),
    birthDate: t.String(),
    phone: t.String(),
    version: t.Integer(),
    createdAt: t.String(),
    updatedAt: t.Optional(t.String()),
  }),
});

export const patientDetailItem = t.Object({
  id: t.String(),
  fullName: t.String(),
  cpf: t.String(),
  birthDate: t.String(),
  phone: t.String(),
  email: t.Nullable(t.String()),
  healthInsurance: t.Nullable(t.String()),
  insuranceNumber: t.Nullable(t.String()),
  version: t.Integer(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const listPatientsResponse = t.Object({
  data: t.Array(patientDetailItem),
  pageInfo: t.Object({
    nextCursor: t.Nullable(t.String()),
    hasNextPage: t.Boolean(),
  }),
});

export const patientDetailResponse = t.Object({
  patient: patientDetailItem,
});

export const upcomingPatientAppointmentItem = t.Object({
  id: t.String(),
  professionalId: t.String(),
  scheduledAt: t.String(),
  durationMinutes: t.Integer(),
  status: t.Union([
    t.Literal("RESERVED"),
    t.Literal("CONFIRMED"),
    t.Literal("CANCELLED"),
    t.Literal("COMPLETED"),
    t.Literal("NO_SHOW"),
  ]),
});

export const patientClinicalSummary = t.Object({
  allergies: t.Array(t.String()),
  comorbidities: t.Array(t.String()),
  clinicalAlerts: t.Array(t.String()),
  medicalNotes: t.Nullable(t.String()),
});

export const patientOverviewResponse = t.Object({
  patient: t.Object({
    id: t.String(),
    fullName: t.String(),
    cpf: t.String(),
    birthDate: t.String(),
    phone: t.String(),
    email: t.Nullable(t.String()),
    healthInsurance: t.Nullable(t.String()),
    insuranceNumber: t.Nullable(t.String()),
    version: t.Integer(),
  }),
  contact: t.Object({
    phone: t.String(),
    email: t.Nullable(t.String()),
  }),
  activeInsurance: t.Nullable(
    t.Object({
      name: t.String(),
      number: t.Nullable(t.String()),
    }),
  ),
  healthInsurance: t.Nullable(t.String()),
  insuranceNumber: t.Nullable(t.String()),
  upcomingAppointments: t.Array(upcomingPatientAppointmentItem),
  allergies: t.Optional(t.Array(t.String())),
  comorbidities: t.Optional(t.Array(t.String())),
  clinicalAlerts: t.Optional(t.Array(t.String())),
  medicalNotes: t.Optional(t.Nullable(t.String())),
  clinicalSummary: t.Optional(patientClinicalSummary),
});

export const uploadPatientAttachmentBody = t.Object(
  {
    file: t.File({
      type: [...PATIENT_ATTACHMENT_ALLOWED_TYPES],
      minSize: 1,
      maxSize: PATIENT_ATTACHMENT_MAX_BYTES,
    }),
    category: t.Optional(t.String({ maxLength: 64 })),
    description: t.Optional(t.String({ maxLength: 500 })),
  },
  { additionalProperties: false },
);

export const listPatientAttachmentsQuery = t.Object({
  includeArchived: t.Optional(t.Boolean()),
  category: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
});

export const archivePatientAttachmentBody = t.Optional(
  t.Object(
    {
      reason: t.Optional(
        t.String({
          minLength: 1,
          maxLength: 500,
          pattern: NON_BLANK_NAME,
        }),
      ),
    },
    { additionalProperties: false },
  ),
);

export const patientAttachmentItem = t.Object(
  {
    id: t.String(),
    attachmentId: t.String(),
    patientId: t.String(),
    fileName: t.String(),
    contentType: t.String(),
    sizeBytes: t.Integer(),
    category: t.Nullable(t.String()),
    description: t.Nullable(t.String()),
    uploadedById: t.String(),
    status: t.Union([t.Literal("ACTIVE"), t.Literal("ARCHIVED")]),
    archivedAt: t.Nullable(t.String()),
    archivedById: t.Nullable(t.String()),
    archiveReason: t.Nullable(t.String()),
    createdAt: t.String(),
  },
  { additionalProperties: false },
);

export const uploadPatientAttachmentResponse = t.Object(
  {
    attachmentId: t.String(),
    fileName: t.String(),
    contentType: t.String(),
    sizeBytes: t.Integer(),
    category: t.Nullable(t.String()),
    description: t.Nullable(t.String()),
    createdAt: t.String(),
    attachment: patientAttachmentItem,
  },
  { additionalProperties: false },
);

export const listPatientAttachmentsResponse = t.Object(
  {
    data: t.Array(patientAttachmentItem),
    attachments: t.Array(patientAttachmentItem),
  },
  { additionalProperties: false },
);

export const patientAttachmentDownloadUrlResponse = t.Object(
  {
    attachmentId: t.String(),
    downloadUrl: t.String(),
    expiresInSeconds: t.Integer(),
    expiresAt: t.String(),
  },
  { additionalProperties: false },
);

export const archivePatientAttachmentResponse = t.Object(
  {
    archived: t.Literal(true),
    attachment: patientAttachmentItem,
  },
  { additionalProperties: false },
);

export type ListPatientsQuery = typeof listPatientsQuery.static;
export type PatientParams = typeof patientParams.static;
export type CreatePatientBody = typeof createPatientBody.static;
export type UpdatePatientBody = typeof updatePatientBody.static;
export type PatientResponse = typeof patientResponse.static;
export type PatientDetailItem = typeof patientDetailItem.static;
export type ListPatientsResponse = typeof listPatientsResponse.static;
export type PatientDetailResponse = typeof patientDetailResponse.static;
export type PatientOverviewResponse = typeof patientOverviewResponse.static;
export type UploadPatientAttachmentBody =
  typeof uploadPatientAttachmentBody.static;
export type ListPatientAttachmentsQuery =
  typeof listPatientAttachmentsQuery.static;
export type ArchivePatientAttachmentBody =
  typeof archivePatientAttachmentBody.static;
export type PatientAttachmentItem = typeof patientAttachmentItem.static;
export type UploadPatientAttachmentResponse =
  typeof uploadPatientAttachmentResponse.static;
export type ListPatientAttachmentsResponse =
  typeof listPatientAttachmentsResponse.static;
export type PatientAttachmentDownloadUrlResponse =
  typeof patientAttachmentDownloadUrlResponse.static;
export type ArchivePatientAttachmentResponse =
  typeof archivePatientAttachmentResponse.static;
