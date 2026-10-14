import { notFound } from "next/navigation";
import { canOpenSection } from "@/lib/app-navigation";
import {
  getTodayDateString,
  getWeekRange,
  isValidDateString,
} from "@/lib/appointments";
import { type AppointmentItem, getAppointments } from "@/server/appointments";
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
  let hasError = false;

  if (view === "reception") {
    try {
      const result = await getReceptionQueue(orgSlug, date);
      receptionQueue = result.queue ?? result;
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
      const result = await getAppointments(orgSlug, {
        startDate,
        endDate,
      });
      appointments = result.appointments ?? result;
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
    />
  );
}
