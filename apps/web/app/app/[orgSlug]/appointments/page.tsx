import { notFound } from "next/navigation";
import { canOpenSection } from "@/lib/app-navigation";
import {
  getTodayDateString,
  getWeekRange,
  isValidDateString,
} from "@/lib/appointments";
import { type AppointmentItem, getAppointments } from "@/server/appointments";
import { getAvailableOrganizations } from "@/server/organizations";
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

  const view: "day" | "week" = query.view === "week" ? "week" : "day";
  const date = isValidDateString(query.date)
    ? query.date
    : getTodayDateString();

  const { startDate, endDate } =
    view === "week" ? getWeekRange(date) : { startDate: date, endDate: date };

  let appointments: AppointmentItem[] = [];
  let hasError = false;

  try {
    const result = await getAppointments(orgSlug, {
      startDate,
      endDate,
    });
    appointments = result.appointments ?? result;
  } catch {
    hasError = true;
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
      sheet={query.sheet}
      appointmentId={query.appointmentId}
    />
  );
}
