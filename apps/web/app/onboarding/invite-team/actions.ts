"use server";

import { inviteFormSchema } from "@/lib/invites";
import { getOnboardingProgress } from "@/server/onboarding";
import {
  completeOnboarding,
  createInvite,
  InviteApiError,
  listPendingInvites,
  resendInvite,
  revokeInvite,
} from "@/server/onboarding-invites";
import { getAvailableOrganizations } from "@/server/organizations";

async function authorizedSlug() {
  const progress = await getOnboardingProgress();
  if (
    !progress ||
    progress.completed ||
    progress.currentStep !== "TEAM_INVITES"
  ) {
    throw new InviteApiError(
      "STEP_UNAVAILABLE",
      "Esta etapa não está disponível.",
    );
  }
  const organizations = await getAvailableOrganizations();
  const id = progress.draftData.organizationId;
  const clinic = organizations?.find(
    (org) => org.role === "ADMIN" && org.id === id,
  );
  if (!clinic)
    throw new InviteApiError(
      "FORBIDDEN",
      "Você não tem acesso administrativo a esta clínica.",
    );
  return clinic.slug;
}

function failure(error: unknown) {
  return {
    ok: false as const,
    code: error instanceof InviteApiError ? error.code : "UNAVAILABLE",
    message:
      error instanceof Error
        ? error.message
        : "Não foi possível concluir a operação.",
  };
}

export async function sendTeamInvite(input: { email: string; role: string }) {
  const parsed = inviteFormSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      code: "VALIDATION_ERROR",
      message: parsed.error.issues[0]?.message ?? "Confira os dados.",
    };
  let slug: string | undefined;
  try {
    slug = await authorizedSlug();
    const allowed = await listPendingInvites(slug);
    if (!allowed.roles.includes(parsed.data.role)) {
      return {
        ok: false as const,
        code: "VALIDATION_ERROR",
        message: "Papel indisponível.",
      };
    }
    await createInvite(slug, parsed.data.email, parsed.data.role);
    return { ok: true as const, data: await listPendingInvites(slug) };
  } catch (error) {
    if (
      slug &&
      error instanceof InviteApiError &&
      error.code === "EMAIL_DELIVERY_FAILED"
    ) {
      const data = await listPendingInvites(slug).catch(() => null);
      return { ...failure(error), data };
    }
    return failure(error);
  }
}

export async function updateTeamInvite(
  id: string,
  operation: "resend" | "revoke",
) {
  let slug: string | undefined;
  try {
    slug = await authorizedSlug();
    if (operation === "resend") await resendInvite(slug, id);
    else await revokeInvite(slug, id);
    return { ok: true as const, data: await listPendingInvites(slug) };
  } catch (error) {
    if (
      slug &&
      error instanceof InviteApiError &&
      error.code === "EMAIL_DELIVERY_FAILED"
    ) {
      const data = await listPendingInvites(slug).catch(() => null);
      return { ...failure(error), data };
    }
    return failure(error);
  }
}

export async function finishTeamInvites() {
  try {
    await authorizedSlug();
    await completeOnboarding();
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}
