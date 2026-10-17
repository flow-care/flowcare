import "server-only";

import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export type ChangePasswordResult =
  | { ok: true }
  | {
      ok: false;
      code: "INVALID_CREDENTIALS" | "UNAUTHENTICATED" | "UNAVAILABLE";
    };

export async function changeAccountPassword(payload: {
  currentPassword: string;
  newPassword: string;
}): Promise<ChangePasswordResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, code: "UNAUTHENTICATED" };

  try {
    const { apiBaseUrl } = getServerConfig();
    const response = await fetch(`${apiBaseUrl}/me/change-password`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) return { ok: true };
    const body: unknown = await response.json().catch(() => null);
    const code =
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      "code" in body.error
        ? body.error.code
        : undefined;
    if (response.status === 401 && code === "INVALID_CREDENTIALS") {
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }
    if (response.status === 401) return { ok: false, code: "UNAUTHENTICATED" };
  } catch {
    // Keep transport and server details out of the client.
  }
  return { ok: false, code: "UNAVAILABLE" };
}
