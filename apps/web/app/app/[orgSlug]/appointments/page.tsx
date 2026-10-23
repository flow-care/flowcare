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
import {
  getPendingConfirmations,
  type PendingConfirmationItem,
} from "@/server/confirmations";
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
    scope?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const query = await searchParams;

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );
  if (
    !current ||
    !canOpenSection(current.role, "appointments", current.permissions)
  ) {
    notFound();
  }

  const view: "day" | "week" | "reception" | "confirmations" =
    query.view === "confirmations"
      ? "confirmations"
      : query.view === "reception"
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
  let pendingConfirmations: PendingConfirmationItem[] = [];
  let professionals: ProfessionalItem[] = [];
  let timeZone = "America/Sao_Paulo";
  let hasError = false;

  // Escopo da agenda: só abre "clínica toda" para quem tem a permissão.
  const canSeeAllAgenda = (current.permissions ?? []).includes(
    "appointments:read_all",
  );
  // Quem atende abre no "Somente meu"; a recepção abre na clínica toda, senão
  // veria uma agenda vazia (não tem agendamentos próprios).
  const attendsPatients = (current.permissions ?? []).includes(
    "consultations:write",
  );
  const defaultScope: "mine" | "all" = attendsPatients ? "mine" : "all";
  const requestedScope =
    query.scope === "all"
      ? "all"
      : query.scope === "mine"
        ? "mine"
        : defaultScope;
  const scope: "mine" | "all" =
    requestedScope === "all" && !canSeeAllAgenda ? "mine" : requestedScope;

  if (view === "confirmations") {
    try {
      const [confirmationsResult, profs] = await Promise.all([
        getPendingConfirmations(orgSlug),
        getProfessionals(orgSlug).catch(() => []),
      ]);
      pendingConfirmations = confirmationsResult.data;
      professionals = profs;
    } catch {
      hasError = true;
    }
  } else if (view === "reception") {
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
          mine: scope === "mine",
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
      userRole={current.role}
      view={view}
      date={date}
      appointments={appointments}
      pendingConfirmations={pendingConfirmations}
      receptionQueue={receptionQueue}
      receptionError={receptionError}
      sheet={query.sheet}
      appointmentId={query.appointmentId}
      slotTime={query.time ?? query.slotTime}
      timeZone={timeZone}
      professionals={professionals}
      agendaScope={scope}
      canSeeAllAgenda={canSeeAllAgenda}
    />
  );
}
