"use server";

import type { NotificationPreference } from "@/lib/notification-preferences";
import { updateNotificationPreferences } from "@/server/notification-preferences";

export async function updateNotificationPreferencesAction(
  preferences: NotificationPreference[],
) {
  try {
    const data = await updateNotificationPreferences(preferences);
    return { ok: true as const, data };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Não foi possível salvar as preferências.",
    };
  }
}
