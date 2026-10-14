"use client";

import { CalendarIcon, ClockIcon, UserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  formatAppointmentTime,
  formatDateLabel,
  normalizeAppointmentStatus,
} from "@/lib/appointments";
import type { AppointmentItem } from "@/server/appointments";

interface AppointmentDetailsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  appointment: AppointmentItem | null;
}

export function AppointmentDetailsSheet({
  isOpen,
  onClose,
  appointment,
}: AppointmentDetailsSheetProps) {
  if (!appointment) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className="p-6">
          <SheetHeader>
            <SheetTitle>Detalhes do Agendamento</SheetTitle>
            <SheetDescription>Agendamento não encontrado.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    );
  }

  const statusInfo = normalizeAppointmentStatus(appointment.status);
  const dateStr = appointment.localScheduledAt.slice(0, 10);
  const formattedDate = formatDateLabel(dateStr);
  const formattedTime = formatAppointmentTime(
    appointment.localScheduledAt,
    appointment.durationMinutes,
  );

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-6 flex flex-col gap-6 overflow-y-auto"
      >
        <SheetHeader className="gap-1.5 text-left">
          <div className="flex items-center justify-between gap-2">
            <Badge variant={statusInfo.variant} data-status={statusInfo.key}>
              {statusInfo.label}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">
              ID: {appointment.id.slice(0, 8)}
            </span>
          </div>
          <SheetTitle className="text-xl font-semibold text-foreground">
            {appointment.patientName ?? "Paciente"}
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            Consulta com {appointment.professionalName ?? "Profissional"}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 text-sm">
          {/* Horário e Data */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <CalendarIcon className="size-4 text-muted-foreground" />
              <span>Data e Horário</span>
            </div>
            <div className="flex flex-col gap-1 pl-6 text-muted-foreground">
              <p className="text-foreground">{formattedDate}</p>
              <div className="flex items-center gap-1.5">
                <ClockIcon className="size-3.5 text-muted-foreground" />
                <span>
                  {formattedTime} ({appointment.durationMinutes} minutos)
                </span>
              </div>
            </div>
          </div>

          {/* Dados do Paciente */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <UserIcon className="size-4 text-muted-foreground" />
              <span>Paciente</span>
            </div>
            <div className="flex flex-col gap-1 pl-6 text-muted-foreground">
              <p className="font-medium text-foreground">
                {appointment.patientName ?? "Paciente não identificado"}
              </p>
              <p className="text-xs font-mono">ID: {appointment.patientId}</p>
            </div>
          </div>

          {/* Dados do Profissional */}
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <UserIcon className="size-4 text-muted-foreground" />
              <span>Profissional Responsável</span>
            </div>
            <div className="flex flex-col gap-1 pl-6 text-muted-foreground">
              <p className="font-medium text-foreground">
                {appointment.professionalName ??
                  "Profissional não identificado"}
              </p>
              <p className="text-xs font-mono">
                ID: {appointment.professionalId}
              </p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
