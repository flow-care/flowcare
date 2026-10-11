import { t } from "elysia";

/**
 * Contrato do módulo auth (docs/API_CONTRACT.md §3 Módulo 1).
 * Schemas TypeBox são a fonte única: tipos derivam daqui.
 */

export const registerBody = t.Object({
  fullName: t.String({ minLength: 3, maxLength: 120 }),
  email: t.String({ format: "email", maxLength: 254 }),
  password: t.String({ minLength: 8, maxLength: 72 }),
});

export const verifyEmailBody = t.Object({
  token: t.String({ minLength: 1, maxLength: 200 }),
});

export const resendVerificationBody = t.Object({
  email: t.String({ format: "email", maxLength: 254 }),
});

export const loginBody = t.Object({
  email: t.String({ format: "email", maxLength: 254 }),
  password: t.String({ minLength: 1, maxLength: 72 }),
});

export const forgotPasswordBody = t.Object({
  email: t.String({ format: "email", maxLength: 254 }),
});

export const resetPasswordBody = t.Object({
  token: t.String({ minLength: 1, maxLength: 200 }),
  newPassword: t.String({ minLength: 8, maxLength: 72 }),
});

// Respostas públicas uniformes — nunca revelam existência de e-mail (#207/#209).
export const messageResponse = t.Object({
  message: t.String(),
});

export const organizationSummary = t.Object({
  id: t.String(),
  name: t.String(),
  slug: t.String(),
  role: t.Union([
    t.Literal("ADMIN"),
    t.Literal("ADMIN_PROFESSIONAL"),
    t.Literal("PROFESSIONAL"),
    t.Literal("RECEPTIONIST"),
  ]),
  /** true = clínica criada por este usuário (ele paga a assinatura). */
  isOwner: t.Boolean(),
});

export const loginResponse = t.Object({
  token: t.String(),
  user: t.Object({
    id: t.String(),
    email: t.String(),
    fullName: t.String(),
  }),
  availableOrganizations: t.Array(organizationSummary),
  activeOrganization: t.Nullable(
    t.Object({ id: t.String(), slug: t.String() }),
  ),
  onboardingCompleted: t.Boolean(),
  onboardingCurrentStep: t.String(),
  pendingInviteId: t.Optional(t.Nullable(t.String())),
});

export const errorResponse = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
  }),
});

export type RegisterBody = typeof registerBody.static;
export type LoginBody = typeof loginBody.static;
export type ForgotPasswordBody = typeof forgotPasswordBody.static;
export type ResetPasswordBody = typeof resetPasswordBody.static;
export type LoginResponse = typeof loginResponse.static;
