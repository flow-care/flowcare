"use server";

import { revalidatePath } from "next/cache";
import type { WeeklyScheduleRule } from "@/lib/schedules";
import {
  createScheduleException,
  deleteScheduleException,
  getWeeklySchedule,
  replaceWeeklySchedule,
  ScheduleApiError,
} from "@/server/schedules";

export async function addWeeklyRuleAction(
  orgSlug: string,
  newRule: WeeklyScheduleRule,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const current = await getWeeklySchedule(orgSlug);
    const updatedRules = [...current.rules, newRule];
    await replaceWeeklySchedule(orgSlug, updatedRules, current.timezone);
    revalidatePath(`/app/${orgSlug}/settings/schedules`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ScheduleApiError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "Não foi possível cadastrar o horário recorrente.",
    };
  }
}

export async function createScheduleExceptionAction(
  orgSlug: string,
  data: {
    professionalId?: string | null;
    startsAt: string;
    endsAt: string;
    reason?: string | null;
  },
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    await createScheduleException(orgSlug, data);
    revalidatePath(`/app/${orgSlug}/settings/schedules`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ScheduleApiError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "Não foi possível cadastrar o bloqueio pontual.",
    };
  }
}

export async function deleteScheduleExceptionAction(
  orgSlug: string,
  exceptionId: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    await deleteScheduleException(orgSlug, exceptionId);
    revalidatePath(`/app/${orgSlug}/settings/schedules`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ScheduleApiError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "Não foi possível excluir o bloqueio.",
    };
  }
}
export async function updateDayRulesAction(
  orgSlug: string,
  dayOfWeek: string,
  newRulesForDay: WeeklyScheduleRule[],
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const current = await getWeeklySchedule(orgSlug);
    const otherDaysRules = current.rules.filter(
      (r) => r.dayOfWeek !== dayOfWeek,
    );
    const updatedRules = [...otherDaysRules, ...newRulesForDay];
    await replaceWeeklySchedule(orgSlug, updatedRules, current.timezone);
    revalidatePath(`/app/${orgSlug}/settings/schedules`);
    return { ok: true };
  } catch (err) {
    if (err instanceof ScheduleApiError) {
      return { ok: false, code: err.code, message: err.message };
    }
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "Não foi possível atualizar a grade de horários.",
    };
  }
}

export async function deleteDayRulesAction(
  orgSlug: string,
  dayOfWeek: string,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  return updateDayRulesAction(orgSlug, dayOfWeek, []);
}
