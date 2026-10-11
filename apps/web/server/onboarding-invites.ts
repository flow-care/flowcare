import "server-only";

import { pendingInvitesSchema } from "@/lib/invites";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export class InviteApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
) {
  const token = await getSessionToken();
  if (!token)
    throw new InviteApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new InviteApiError(
      "UNAVAILABLE",
      "Não foi possível acessar os convites. Tente novamente.",
    );
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      data && typeof data === "object" && "error" in data
        ? (data as { error?: { code?: string; message?: string } }).error
        : null;
    const code = error?.code ?? "UNAVAILABLE";
    throw new InviteApiError(
      code,
      error?.message ??
        "Não foi possível concluir a operação. Tente novamente.",
    );
  }
  return data;
}

function invitePath(slug: string) {
  return `/organizations/${encodeURIComponent(slug)}/invites`;
}

export async function listPendingInvites(slug: string) {
  const parsed = pendingInvitesSchema.safeParse(
    await request(invitePath(slug), "GET"),
  );
  if (!parsed.success)
    throw new InviteApiError(
      "UNAVAILABLE",
      "Não foi possível carregar os convites.",
    );
  return parsed.data;
}

export async function createInvite(slug: string, email: string, role: string) {
  await request(invitePath(slug), "POST", { email, role });
}

export async function resendInvite(slug: string, id: string) {
  await request(`${invitePath(slug)}/${encodeURIComponent(id)}/resend`, "POST");
}

export async function revokeInvite(slug: string, id: string) {
  await request(`${invitePath(slug)}/${encodeURIComponent(id)}`, "DELETE");
}

export async function completeOnboarding() {
  await request("/onboarding/complete", "POST");
}
