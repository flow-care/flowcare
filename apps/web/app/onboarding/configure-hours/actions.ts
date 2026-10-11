"use server";

import type { SchedulePayload } from "@/server/onboarding-hours";
import { saveOnboardingHours } from "@/server/onboarding-hours";

export async function saveHoursAction(input: SchedulePayload) {
  try {
    await saveOnboardingHours(input);
    return { ok: true as const };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Não foi possível salvar os horários.",
    };
  }
}
