import { notFound } from "next/navigation";
import { canOpenSection } from "@/lib/app-navigation";
import {
  getTodayDateString,
  getWeekRange,
  isValidDateString,
} from "@/lib/appointments";
import {
  type AppointmentItem,
  getAppointments,
  getProfessionals,
  type ProfessionalItem,
} from "@/server/appointments";
import { getAvailableOrganizations } from "@/server/organizations";
import { getReceptionQueue, type ReceptionQueueItem } from "@/server/reception";
import { AppointmentsErrorState } from "./error-state";
import { AppointmentsSchedule } from "./schedule-client";

export default async function AppointmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    view?: string;
    date?: string;
    sheet?: string;
    appointmentId?: string;
    time?: string;
    slotTime?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const query = await searchParams;

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );
  if (!current || !canOpenSection(current.role, "appointments")) {
    notFound();
  }

  const view: "day" | "week" | "reception" =
    query.view === "reception"
      ? "reception"
      : query.view === "week"
        ? "week"
        : "day";
  const date = isValidDateString(query.date)
    ? query.date
    : getTodayDateString();

  let appointments: AppointmentItem[] = [];
  let receptionQueue: ReceptionQueueItem[] = [];
  let receptionError: string | null = null;
  let professionals: ProfessionalItem[] = [];
  let timeZone = "America/Sao_Paulo";
  let hasError = false;

  if (view === "reception") {
    try {
      const [queueResult, profs] = await Promise.all([
        getReceptionQueue(orgSlug, date),
        getProfessionals(orgSlug).catch(() => []),
      ]);
      receptionQueue = queueResult.queue ?? queueResult;
      professionals = profs;
    } catch (err) {
      receptionError =
        err instanceof Error
          ? err.message
          : "Não foi possível carregar a fila da recepção.";
    }
  } else {
    const { startDate, endDate } =
      view === "week" ? getWeekRange(date) : { startDate: date, endDate: date };

    try {
      const [result, profs] = await Promise.all([
        getAppointments(orgSlug, {
          startDate,
          endDate,
        }),
        getProfessionals(orgSlug).catch(() => []),
      ]);
      appointments = result.appointments ?? result;
      if (result.timeZone) {
        timeZone = result.timeZone;
      }
      professionals = profs;
    } catch {
      hasError = true;
    }
  }

  if (hasError) {
    return <AppointmentsErrorState />;
  }

  return (
    <AppointmentsSchedule
      orgSlug={orgSlug}
      view={view}
      date={date}
      appointments={appointments}
      receptionQueue={receptionQueue}
      receptionError={receptionError}
      sheet={query.sheet}
      appointmentId={query.appointmentId}
      slotTime={query.time ?? query.slotTime}
      timeZone={timeZone}
      professionals={professionals}
    />
  );
}
