import "server-only";

import type { NotificationPreferencesResponse } from "@/lib/notification-preferences";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export class NotificationPreferencesError extends Error {}

async function requestPreferences(
  method: "GET" | "PUT",
  preferences?: NotificationPreferencesResponse["preferences"],
): Promise<NotificationPreferencesResponse> {
  const token = await getSessionToken();
  if (!token)
    throw new NotificationPreferencesError(
      "Sua sessão expirou. Entre novamente.",
    );

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/account/notifications/preferences`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(method === "PUT" ? { "Content-Type": "application/json" } : {}),
      },
      body:
        method === "PUT"
          ? JSON.stringify({
              preferences: preferences?.map(({ event, channel, enabled }) => ({
                event,
                channel,
                enabled,
              })),
            })
          : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new NotificationPreferencesError(
      "Não foi possível conectar ao serviço de notificações.",
    );
  }

  if (response.status === 401)
    throw new NotificationPreferencesError(
      "Sua sessão expirou. Entre novamente.",
    );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new NotificationPreferencesError(
      body?.error?.message ?? "Não foi possível salvar as preferências.",
    );
  }
  const body = (await response.json()) as NotificationPreferencesResponse;
  if (!Array.isArray(body.preferences))
    throw new NotificationPreferencesError(
      "Resposta inválida do serviço de notificações.",
    );
  return body;
}

export function getNotificationPreferences() {
  return requestPreferences("GET");
}

export function updateNotificationPreferences(
  preferences: NotificationPreferencesResponse["preferences"],
) {
  return requestPreferences("PUT", preferences);
}
