import "server-only";

import type { AccountSession } from "@/lib/account-sessions";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export type ListSessionsResult =
  | { ok: true; sessions: AccountSession[] }
  | { ok: false; code: "UNAUTHENTICATED" | "UNAVAILABLE" };

export type RevokeSessionResult =
  | { ok: true; revokedCount: number }
  | { ok: false; code: "UNAUTHENTICATED" | "NOT_FOUND" | "UNAVAILABLE" };

export async function listAccountSessions(): Promise<ListSessionsResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, code: "UNAUTHENTICATED" };

  try {
    const { apiBaseUrl } = getServerConfig();
    const response = await fetch(`${apiBaseUrl}/me/sessions`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (!response.ok) {
      return { ok: false, code: "UNAVAILABLE" };
    }

    const data = (await response.json()) as { sessions: AccountSession[] };
    return { ok: true, sessions: data.sessions || [] };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function revokeAccountSession(
  sessionId: string,
): Promise<RevokeSessionResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, code: "UNAUTHENTICATED" };

  try {
    const { apiBaseUrl } = getServerConfig();
    const response = await fetch(
      `${apiBaseUrl}/me/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (response.status === 401) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (response.status === 404) {
      return { ok: false, code: "NOT_FOUND" };
    }
    if (!response.ok) {
      return { ok: false, code: "UNAVAILABLE" };
    }

    const data = (await response.json()) as { revokedCount: number };
    return { ok: true, revokedCount: data.revokedCount };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function revokeOtherAccountSessions(): Promise<RevokeSessionResult> {
  const token = await getSessionToken();
  if (!token) return { ok: false, code: "UNAUTHENTICATED" };

  try {
    const { apiBaseUrl } = getServerConfig();
    const response = await fetch(`${apiBaseUrl}/me/sessions/other`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status === 401) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (!response.ok) {
      return { ok: false, code: "UNAVAILABLE" };
    }

    const data = (await response.json()) as { revokedCount: number };
    return { ok: true, revokedCount: data.revokedCount };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
