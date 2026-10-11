import { t } from "elysia";
import { FormatRegistry } from "elysia/type-system";
import { isValidOptionalCnpj } from "../../lib/cnpj";

if (!FormatRegistry.Has("cnpj")) {
  FormatRegistry.Set("cnpj", isValidOptionalCnpj);
}

const NON_BLANK_MIN_2_PATTERN = "^\\s*\\S[\\s\\S]*\\S\\s*$";
const NON_BLANK_MIN_1_PATTERN = "\\S";
const BR_PHONE_PATTERN = "^(?:\\D*\\d){10,13}\\D*$";

export const orgSlugParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});

export const organizationItem = t.Object({
  id: t.String(),
  name: t.String(),
  slug: t.String(),
  role: t.Union([
    t.Literal("ADMIN"),
    t.Literal("PROFESSIONAL"),
    t.Literal("RECEPTIONIST"),
  ]),
  status: t.Literal("ACTIVE"),
});

export const organizationsResponse = t.Object({
  data: t.Array(organizationItem),
});

export const clinicDetailsBody = t.Object({
  version: t.Integer({ minimum: 0 }),
  legalName: t.String({
    minLength: 2,
    maxLength: 160,
    pattern: NON_BLANK_MIN_2_PATTERN,
  }),
  taxId: t.String({ maxLength: 18, format: "cnpj" }),
  contactEmail: t.String({ format: "email", maxLength: 254 }),
  contactPhone: t.String({
    minLength: 10,
    maxLength: 20,
    pattern: BR_PHONE_PATTERN,
  }),
  postalCode: t.String({ pattern: "^[0-9]{8}$" }),
  state: t.String({ pattern: "^[A-Za-z]{2}$" }),
  city: t.String({
    minLength: 2,
    maxLength: 100,
    pattern: NON_BLANK_MIN_2_PATTERN,
  }),
  district: t.String({
    minLength: 2,
    maxLength: 100,
    pattern: NON_BLANK_MIN_2_PATTERN,
  }),
  street: t.String({
    minLength: 2,
    maxLength: 160,
    pattern: NON_BLANK_MIN_2_PATTERN,
  }),
  streetNumber: t.String({
    minLength: 1,
    maxLength: 20,
    pattern: NON_BLANK_MIN_1_PATTERN,
  }),
  addressComplement: t.String({ maxLength: 100 }),
});

export const clinicContactBody = t.Pick(clinicDetailsBody, [
  "version",
  "legalName",
  "taxId",
  "contactEmail",
  "contactPhone",
]);
export const clinicAddressBody = t.Pick(clinicDetailsBody, [
  "version",
  "postalCode",
  "state",
  "city",
  "district",
  "street",
  "streetNumber",
  "addressComplement",
]);

export const clinicDetailsResponse = t.Object({
  name: t.String(),
  slug: t.String(),
  version: t.Integer(),
  completed: t.Boolean(),
  legalName: t.String(),
  taxId: t.String(),
  contactEmail: t.String(),
  contactPhone: t.String(),
  postalCode: t.String(),
  state: t.String(),
  city: t.String(),
  district: t.String(),
  street: t.String(),
  streetNumber: t.String(),
  addressComplement: t.String(),
});

export type OrgSlugParams = typeof orgSlugParams.static;
export type OrganizationItem = typeof organizationItem.static;
export type OrganizationsResponse = typeof organizationsResponse.static;
export type ClinicDetailsBody = typeof clinicDetailsBody.static;
export type ClinicContactBody = typeof clinicContactBody.static;
export type ClinicAddressBody = typeof clinicAddressBody.static;
export type ClinicDetailsResponse = typeof clinicDetailsResponse.static;
