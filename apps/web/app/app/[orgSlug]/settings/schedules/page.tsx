import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type {
  ScheduleExceptionsResponse,
  ScheduleProfessional,
  WeeklyScheduleResponse,
} from "@/lib/schedules";
import { getAvailableOrganizations } from "@/server/organizations";
import {
  getScheduleExceptions,
  getScheduleProfessionals,
  getWeeklySchedule,
  ScheduleApiError,
} from "@/server/schedules";
import { SchedulesError, SchedulesForbidden } from "./schedules-states";
import { SchedulesView } from "./schedules-view";

export const metadata: Metadata = {
  title: "Horários de Atendimento e Bloqueios | Flowcare",
};

export default async function SchedulesSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams?: Promise<{
    tab?: string;
    sheet?: string;
    scheduleId?: string;
    professionalId?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const query = (await searchParams) ?? {};

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find((org) => org.slug === orgSlug);

  if (!current) {
    notFound();
  }

  // Role check: Only ADMIN and ADMIN_PROFESSIONAL have access.
  if (current.role !== "ADMIN" && current.role !== "ADMIN_PROFESSIONAL") {
    return <SchedulesForbidden orgSlug={orgSlug} />;
  }

  let weeklySchedule: WeeklyScheduleResponse | null = null;
  let exceptionsData: ScheduleExceptionsResponse | null = null;
  let professionals: ScheduleProfessional[] = [];
  let hasError = false;
  let errorMessage: string | null = null;

  try {
    const [weeklyResult, exceptionsResult, profsResult] = await Promise.all([
      getWeeklySchedule(orgSlug),
      getScheduleExceptions(orgSlug),
      getScheduleProfessionals(orgSlug),
    ]);

    weeklySchedule = weeklyResult;
    exceptionsData = exceptionsResult;
    professionals = profsResult;
  } catch (err) {
    hasError = true;
    if (err instanceof ScheduleApiError && err.code === "FORBIDDEN") {
      return <SchedulesForbidden orgSlug={orgSlug} />;
    }
    errorMessage =
      err instanceof Error
        ? err.message
        : "Ocorreu um erro ao carregar os horários da clínica.";
  }

  if (hasError || !weeklySchedule || !exceptionsData) {
    return <SchedulesError orgSlug={orgSlug} errorMessage={errorMessage} />;
  }

  return (
    <SchedulesView
      orgSlug={orgSlug}
      weeklySchedule={weeklySchedule}
      exceptionsData={exceptionsData}
      professionals={professionals}
      initialTab={query.tab}
      initialSheet={query.sheet}
      initialScheduleId={query.scheduleId}
      initialProfessional={query.professionalId}
    />
  );
}
