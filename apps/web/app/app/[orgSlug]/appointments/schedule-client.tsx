"use client";

import { cn } from "cn";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  PlusIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  addDays,
  formatAppointmentTime,
  formatDateLabel,
  formatWeekRangeLabel,
  getTodayDateString,
  getWeekRange,
  normalizeAppointmentStatus,
  SHORT_WEEKDAY_NAMES,
} from "@/lib/appointments";
import type { AppointmentItem, ProfessionalItem } from "@/server/appointments";
import type { PendingConfirmationItem } from "@/server/confirmations";
import type { ReceptionQueueItem } from "@/server/reception";
import { AppointmentDetailsSheet } from "./appointment-details-sheet";
import { EditAppointmentSheet } from "./edit-appointment-sheet";
import { NewAppointmentSheet } from "./new-appointment-sheet";
import { PendingConfirmationsView } from "./pending-confirmations-view";
import { ReceptionQueueView } from "./reception-queue-view";

interface AppointmentsScheduleProps {
  orgSlug: string;
  userRole?: string;
  view: "day" | "week" | "reception" | "confirmations";
  date: string;
  appointments: AppointmentItem[];
  pendingConfirmations?: PendingConfirmationItem[];
  sheet?: string;
  appointmentId?: string;
  slotTime?: string;
  timeZone?: string;
  professionals?: ProfessionalItem[];
  receptionQueue?: ReceptionQueueItem[];
  receptionError?: string | null;
}

export function AppointmentsSchedule({
  orgSlug,
  userRole,
  view,
  date,
  appointments,
  pendingConfirmations = [],
  sheet,
  appointmentId,
  slotTime,
  timeZone = "America/Sao_Paulo",
  professionals = [],
  receptionQueue,
  receptionError,
}: AppointmentsScheduleProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const today = getTodayDateString();

  const updateUrl = (updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // Date Navigation Handlers
  const handleToday = () => {
    updateUrl({ date: today });
  };

  const handlePrevious = () => {
    const step = view === "week" ? -7 : -1;
    updateUrl({ date: addDays(date, step) });
  };

  const handleNext = () => {
    const step = view === "week" ? 7 : 1;
    updateUrl({ date: addDays(date, step) });
  };

  // View Switch Handlers (Preserves Active Date!)
  const handleViewChange = (
    newView: "day" | "week" | "reception" | "confirmations",
  ) => {
    if (newView === view) return;
    updateUrl({ view: newView });
  };

  // Details Sheet Handlers
  const handleOpenDetails = (id: string) => {
    updateUrl({ sheet: "details", appointmentId: id });
  };

  const handleCloseDetails = () => {
    updateUrl({ sheet: undefined, appointmentId: undefined });
  };

  // Edit Appointment Sheet Handlers
  const [highlightedAppointmentId, setHighlightedAppointmentId] = useState<
    string | null
  >(null);

  const handleOpenEdit = (id: string) => {
    updateUrl({ sheet: "edit", appointmentId: id });
  };

  const handleCloseEdit = () => {
    updateUrl({ sheet: undefined, appointmentId: undefined });
  };

  const handleSuccessEdit = (newDate?: string, updatedId?: string) => {
    if (updatedId) {
      setHighlightedAppointmentId(updatedId);
      setTimeout(() => setHighlightedAppointmentId(null), 5000);
    }
    updateUrl({
      sheet: undefined,
      appointmentId: undefined,
      date: newDate ?? date,
    });
    router.refresh();
  };

  const isEditOpen = sheet === "edit" && Boolean(appointmentId);

  // New Appointment Sheet Handlers
  const handleOpenNew = (slotDate?: string, targetTime?: string) => {
    updateUrl({
      sheet: "new",
      date: slotDate ?? date,
      time: targetTime ?? slotTime,
      appointmentId: undefined,
    });
  };

  const handleCloseNew = () => {
    updateUrl({ sheet: undefined, time: undefined });
  };

  const isNewOpen = sheet === "new";

  const selectedAppointment = useMemo(() => {
    if (!appointmentId) return null;
    return appointments.find((appt) => appt.id === appointmentId) ?? null;
  }, [appointments, appointmentId]);

  const isDetailsOpen = sheet === "details" && Boolean(appointmentId);

  // Week View Calculations
  const weekRange = useMemo(() => getWeekRange(date), [date]);

  const weekAppointmentsByDay = useMemo(() => {
    const map = new Map<string, AppointmentItem[]>();
    for (const day of weekRange.days) {
      map.set(day, []);
    }
    for (const appt of appointments) {
      const apptDay = appt.localScheduledAt.slice(0, 10);
      const list = map.get(apptDay);
      if (list) {
        list.push(appt);
      }
    }
    return map;
  }, [appointments, weekRange]);

  // Formatted Date Indicator
  const dateIndicatorText = useMemo(() => {
    if (view === "confirmations") {
      return "Pendências de confirmação que exigem contato da recepção";
    }
    if (view === "week") {
      return formatWeekRangeLabel(weekRange.startDate, weekRange.endDate);
    }
    return formatDateLabel(date);
  }, [view, date, weekRange]);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Top Header & Navigation Bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {view === "confirmations"
              ? "Confirmações"
              : view === "reception"
                ? "Fila da Recepção"
                : "Agenda"}
          </h1>
          <p className="text-sm font-medium text-muted-foreground mt-0.5">
            {dateIndicatorText}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Action: Novo Agendamento */}
          <Button
            onClick={() => handleOpenNew(date)}
            className="h-8 gap-1.5 px-3 text-xs font-medium cursor-pointer"
          >
            <PlusIcon className="size-3.5" />
            Novo agendamento
          </Button>

          {/* Navigation Controls: Hoje, Anterior, Próximo (shown in day, week, reception) */}
          {view !== "confirmations" && (
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card p-1 shadow-2xs">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToday}
                className="h-8 px-2.5 text-xs font-medium"
              >
                Hoje
              </Button>
              <div className="h-4 w-px bg-border" />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handlePrevious}
                aria-label="Período anterior"
                className="h-8 w-8"
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={handleNext}
                aria-label="Próximo período"
                className="h-8 w-8"
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
          )}

          {/* View Switcher: Dia / Semana / Fila da Recepção / Confirmações */}
          <div className="flex items-center rounded-lg border border-border bg-card p-1 shadow-2xs">
            <Button
              variant={view === "day" ? "default" : "ghost"}
              size="sm"
              onClick={() => handleViewChange("day")}
              className="h-8 px-3 text-xs font-medium"
            >
              Dia
            </Button>
            <Button
              variant={view === "week" ? "default" : "ghost"}
              size="sm"
              onClick={() => handleViewChange("week")}
              className="h-8 px-3 text-xs font-medium"
            >
              Semana
            </Button>
            <Button
              variant={view === "reception" ? "default" : "ghost"}
              size="sm"
              onClick={() => handleViewChange("reception")}
              className="h-8 px-3 text-xs font-medium"
            >
              Fila da Recepção
            </Button>
            <Button
              variant={view === "confirmations" ? "default" : "ghost"}
              size="sm"
              onClick={() => handleViewChange("confirmations")}
              className="h-8 px-3 text-xs font-medium"
            >
              Confirmações
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {view === "confirmations" ? (
        <PendingConfirmationsView
          orgSlug={orgSlug}
          initialData={pendingConfirmations}
        />
      ) : view === "reception" ? (
        <ReceptionQueueView
          orgSlug={orgSlug}
          date={date}
          initialQueue={receptionQueue}
          initialError={receptionError}
        />
      ) : appointments.length === 0 ? (
        <Empty className="border border-dashed border-border bg-card/40 py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CalendarIcon className="size-6 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>Nenhum agendamento encontrado</EmptyTitle>
            <EmptyDescription>
              {view === "day"
                ? "Não há consultas agendadas para o dia selecionado."
                : "Não há consultas agendadas para esta semana."}
            </EmptyDescription>
          </EmptyHeader>
          <div className="mt-4 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleOpenNew(date)}
              className="gap-1.5 text-xs font-medium cursor-pointer"
            >
              <PlusIcon className="size-3.5" />
              Novo agendamento
            </Button>
          </div>
        </Empty>
      ) : view === "day" ? (
        /* DAY VIEW */
        <div className="flex flex-col gap-3">
          {appointments.map((appointment) => {
            const statusInfo = normalizeAppointmentStatus(appointment.status);
            const timeRange = formatAppointmentTime(
              appointment.localScheduledAt,
              appointment.durationMinutes,
            );

            return (
              <button
                key={appointment.id}
                type="button"
                onClick={() => handleOpenDetails(appointment.id)}
                className={cn(
                  "group w-full text-left flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card text-card-foreground shadow-2xs hover:border-primary/50 hover:bg-accent/5 transition-all cursor-pointer",
                  appointment.id === highlightedAppointmentId &&
                    "ring-2 ring-primary ring-offset-2 ring-offset-background border-primary/60",
                )}
              >
                <div className="flex items-start sm:items-center gap-4">
                  <div className="flex flex-col items-center justify-center min-w-[5.5rem] px-2.5 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium">
                    <span className="font-semibold text-foreground text-sm">
                      {appointment.localScheduledAt.slice(11, 16)}
                    </span>
                    <span className="text-[11px]">
                      {appointment.durationMinutes} min
                    </span>
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <h3 className="font-semibold text-foreground text-base group-hover:text-primary transition-colors">
                      {appointment.patientName ?? "Paciente"}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {appointment.professionalName ?? "Profissional"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-start sm:self-center">
                  <span className="text-xs text-muted-foreground hidden md:inline-flex items-center gap-1">
                    <ClockIcon className="size-3.5" />
                    {timeRange}
                  </span>
                  <Badge
                    variant={statusInfo.variant}
                    data-status={statusInfo.key}
                  >
                    {statusInfo.label}
                  </Badge>
                </div>
              </button>
            );
          })}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleOpenNew(date)}
            className="w-full border-dashed gap-1.5 text-xs text-muted-foreground hover:text-foreground py-3 h-auto cursor-pointer"
          >
            <PlusIcon className="size-3.5" />
            Novo agendamento neste dia
          </Button>
        </div>
      ) : (
        /* WEEK VIEW */
        <div className="grid grid-cols-1 md:grid-cols-7 gap-3">
          {weekRange.days.map((dayStr) => {
            const [y, m, d] = dayStr.split("-").map(Number);
            const colDate = new Date(y, m - 1, d);
            const dayOfWeekIdx = colDate.getDay();
            const shortName = SHORT_WEEKDAY_NAMES[dayOfWeekIdx];
            const isColToday = dayStr === today;
            const isColActive = dayStr === date;
            const dayAppts = weekAppointmentsByDay.get(dayStr) ?? [];

            return (
              <div
                key={dayStr}
                className={cn(
                  "flex flex-col rounded-xl border p-3 min-h-[340px] transition-colors",
                  isColActive
                    ? "border-primary/50 bg-card shadow-xs"
                    : "border-border bg-card/60",
                )}
              >
                {/* Day Column Header */}
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-border">
                  <div>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {shortName}
                    </span>
                    <p
                      className={cn(
                        "text-sm font-semibold",
                        isColToday
                          ? "text-primary font-bold"
                          : "text-foreground",
                      )}
                    >
                      {d}
                    </p>
                  </div>
                  {isColToday && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      Hoje
                    </span>
                  )}
                </div>

                {/* Day Column Appointments */}
                <div className="flex flex-col gap-2 flex-1">
                  {dayAppts.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => handleOpenNew(dayStr, "09:00")}
                      className="flex-1 flex flex-col items-center justify-center text-xs text-muted-foreground/60 hover:text-primary hover:bg-accent/10 rounded-lg border border-dashed border-transparent hover:border-primary/30 p-4 transition-all group cursor-pointer"
                    >
                      <PlusIcon className="size-4 mb-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <span>Horário livre</span>
                    </button>
                  ) : (
                    <>
                      {dayAppts.map((appt) => {
                        const statusInfo = normalizeAppointmentStatus(
                          appt.status,
                        );
                        const time = appt.localScheduledAt.slice(11, 16);

                        return (
                          <button
                            key={appt.id}
                            type="button"
                            onClick={() => handleOpenDetails(appt.id)}
                            className={cn(
                              "group w-full p-2.5 rounded-lg border border-border bg-card hover:border-primary/50 hover:bg-accent/10 transition-all cursor-pointer flex flex-col gap-1 shadow-2xs text-left",
                              appt.id === highlightedAppointmentId &&
                                "ring-2 ring-primary ring-offset-1 ring-offset-background border-primary/60",
                            )}
                          >
                            <div className="flex items-center justify-between gap-1 text-xs">
                              <span className="font-semibold text-foreground">
                                {time}
                              </span>
                              <Badge
                                variant={statusInfo.variant}
                                data-status={statusInfo.key}
                                className="text-[10px] px-1.5 py-0 h-4"
                              >
                                {statusInfo.label}
                              </Badge>
                            </div>
                            <div
                              className="text-xs font-medium text-foreground truncate group-hover:text-primary transition-colors"
                              title={appt.patientName}
                            >
                              {appt.patientName ?? "Paciente"}
                            </div>
                            <div
                              className="text-[11px] text-muted-foreground truncate"
                              title={appt.professionalName}
                            >
                              {appt.professionalName ?? "Profissional"}
                            </div>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => handleOpenNew(dayStr)}
                        className="mt-1 flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-primary hover:bg-accent/10 rounded border border-dashed border-border hover:border-primary/30 transition-colors cursor-pointer"
                      >
                        <PlusIcon className="size-3" />
                        Agendar
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Appointment Details Sheet */}
      <AppointmentDetailsSheet
        isOpen={isDetailsOpen}
        onClose={handleCloseDetails}
        orgSlug={orgSlug}
        userRole={userRole}
        appointmentId={appointmentId}
        appointment={selectedAppointment}
        onEdit={(id) => {
          handleCloseDetails();
          handleOpenEdit(id);
        }}
        onAppointmentCancelled={() => {
          router.refresh();
        }}
      />

      {/* Edit Appointment Sheet */}
      <EditAppointmentSheet
        isOpen={isEditOpen}
        onClose={handleCloseEdit}
        orgSlug={orgSlug}
        appointmentId={appointmentId}
        initialAppointment={selectedAppointment}
        professionals={professionals}
        timeZone={timeZone}
        onSuccess={handleSuccessEdit}
      />

      {/* New Appointment Sheet */}
      <NewAppointmentSheet
        isOpen={isNewOpen}
        onClose={handleCloseNew}
        orgSlug={orgSlug}
        timeZone={timeZone}
        initialDate={date}
        initialTime={slotTime}
        professionals={professionals}
        onSuccess={() => {
          handleCloseNew();
          router.refresh();
        }}
      />
    </div>
  );
}
