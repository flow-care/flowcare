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

export type CreatePatientBody = typeof createPatientBody.static;
export type PatientResponse = typeof patientResponse.static;
