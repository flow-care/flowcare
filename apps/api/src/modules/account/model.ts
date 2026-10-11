import { t } from "elysia";

/**
 * Schemas TypeBox para o módulo account (Issues #331, #332, #333 / docs/API_CONTRACT.md §3 Módulo 14).
 * Fontes de verdade tipadas para validação de entrada e saída.
 */

export const changePasswordBody = t.Object(
  {
    currentPassword: t.String({ minLength: 1, maxLength: 72 }),
    newPassword: t.String({ minLength: 8, maxLength: 72 }),
  },
  { additionalProperties: false },
);

export const changePasswordResponse = t.Object(
  {
    message: t.String(),
  },
  { additionalProperties: false },
);

export const sessionItem = t.Object(
  {
    id: t.String(),
    isCurrent: t.Boolean(),
    ipAddress: t.Nullable(t.String({ maxLength: 45 })),
    userAgent: t.Nullable(t.String({ maxLength: 32 })),
    lastActiveAt: t.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);

export const sessionsResponse = t.Object(
  {
    sessions: t.Array(sessionItem),
  },
  { additionalProperties: false },
);

export const sessionIdParams = t.Object(
  {
    sessionId: t.String({
      minLength: 1,
      maxLength: 200,
      pattern: "^\\S+$",
    }),
  },
  { additionalProperties: false },
);

export const revokeSessionParams = sessionIdParams;

export const revokeSessionResponse = t.Object(
  { revokedCount: t.Integer({ minimum: 0 }) },
  { additionalProperties: false },
);

export const sessionRevocationAction = t.Union([
  t.Literal("SINGLE"),
  t.Literal("OTHER"),
]);

export const profileResponse = t.Object(
  {
    id: t.String(),
    fullName: t.String(),
    email: t.String({ format: "email" }),
    photo: t.Nullable(
      t.Object({ contentType: t.String(), sizeBytes: t.Integer() }),
    ),
  },
  { additionalProperties: false },
);

export const activeOrganizationBody = t.Object(
  {
    orgSlug: t.String({
      minLength: 2,
      maxLength: 60,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    }),
  },
  { additionalProperties: false },
);
export const activeOrganizationResponse = t.Object({
  activeOrganization: t.Object({ id: t.String(), slug: t.String() }),
});
export const currentActiveOrganizationResponse = t.Object({
  activeOrganization: t.Nullable(
    t.Object({ id: t.String(), slug: t.String() }),
  ),
});
export type ActiveOrganizationBody = typeof activeOrganizationBody.static;

export const accountModels = {
  "account.changePasswordBody": changePasswordBody,
  "account.changePasswordResponse": changePasswordResponse,
  "account.sessionsResponse": sessionsResponse,
  "account.sessionIdParams": sessionIdParams,
  "account.revokeSessionResponse": revokeSessionResponse,
  "account.profileResponse": profileResponse,
} as const;

export type ChangePasswordBody = typeof changePasswordBody.static;
export type ChangePasswordResponse = typeof changePasswordResponse.static;
export type SessionItem = typeof sessionItem.static;
export type SessionsResponse = typeof sessionsResponse.static;
export type SessionIdParams = typeof sessionIdParams.static;
export type RevokeSessionParams = typeof revokeSessionParams.static;
export type RevokeSessionResponse = typeof revokeSessionResponse.static;
export type SessionRevocationAction = typeof sessionRevocationAction.static;
export type ProfileResponse = typeof profileResponse.static;

export const updateProfileBody = t.Object(
  {
    fullName: t.String({
      minLength: 3,
      maxLength: 120,
      pattern: "^\\s*\\S[\\s\\S]+\\S\\s*$",
    }),
    email: t.Optional(t.Never()),
    userId: t.Optional(t.Never()),
    id: t.Optional(t.Never()),
  },
  { additionalProperties: false },
);
export type UpdateProfileBody = typeof updateProfileBody.static;

export const profilePhotoBody = t.Object(
  {
    file: t.File({
      type: ["image/jpeg", "image/png"],
      minSize: 1,
      maxSize: "5m",
    }),
  },
  { additionalProperties: false },
);
export type ProfilePhotoBody = typeof profilePhotoBody.static;

export const profilePhotoUrlResponse = t.Object(
  {
    downloadUrl: t.String(),
    expiresInSeconds: t.Integer(),
  },
  { additionalProperties: false },
);
export type ProfilePhotoUrlResponse = typeof profilePhotoUrlResponse.static;
