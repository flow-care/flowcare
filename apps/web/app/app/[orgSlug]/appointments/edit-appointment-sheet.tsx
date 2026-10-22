"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  RefreshCwIcon,
  UserIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  APPOINTMENT_DURATION_OPTIONS,
  canEditAppointment,
  normalizeAppointmentStatus,
  zonedDateTimeToUtc,
} from "@/lib/appointments";
import { maskCpf } from "@/lib/patient-formatters";
import { formatPhoneWithAreaCode } from "@/lib/phone";
import {
  isServerActionMissingError,
  recoverFromStaleBuild,
  STALE_BUILD_MESSAGE,
} from "@/lib/stale-build";
import type {
  AppointmentDetails,
  AppointmentItem,
  ProfessionalItem,
} from "@/server/appointments";
import { checkAvailability, updateAppointmentAction } from "./actions";

interface EditAppointmentSheetProps {
  isOpen: boolean;
  onClose: () => void;
  orgSlug: string;
  appointmentId?: string | null;
  initialAppointment?: AppointmentItem | null;
  professionals: ProfessionalItem[];
  timeZone?: string;
  onSuccess?: (newDate?: string, appointmentId?: string) => void;
}

interface FormSnapshot {
  date: string;
  time: string;
  durationMinutes: number;
  professionalId: string;
  notes: string;
  version: number;
}

export function EditAppointmentSheet({
  isOpen,
  onClose,
  orgSlug,
  appointmentId,
  initialAppointment,
  professionals,
  timeZone = "America/Sao_Paulo",
  onSuccess,
}: EditAppointmentSheetProps) {
  // Loading & base data states
  const [appointmentDetails, setAppointmentDetails] =
    useState<AppointmentDetails | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [notFound, setNotFound] = useState<boolean>(false);

  // Form field states
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [professionalId, setProfessionalId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [version, setVersion] = useState<number>(0);

  // Unsaved changes tracking
  const initialSnapshotRef = useRef<FormSnapshot | null>(null);
  const [showDiscardDialog, setShowDiscardDialog] = useState<boolean>(false);

  // Availability validation states
  const [isValidatingAvailability, setIsValidatingAvailability] =
    useState<boolean>(false);
  const [slotConflictError, setSlotConflictError] = useState<string | null>(
    null,
  );
  const [availableSlots, setAvailableSlots] = useState<
    Array<{ time: string; label: string }>
  >([]);
  const [isSlotValid, setIsSlotValid] = useState<boolean>(true);

  // Submission & Conflict states
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isVersionConflict, setIsVersionConflict] = useState<boolean>(false);
  const [versionConflictMessage, setVersionConflictMessage] = useState<
    string | null
  >(null);
  const [isReloading, setIsReloading] = useState<boolean>(false);

  // Helper to apply loaded appointment data to form
  const applyAppointmentData = useCallback((data: AppointmentDetails) => {
    setAppointmentDetails(data);
    const localScheduledAt = data.localScheduledAt || "";
    const loadedDate = localScheduledAt.slice(0, 10);
    const loadedTime = localScheduledAt.slice(11, 16);
    const loadedDuration = data.durationMinutes || 30;
    const loadedProfId = data.professionalId || "";
    const loadedNotes = data.notes || "";
    const loadedVersion = data.version ?? 0;

    setDate(loadedDate);
    setTime(loadedTime);
    setDurationMinutes(loadedDuration);
    setProfessionalId(loadedProfId);
    setNotes(loadedNotes);
    setVersion(loadedVersion);

    initialSnapshotRef.current = {
      date: loadedDate,
      time: loadedTime,
      durationMinutes: loadedDuration,
      professionalId: loadedProfId,
      notes: loadedNotes,
      version: loadedVersion,
    };

    setSlotConflictError(null);
    setGeneralError(null);
    setIsVersionConflict(false);
    setVersionConflictMessage(null);
    setIsSlotValid(true);
    setAvailableSlots([]);
  }, []);

  // Fetch appointment on open / ID change
  useEffect(() => {
    if (!isOpen) {
      setShowDiscardDialog(false);
      setSlotConflictError(null);
      setGeneralError(null);
      setIsVersionConflict(false);
      setVersionConflictMessage(null);
      return;
    }

    if (!appointmentId) {
      setNotFound(true);
      setAppointmentDetails(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setNotFound(false);

    // Progressive display with initial data if ID matches
    if (initialAppointment && initialAppointment.id === appointmentId) {
      applyAppointmentData({
        ...initialAppointment,
        patient: initialAppointment.patientName
          ? {
              id: initialAppointment.patientId,
              fullName: initialAppointment.patientName,
            }
          : null,
        professional: initialAppointment.professionalName
          ? {
              id: initialAppointment.professionalId,
              fullName: initialAppointment.professionalName,
            }
          : null,
      });
    }

    fetch(
      `/api/organizations/${encodeURIComponent(orgSlug)}/appointments/${encodeURIComponent(appointmentId)}`,
    )
      .then(async (res) => {
        if (!isMounted) return;
        if (!res.ok) {
          if (res.status === 404 || res.status === 400) {
            setNotFound(true);
            setAppointmentDetails(null);
          }
          return;
        }
        const data: AppointmentDetails = await res.json();
        if (isMounted) {
          applyAppointmentData(data);
          setNotFound(false);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        if (!initialAppointment) {
          setNotFound(true);
          setAppointmentDetails(null);
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [
    isOpen,
    appointmentId,
    initialAppointment,
    orgSlug,
    applyAppointmentData,
  ]);

  // Determine whether user made any changes
  const hasUnsavedChanges = Boolean(
    initialSnapshotRef.current &&
      (date !== initialSnapshotRef.current.date ||
        time !== initialSnapshotRef.current.time ||
        durationMinutes !== initialSnapshotRef.current.durationMinutes ||
        professionalId !== initialSnapshotRef.current.professionalId ||
        notes !== initialSnapshotRef.current.notes),
  );

  // Check if schedule (date, time, or professional) specifically changed
  const isScheduleChanged = Boolean(
    initialSnapshotRef.current &&
      (date !== initialSnapshotRef.current.date ||
        time !== initialSnapshotRef.current.time ||
        professionalId !== initialSnapshotRef.current.professionalId),
  );

  // Availability validation against professional's schedule in real time
  useEffect(() => {
    if (!isOpen || !date || !time || !professionalId) {
      setIsValidatingAvailability(false);
      return;
    }

    // If schedule matches the initial appointment, slot is naturally valid (it's current slot)
    if (!isScheduleChanged) {
      setIsValidatingAvailability(false);
      setSlotConflictError(null);
      setIsSlotValid(true);
      setAvailableSlots([]);
      return;
    }

    let isMounted = true;
    setIsValidatingAvailability(true);
    setSlotConflictError(null);

    const timer = setTimeout(async () => {
      try {
        const response = await checkAvailability(orgSlug, {
          date,
          professionalId,
        });

        if (!isMounted) return;

        const slots = response.slots ?? [];
        const mappedSlots = slots.map((s) => {
          const slotTime = s.localStartsAt.slice(11, 16);
          return { time: slotTime, label: slotTime };
        });
        setAvailableSlots(mappedSlots);

        const isAvailable = slots.some(
          (s) => s.localStartsAt.slice(11, 16) === time,
        );

        if (isAvailable) {
          setIsSlotValid(true);
          setSlotConflictError(null);
        } else {
          setIsSlotValid(false);
          setSlotConflictError(
            "O horário selecionado não está disponível na agenda do profissional.",
          );
        }
      } catch {
        if (!isMounted) return;
        // If availability check fails, keep slot as valid and allow backend check
        setIsSlotValid(true);
      } finally {
        if (isMounted) {
          setIsValidatingAvailability(false);
        }
      }
    }, 300);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [isOpen, date, time, professionalId, isScheduleChanged, orgSlug]);

  // Discard check on close
  const handleRequestClose = () => {
    if (hasUnsavedChanges) {
      setShowDiscardDialog(true);
    } else {
      onClose();
    }
  };

  // Reload latest appointment data (concurrency conflict resolution)
  const handleReloadLatest = async () => {
    if (!appointmentId) return;
    setIsReloading(true);
    try {
      const res = await fetch(
        `/api/organizations/${encodeURIComponent(orgSlug)}/appointments/${encodeURIComponent(appointmentId)}`,
      );
      if (!res.ok) throw new Error("Erro ao recarregar.");
      const data: AppointmentDetails = await res.json();
      applyAppointmentData(data);
      toast.info("Dados mais recentes do agendamento recarregados.");
    } catch {
      toast.error("Não foi possível recarregar os dados do agendamento.");
    } finally {
      setIsReloading(false);
    }
  };

  // Submit updated appointment
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !appointmentId) return;

    if (!hasUnsavedChanges) {
      setGeneralError("Nenhuma alteração foi realizada.");
      return;
    }

    if (isScheduleChanged && !isSlotValid) {
      setGeneralError(
        "Selecione um horário disponível para o profissional antes de salvar.",
      );
      return;
    }

    setIsSubmitting(true);
    setGeneralError(null);
    setSlotConflictError(null);
    setIsVersionConflict(false);
    setVersionConflictMessage(null);

    try {
      const scheduledAtUtc = zonedDateTimeToUtc(date, time, timeZone);

      const result = await updateAppointmentAction(orgSlug, appointmentId, {
        version,
        scheduledAt: scheduledAtUtc,
        durationMinutes,
        professionalId,
        notes: notes.trim() || null,
      });

      if (!result.success) {
        if (
          result.code === "VERSION_CONFLICT" ||
          result.error?.includes("outra sessão")
        ) {
          setIsVersionConflict(true);
          setVersionConflictMessage(
            result.error || "O agendamento foi atualizado em outra sessão.",
          );
        } else if (result.code === "SLOT_CONFLICT") {
          setSlotConflictError(
            result.error ||
              "O horário selecionado conflita com outro agendamento do profissional.",
          );
        } else {
          setGeneralError(
            result.error || "Não foi possível atualizar o agendamento.",
          );
        }
        return;
      }

      toast.success("Agendamento atualizado com sucesso!");
      onClose();
      onSuccess?.(date, appointmentId);
    } catch (err) {
      if (isServerActionMissingError(err)) {
        setGeneralError(STALE_BUILD_MESSAGE);
        recoverFromStaleBuild();
        return;
      }

      const error = err as { code?: string; message?: string };
      if (
        error?.code === "VERSION_CONFLICT" ||
        error?.message?.includes("outra sessão")
      ) {
        setIsVersionConflict(true);
        setVersionConflictMessage(
          error.message || "O agendamento foi atualizado em outra sessão.",
        );
      } else if (error?.code === "SLOT_CONFLICT") {
        setSlotConflictError(
          error.message ||
            "O horário selecionado conflita com outro agendamento do profissional.",
        );
      } else {
        setGeneralError(
          error?.message ||
            "Não foi possível salvar as alterações do agendamento.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // State 1: Not Found
  if (notFound) {
    return (
      <Sheet
        open={isOpen}
        onOpenChange={(open) => !open && handleRequestClose()}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-6 flex flex-col justify-between"
        >
          <div className="flex flex-col gap-6">
            <SheetHeader className="gap-1.5 text-left">
              <SheetTitle className="text-xl font-semibold text-foreground">
                Editar Agendamento
              </SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground">
                Atualização das informações do agendamento.
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col items-center justify-center p-8 rounded-xl border border-dashed border-border bg-card text-center gap-3">
              <AlertCircleIcon className="size-8 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <h4 className="font-semibold text-foreground text-sm">
                  Agendamento não encontrado
                </h4>
                <p className="text-xs text-muted-foreground max-w-[260px]">
                  O agendamento solicitado não foi localizado para edição.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <Button
              variant="outline"
              className="w-full cursor-pointer"
              onClick={onClose}
              type="button"
            >
              Fechar
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // State 2: Loading initial data
  if (isLoading && !appointmentDetails) {
    return (
      <Sheet
        open={isOpen}
        onOpenChange={(open) => !open && handleRequestClose()}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-6 flex flex-col gap-6 overflow-y-auto"
        >
          <SheetHeader className="gap-2 text-left">
            <Skeleton className="h-7 w-48 mt-1" />
            <Skeleton className="h-4 w-64" />
          </SheetHeader>

          <div className="flex flex-col gap-4">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-md" />
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-10 w-full rounded-md" />
              <Skeleton className="h-10 w-full rounded-md" />
            </div>
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  const patientName =
    appointmentDetails?.patient?.fullName ??
    appointmentDetails?.patientName ??
    "Paciente";
  const patientCpf = appointmentDetails?.patient?.cpf;
  const patientPhone = appointmentDetails?.patient?.phone;
  const isTerminated = !canEditAppointment(appointmentDetails?.status);
  const statusInfo = appointmentDetails?.status
    ? normalizeAppointmentStatus(appointmentDetails.status)
    : null;

  return (
    <>
      <Sheet
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) handleRequestClose();
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-6 flex flex-col gap-6 overflow-y-auto"
        >
          <SheetHeader className="gap-1.5 text-left">
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="text-xl font-semibold text-foreground">
                Editar Agendamento
              </SheetTitle>
              {statusInfo && (
                <Badge
                  variant={statusInfo.variant}
                  data-status={statusInfo.key}
                >
                  {statusInfo.label}
                </Badge>
              )}
            </div>
            <SheetDescription className="text-sm text-muted-foreground">
              Altere o horário, profissional responsável ou notas da consulta.
            </SheetDescription>
          </SheetHeader>

          {/* Terminal state warning */}
          {isTerminated && statusInfo && (
            <div
              role="alert"
              className="rounded-lg border border-muted bg-muted/40 p-3.5 text-xs text-muted-foreground flex items-center gap-2"
            >
              <AlertCircleIcon className="size-4 shrink-0 text-muted-foreground" />
              <span>
                Este agendamento está em estado terminal ({statusInfo.label}) e
                não pode ser alterado.
              </span>
            </div>
          )}

          {/* Concurrency Conflict Warning (409 VERSION_CONFLICT) */}
          {isVersionConflict && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-destructive flex flex-col gap-2.5 shadow-xs"
            >
              <div className="flex items-start gap-2">
                <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-xs uppercase tracking-wide">
                    Conflito de Concorrência
                  </span>
                  <span className="text-xs leading-relaxed">
                    {versionConflictMessage ||
                      "Este agendamento foi modificado em outra sessão ou por outro operador."}
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReloadLatest}
                disabled={isReloading}
                className="self-start text-xs h-7 border-destructive/40 text-destructive hover:bg-destructive/15 cursor-pointer"
              >
                {isReloading ? (
                  <>
                    <Spinner className="size-3 mr-1.5" />
                    Recarregando...
                  </>
                ) : (
                  <>
                    <RefreshCwIcon className="size-3 mr-1.5" />
                    Recarregar dados mais recentes
                  </>
                )}
              </Button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-5 flex-1">
            {/* Patient Info Card (Read-only) */}
            <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3 text-card-foreground">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <UserIcon className="size-3.5" />
                <span>Paciente</span>
              </div>
              <p className="font-semibold text-foreground text-sm">
                {patientName}
              </p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-0.5">
                {patientCpf && (
                  <span className="font-mono">CPF: {maskCpf(patientCpf)}</span>
                )}
                {patientPhone && (
                  <span>Tel: {formatPhoneWithAreaCode(patientPhone)}</span>
                )}
              </div>
            </div>

            {/* Professional Selection */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-professional" className="text-foreground">
                Profissional Responsável *
              </Label>
              <Select
                value={professionalId}
                onValueChange={(val) => {
                  setProfessionalId(val);
                  setSlotConflictError(null);
                  setGeneralError(null);
                }}
                disabled={isTerminated || isSubmitting}
              >
                <SelectTrigger
                  id="edit-professional"
                  className="w-full border-border"
                >
                  <SelectValue placeholder="Selecione o profissional" />
                </SelectTrigger>
                <SelectContent>
                  {professionals.length === 0 ? (
                    <SelectItem value="none" disabled>
                      Nenhum profissional disponível
                    </SelectItem>
                  ) : (
                    professionals.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Date and Time Row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit-date" className="text-foreground">
                  Data *
                </Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSlotConflictError(null);
                    setGeneralError(null);
                  }}
                  className="border-border"
                  required
                  disabled={isTerminated || isSubmitting}
                />
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-time" className="text-foreground">
                    Horário *
                  </Label>
                  {isValidatingAvailability && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Spinner className="size-3" />
                      Validando...
                    </span>
                  )}
                </div>
                <Input
                  id="edit-time"
                  type="time"
                  value={time}
                  onChange={(e) => {
                    setTime(e.target.value);
                    setSlotConflictError(null);
                    setGeneralError(null);
                  }}
                  className="border-border"
                  required
                  disabled={isTerminated || isSubmitting}
                />
              </div>
            </div>

            {/* Availability status indication */}
            {isScheduleChanged && !isValidatingAvailability && (
              <div>
                {slotConflictError ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-start gap-2"
                  >
                    <AlertCircleIcon className="size-3.5 shrink-0 mt-0.5" />
                    <span>{slotConflictError}</span>
                  </div>
                ) : isSlotValid ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2Icon className="size-3.5" />
                    <span>Horário disponível para agendamento.</span>
                  </div>
                ) : null}

                {/* Available slot quick suggestions if available */}
                {availableSlots.length > 0 && (
                  <div className="flex flex-col gap-1.5 mt-2">
                    <span className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                      <ClockIcon className="size-3" />
                      Horários livres nesta data:
                    </span>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1">
                      {availableSlots.slice(0, 8).map((slot) => (
                        <button
                          key={slot.time}
                          type="button"
                          onClick={() => {
                            setTime(slot.time);
                            setSlotConflictError(null);
                          }}
                          className={`text-xs px-2 py-1 rounded-md border transition-colors cursor-pointer ${
                            time === slot.time
                              ? "border-primary bg-primary text-primary-foreground font-medium"
                              : "border-border bg-card hover:border-primary/50 text-foreground"
                          }`}
                        >
                          {slot.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Duration Selector */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-duration" className="text-foreground">
                Duração *
              </Label>
              <Select
                value={String(durationMinutes)}
                onValueChange={(val) => {
                  setDurationMinutes(Number(val));
                  setGeneralError(null);
                }}
                disabled={isTerminated || isSubmitting}
              >
                <SelectTrigger
                  id="edit-duration"
                  className="w-full border-border"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPOINTMENT_DURATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes Field */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit-notes" className="text-foreground">
                Observações
              </Label>
              <Textarea
                id="edit-notes"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setGeneralError(null);
                }}
                placeholder="Observações da consulta (opcional)"
                rows={3}
                className="border-border"
                maxLength={2000}
                disabled={isTerminated || isSubmitting}
              />
            </div>

            {/* General Error */}
            {generalError && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2"
              >
                <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
                <span className="text-xs">{generalError}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border mt-auto">
              <Button
                type="button"
                variant="outline"
                onClick={handleRequestClose}
                disabled={isSubmitting}
                className="cursor-pointer"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  isTerminated ||
                  isSubmitting ||
                  !hasUnsavedChanges ||
                  (isScheduleChanged && !isSlotValid) ||
                  isValidatingAvailability
                }
                className="cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Spinner className="mr-2 size-4" />
                    Salvando...
                  </>
                ) : (
                  "Salvar alterações"
                )}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* Discard Confirmation Dialog */}
      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem modificações não salvas neste agendamento. Se fechar
              agora, todas as alterações serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowDiscardDialog(false)}
            >
              Continuar editando
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => {
                setShowDiscardDialog(false);
                onClose();
              }}
            >
              Descartar alterações
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
