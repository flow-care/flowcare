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

export const patientOrganizationParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});

export const patientParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  patientId: t.String({
    minLength: 1,
    maxLength: 120,
    pattern: "^\\S+$",
  }),
});

export const idempotencyHeaders = t.Object(
  {
    "idempotency-key": t.String({ minLength: 8, maxLength: 128 }),
  },
  { additionalProperties: true },
);

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

export type PatientParams = typeof patientParams.static;
export type CreatePatientBody = typeof createPatientBody.static;
export type UpdatePatientBody = typeof updatePatientBody.static;
export type PatientResponse = typeof patientResponse.static;
