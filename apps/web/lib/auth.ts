import { onboardingStepPath } from "./onboarding-steps";

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  role: "ADMIN" | "ADMIN_PROFESSIONAL" | "PROFESSIONAL" | "RECEPTIONIST";
  isOwner: boolean;
};

export type LoginResult = {
  user: { id: string; email: string; fullName: string };
  availableOrganizations: OrganizationSummary[];
  activeOrganization?: { id: string; slug: string } | null;
  onboardingCompleted: boolean;
  onboardingCurrentStep: string;
  pendingInviteId?: string | null;
};

export type LoginInput = { email: string; password: string };
export type RegisterInput = LoginInput & {
  fullName: string;
  acceptedTerms: true;
};
export type ResetPasswordInput = { token: string; newPassword: string };
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export function safeReturnPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://flowcare.local");
    if (url.origin !== "https://flowcare.local") return null;
    if (
      url.pathname === "/app" ||
      url.pathname.startsWith("/app/") ||
      url.pathname.startsWith("/onboarding/") ||
      url.pathname === "/select-organization" ||
      url.pathname.startsWith("/accept-invite/")
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    return null;
  }
  return null;
}

export function destinationAfterLogin(
  result: LoginResult,
  returnTo: string | null,
): string {
  const safeReturnTo = safeReturnPath(returnTo);
  if (safeReturnTo?.startsWith("/accept-invite/")) {
    return safeReturnTo;
  }
  if (result.pendingInviteId) {
    return `/accept-invite/${encodeURIComponent(result.pendingInviteId)}`;
  }
  if (!result.onboardingCompleted) {
    return onboardingStepPath(result.onboardingCurrentStep);
  }
  if (safeReturnTo) return safeReturnTo;
  if (result.availableOrganizations.length === 1) {
    return `/app/${encodeURIComponent(result.availableOrganizations[0].slug)}/dashboard`;
  }
  const active = result.availableOrganizations.find(
    (organization) =>
      organization.id === result.activeOrganization?.id &&
      organization.slug === result.activeOrganization.slug,
  );
  if (active) return `/app/${encodeURIComponent(active.slug)}/dashboard`;
  return "/select-organization";
}

export function unwrapActionResult<T>(result: ActionResult<T>): T {
  if (!result.ok) {
    const error = new Error(result.error.message);
    error.name = result.error.code;
    throw error;
  }
  return result.data;
}
