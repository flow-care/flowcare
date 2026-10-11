import { t } from "elysia";
import { FormatRegistry } from "elysia/type-system";
import { isValidOptionalCnpj } from "../../lib/cnpj";

if (!FormatRegistry.Has("cnpj")) {
  FormatRegistry.Set("cnpj", isValidOptionalCnpj);
}

const NON_BLANK_MIN_2_PATTERN = "^\\s*\\S[\\s\\S]*\\S\\s*$";
const NON_BLANK_MIN_1_PATTERN = "\\S";
const BR_PHONE_PATTERN = "^(?:\\D*\\d){10,13}\\D*$";
const BR_POSTAL_CODE_PATTERN = "^[0-9]{5}-?[0-9]{3}$";

export const orgSlugParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});

export const organizationItem = t.Object({
  id: t.String(),
  name: t.String(),
  slug: t.String(),
  role: t.Union([
    t.Literal("ADMIN"),
    t.Literal("ADMIN_PROFESSIONAL"),
    t.Literal("PROFESSIONAL"),
    t.Literal("RECEPTIONIST"),
  ]),
  status: t.Literal("ACTIVE"),
});

export const organizationsResponse = t.Object({
  data: t.Array(organizationItem),
});

export const createAdditionalOrganizationBody = t.Object(
  {
    name: t.String({
      minLength: 2,
      maxLength: 120,
      pattern: NON_BLANK_MIN_2_PATTERN,
    }),
  },
  { additionalProperties: false },
);

export const activeOrganizationResponse = t.Object({
  activeOrganization: t.Object({ id: t.String(), slug: t.String() }),
});

export const createAdditionalOrganizationResponse = t.Object({
  organization: t.Object({
    id: t.String(),
    name: t.String(),
    slug: t.String(),
    role: t.Literal("ADMIN"),
    isOwner: t.Literal(true),
  }),
  activeOrganization: t.Object({ id: t.String(), slug: t.String() }),
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
  postalCode: t.String({ pattern: BR_POSTAL_CODE_PATTERN }),
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

export const patchClinicSettingsBody = t.Object(
  {
    version: t.Integer({ minimum: 0 }),
    name: t.Optional(
      t.String({
        minLength: 2,
        maxLength: 120,
        pattern: NON_BLANK_MIN_2_PATTERN,
      }),
    ),
    legalName: t.Optional(
      t.String({
        minLength: 2,
        maxLength: 160,
        pattern: NON_BLANK_MIN_2_PATTERN,
      }),
    ),
    taxId: t.Optional(t.String({ maxLength: 18, format: "cnpj" })),
    contactEmail: t.Optional(t.String({ format: "email", maxLength: 254 })),
    contactPhone: t.Optional(
      t.String({
        minLength: 10,
        maxLength: 20,
        pattern: BR_PHONE_PATTERN,
      }),
    ),
    postalCode: t.Optional(t.String({ pattern: BR_POSTAL_CODE_PATTERN })),
    state: t.Optional(t.String({ pattern: "^[A-Za-z]{2}$" })),
    city: t.Optional(
      t.String({
        minLength: 2,
        maxLength: 100,
        pattern: NON_BLANK_MIN_2_PATTERN,
      }),
    ),
    district: t.Optional(
      t.String({
        minLength: 2,
        maxLength: 100,
        pattern: NON_BLANK_MIN_2_PATTERN,
      }),
    ),
    street: t.Optional(
      t.String({
        minLength: 2,
        maxLength: 160,
        pattern: NON_BLANK_MIN_2_PATTERN,
      }),
    ),
    streetNumber: t.Optional(
      t.String({
        minLength: 1,
        maxLength: 20,
        pattern: NON_BLANK_MIN_1_PATTERN,
      }),
    ),
    addressComplement: t.Optional(t.String({ maxLength: 100 })),
    id: t.Optional(t.Never()),
    organizationId: t.Optional(t.Never()),
    slug: t.Optional(t.Never()),
    ownerId: t.Optional(t.Never()),
  },
  { additionalProperties: false, minProperties: 2 },
);

export const putClinicSettingsBody = t.Object(
  {
    version: t.Integer({ minimum: 0 }),
    name: t.Optional(
      t.String({
        minLength: 2,
        maxLength: 120,
        pattern: NON_BLANK_MIN_2_PATTERN,
      }),
    ),
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
    postalCode: t.String({ pattern: BR_POSTAL_CODE_PATTERN }),
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
    id: t.Optional(t.Never()),
    organizationId: t.Optional(t.Never()),
    slug: t.Optional(t.Never()),
    ownerId: t.Optional(t.Never()),
  },
  { additionalProperties: false },
);

export const clinicLogoMetadata = t.Object(
  {
    contentType: t.String(),
    sizeBytes: t.Integer(),
    updatedAt: t.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);

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

export const clinicSettingsResponse = t.Object(
  {
    id: t.String(),
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
    logo: t.Nullable(clinicLogoMetadata),
  },
  { additionalProperties: false },
);

export const clinicLogoBody = t.Object(
  {
    file: t.File({
      type: ["image/jpeg", "image/png", "image/webp"],
      minSize: 1,
      maxSize: "5m",
    }),
  },
  { additionalProperties: false },
);

export const clinicLogoUrlResponse = t.Object(
  {
    downloadUrl: t.String(),
    expiresInSeconds: t.Integer(),
  },
  { additionalProperties: false },
);

export type OrgSlugParams = typeof orgSlugParams.static;
export type OrganizationItem = typeof organizationItem.static;
export type OrganizationsResponse = typeof organizationsResponse.static;
export type CreateAdditionalOrganizationBody =
  typeof createAdditionalOrganizationBody.static;
export type ClinicDetailsBody = typeof clinicDetailsBody.static;
export type ClinicContactBody = typeof clinicContactBody.static;
export type ClinicAddressBody = typeof clinicAddressBody.static;
export type PatchClinicSettingsBody = typeof patchClinicSettingsBody.static;
export type PutClinicSettingsBody = typeof putClinicSettingsBody.static;
export type ClinicLogoMetadata = typeof clinicLogoMetadata.static;
export type ClinicDetailsResponse = typeof clinicDetailsResponse.static;
export type ClinicSettingsResponse = typeof clinicSettingsResponse.static;
export type ClinicLogoBody = typeof clinicLogoBody.static;
export type ClinicLogoUrlResponse = typeof clinicLogoUrlResponse.static;
