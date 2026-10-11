"use server";

import { z } from "zod";
import type {
  ActionResult,
  LoginInput,
  LoginResult,
  RegisterInput,
  ResetPasswordInput,
} from "../../lib/auth";
import { ApiRequestError, postApi } from "../../server/api-client";
import { clearSession, saveSession } from "../../server/session";

const email = z.string().trim().email().max(254);
const password = z.string().min(8).max(72);
const token = z.string().min(1).max(200);
const emailInput = z.object({ email });
const tokenInput = z.object({ token });
const loginInput = z.object({ email, password: z.string().min(1).max(72) });
const registerInput = z.object({
  fullName: z.string().trim().min(3).max(120),
  email,
  password,
  acceptedTerms: z.literal(true),
});
const resetInput = z.object({ token, newPassword: password });

const messageResponse = z.object({ message: z.string() });
const loginResponse = z.object({
  token: z.string().min(1),
  user: z.object({
    id: z.string().min(1),
    email: z.string().email(),
    fullName: z.string(),
  }),
  availableOrganizations: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      slug: z.string().min(1),
      role: z.enum(["ADMIN", "PROFESSIONAL", "RECEPTIONIST"]),
      isOwner: z.boolean(),
    }),
  ),
  activeOrganization: z
    .object({ id: z.string().min(1), slug: z.string().min(1) })
    .nullable()
    .optional(),
  onboardingCompleted: z.boolean(),
  onboardingCurrentStep: z.string(),
  pendingInviteId: z.string().nullable().optional(),
});

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApiRequestError("VALIDATION_ERROR");
  return parsed.data;
}

async function runAction<T>(
  operation: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    const failure =
      error instanceof ApiRequestError
        ? error
        : new ApiRequestError("UPSTREAM_UNAVAILABLE");
    return {
      ok: false,
      error: { code: failure.code, message: failure.message },
    };
  }
}

// Operações públicas: o Elysia valida credenciais/tokens e limita reenvios.
export async function loginAction(
  input: LoginInput,
): Promise<ActionResult<LoginResult>> {
  return runAction(async () => {
    const result = await postApi(
      "/auth/login",
      validate(loginInput, input),
      loginResponse,
    );
    await saveSession(result.token);
    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        fullName: result.user.fullName,
      },
      availableOrganizations: result.availableOrganizations.map(
        (organization) => ({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          role: organization.role,
          isOwner: organization.isOwner,
        }),
      ),
      activeOrganization: result.activeOrganization ?? null,
      onboardingCompleted: result.onboardingCompleted,
      onboardingCurrentStep: result.onboardingCurrentStep,
      ...(result.pendingInviteId
        ? { pendingInviteId: result.pendingInviteId }
        : {}),
    };
  });
}

export async function registerAction(input: RegisterInput) {
  return runAction(async () => {
    const validated = validate(registerInput, input);
    await postApi(
      "/auth/register",
      {
        fullName: validated.fullName,
        email: validated.email,
        password: validated.password,
      },
      messageResponse,
    );
    return { message: "Confira seu e-mail para continuar o cadastro." };
  });
}

export async function verifyEmailAction(input: { token: string }) {
  return runAction(async () => {
    const result = await postApi(
      "/auth/verify-email",
      validate(tokenInput, input),
      loginResponse,
    );
    await saveSession(result.token);
    return {
      user: result.user,
      availableOrganizations: result.availableOrganizations,
      activeOrganization: result.activeOrganization ?? null,
      onboardingCompleted: result.onboardingCompleted,
      onboardingCurrentStep: result.onboardingCurrentStep,
      ...(result.pendingInviteId
        ? { pendingInviteId: result.pendingInviteId }
        : {}),
    };
  });
}

export async function resendVerificationAction(input: { email: string }) {
  return runAction(async () => {
    await postApi(
      "/auth/resend-verification",
      validate(emailInput, input),
      messageResponse,
    );
    return {
      message: "Se a conta estiver pendente, um novo link será enviado.",
    };
  });
}

export async function forgotPasswordAction(input: { email: string }) {
  return runAction(async () => {
    await postApi(
      "/auth/forgot-password",
      validate(emailInput, input),
      messageResponse,
    );
    return {
      message:
        "Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.",
    };
  });
}

export async function resetPasswordAction(input: ResetPasswordInput) {
  return runAction(async () => {
    await postApi(
      "/auth/reset-password",
      validate(resetInput, input),
      messageResponse,
    );
    await clearSession();
    return {
      message: "Senha redefinida. Suas sessões anteriores foram encerradas.",
    };
  });
}
