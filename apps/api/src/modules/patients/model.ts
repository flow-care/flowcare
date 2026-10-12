import { t } from "elysia";
import { FormatRegistry } from "elysia/type-system";
import { isValidCpf } from "../../lib/cpf";

if (!FormatRegistry.Has("cpf")) FormatRegistry.Set("cpf", isValidCpf);

const NON_BLANK_NAME = "^\\s*\\S(?:[\\s\\S]*\\S)?\\s*$";
const PHONE_PATTERN = "^(?:\\D*\\d){10,13}\\D*$";
const ISO_DATE_PATTERN = "^\\d{4}-\\d{2}-\\d{2}$";

export const patientOrganizationParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});

export const patientIdParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  id: t.String({ minLength: 1, maxLength: 128 }),
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

export const patientResponse = t.Object({
  patient: t.Object({
    id: t.String(),
    fullName: t.String(),
    cpf: t.String(),
    birthDate: t.String(),
    phone: t.String(),
    version: t.Integer(),
    createdAt: t.String(),
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

export type ListPatientsQuery = typeof listPatientsQuery.static;
export type CreatePatientBody = typeof createPatientBody.static;
export type PatientResponse = typeof patientResponse.static;
export type PatientDetailItem = typeof patientDetailItem.static;
export type ListPatientsResponse = typeof listPatientsResponse.static;
export type PatientDetailResponse = typeof patientDetailResponse.static;
export type PatientOverviewResponse = typeof patientOverviewResponse.static;
