import { t } from "elysia";

export const slugParams = t.Object({
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
    pattern: "^\\s*\\S.*\\S\\s*$",
  }),
  taxId: t.String({ maxLength: 18 }),
  contactEmail: t.String({ format: "email", maxLength: 254 }),
  contactPhone: t.String({ minLength: 10, maxLength: 20 }),
  postalCode: t.String({ pattern: "^[0-9]{8}$" }),
  state: t.String({ pattern: "^[A-Za-z]{2}$" }),
  city: t.String({
    minLength: 2,
    maxLength: 100,
    pattern: "^\\s*\\S.*\\S\\s*$",
  }),
  district: t.String({
    minLength: 2,
    maxLength: 100,
    pattern: "^\\s*\\S.*\\S\\s*$",
  }),
  street: t.String({
    minLength: 2,
    maxLength: 160,
    pattern: "^\\s*\\S.*\\S\\s*$",
  }),
  streetNumber: t.String({
    minLength: 1,
    maxLength: 20,
    pattern: "^\\s*\\S.*$",
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

export type SlugParams = typeof slugParams.static;
export type OrganizationItem = typeof organizationItem.static;
export type OrganizationsResponse = typeof organizationsResponse.static;
export type ClinicDetailsBody = typeof clinicDetailsBody.static;
export type ClinicContactBody = typeof clinicContactBody.static;
export type ClinicAddressBody = typeof clinicAddressBody.static;
export type ClinicDetailsResponse = typeof clinicDetailsResponse.static;
