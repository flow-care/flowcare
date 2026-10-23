"use client";

import { cn } from "cn";
import {
  AlertCircleIcon,
  CalendarIcon,
  ClockIcon,
  FileTextIcon,
  Loader2Icon,
  MailIcon,
  PencilIcon,
  PhoneIcon,
  PlayIcon,
  StethoscopeIcon,
  Trash2Icon,
  UserCheckIcon,
  UserIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  CANCELLATION_REASON_LABELS,
  CANCELLATION_REASONS,
  type CancellationReasonType,
  canCancelAppointment,
  canConfirmArrival,
  canEditAppointment,
  canStartAppointment,
  formatAppointmentTime,
  formatDateLabel,
  formatQueueStatus,
  normalizeAppointmentStatus,
} from "@/lib/appointments";
import { maskCpf } from "@/lib/patient-formatters";
import { formatPhoneWithAreaCode } from "@/lib/phone";
import type {
  AppointmentDetails,
  AppointmentItem,
} from "@/server/appointments";
import {
  cancelAppointmentAction,
  updateReceptionQueueStatusAction,
} from "./actions";

export interface AppointmentDetailsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  orgSlug: string;
  userRole?: string;
  appointmentId?: string | null;
  appointment?: AppointmentItem | null;
  onAppointmentCancelled?: (appointmentId: string) => void;
  onEdit?: (appointmentId: string) => void;
}

export function AppointmentDetailsSheet({
  isOpen,
  onClose,
  orgSlug,
  userRole,
  appointmentId,
  appointment,
  onAppointmentCancelled,
  onEdit,
}: AppointmentDetailsSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleOpenEdit = () => {
    if (!details?.id) return;
    if (onEdit) {
      onEdit(details.id);
    } else {
      const params = new URLSearchParams(searchParams.toString());
      params.set("sheet", "edit");
      params.set("appointmentId", details.id);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    }
  };
  const [details, setDetails] = useState<AppointmentDetails | null>(() => {
    if (!appointment) return null;
    return {
      ...appointment,
      patient: appointment.patientName
        ? {
            id: appointment.patientId,
            fullName: appointment.patientName,
            phone: null,
            cpf: null,
            email: null,
            birthDate: null,
          }
        : null,
      professional: appointment.professionalName
        ? {
            id: appointment.professionalId,
            fullName: appointment.professionalName,
            role: null,
            specialty: "Profissional Clínico",
          }
        : null,
    };
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [notFound, setNotFound] = useState<boolean>(false);

  // Cancellation AlertDialog state
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState<boolean>(false);
  const [cancelReasonType, setCancelReasonType] = useState<
    CancellationReasonType | ""
  >("");
  const [cancelJustification, setCancelJustification] = useState<string>("");
  const [isCanceling, setIsCanceling] = useState<boolean>(false);
  const [isConfirmingArrival, setIsConfirmingArrival] =
    useState<boolean>(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Fetch full details whenever the sheet opens or appointmentId changes
  useEffect(() => {
    if (!isOpen) {
      setIsCancelDialogOpen(false);
      setCancelReasonType("");
      setCancelJustification("");
      setCancelError(null);
      return;
    }

    if (!appointmentId) {
      setNotFound(true);
      setDetails(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setNotFound(false);

    // If an initial appointment was passed and matches ID, keep base details while fetching full info
    if (appointment && appointment.id === appointmentId) {
      setDetails({
        ...appointment,
        patient: appointment.patientName
          ? {
              id: appointment.patientId,
              fullName: appointment.patientName,
              phone: null,
              cpf: null,
              email: null,
              birthDate: null,
            }
          : null,
        professional: appointment.professionalName
          ? {
              id: appointment.professionalId,
              fullName: appointment.professionalName,
              role: null,
              specialty: "Profissional Clínico",
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
            setDetails(null);
          } else if (!appointment) {
            setNotFound(true);
            setDetails(null);
          }
          return;
        }
        const data: AppointmentDetails = await res.json();
        if (isMounted) {
          setDetails(data);
          setNotFound(false);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        if (!appointment) {
          setNotFound(true);
          setDetails(null);
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
  }, [isOpen, appointmentId, appointment, orgSlug]);

  const handleOpenCancelDialog = () => {
    setCancelReasonType("");
    setCancelJustification("");
    setCancelError(null);
    setIsCancelDialogOpen(true);
  };

  const handleConfirmArrival = async () => {
    if (!details || isConfirmingArrival) return;
    setIsConfirmingArrival(true);

    try {
      const res = await updateReceptionQueueStatusAction(
        orgSlug,
        details.id,
        "ARRIVED",
        details.version ?? 0,
      );

      if (!res.success) {
        toast.error(res.error || "Não foi possível confirmar a chegada.");
        return;
      }

      setDetails((prev) =>
        prev
          ? {
              ...prev,
              queueStatus: res.data.queueStatus,
              arrivedAt: res.data.arrivedAt ?? prev.arrivedAt ?? null,
              version: res.data.version,
            }
          : null,
      );
      toast.success("Chegada confirmada. Paciente liberado para a recepção.");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Erro ao confirmar a chegada do paciente.",
      );
    } finally {
      setIsConfirmingArrival(false);
    }
  };

  const handleConfirmCancel = async () => {
    if (
      !details ||
      !cancelReasonType ||
      cancelJustification.trim().length < 10
    ) {
      return;
    }
    setIsCanceling(true);
    setCancelError(null);

    try {
      const res = await cancelAppointmentAction(orgSlug, details.id, {
        reasonType: cancelReasonType,
        justification: cancelJustification.trim(),
        version: details.version ?? 0,
      });

      if (!res.success) {
        const errorMsg = res.error || "Falha ao cancelar o agendamento.";
        setCancelError(errorMsg);
        toast.error(errorMsg);
        return;
      }

      const data = res.data;
      const finalReason =
        data?.cancellationReason ??
        (cancelReasonType
          ? `[${CANCELLATION_REASON_LABELS[cancelReasonType]}] ${cancelJustification.trim()}`
          : cancelJustification.trim());

      setDetails((prev) =>
        prev
          ? {
              ...prev,
              status: "CANCELLED",
              cancellationReason: finalReason,
              cancelledAt: data?.cancelledAt ?? new Date().toISOString(),
              version:
                data?.version ??
                (prev.version !== undefined ? prev.version + 1 : 1),
            }
          : null,
      );
      setIsCancelDialogOpen(false);
      toast.success(
        "Agendamento cancelado com sucesso. O horário foi liberado.",
      );
      onAppointmentCancelled?.(details.id);
      router.refresh();
    } catch (error) {
      const errorMsg =
        error instanceof Error
          ? error.message
          : "Erro ao cancelar o agendamento.";
      setCancelError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setIsCanceling(false);
    }
  };

  // 1. Not Found / Invalid State
  if (notFound) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-6 flex flex-col justify-between"
        >
          <div className="flex flex-col gap-6">
            <SheetHeader className="gap-1.5 text-left">
              <SheetTitle className="text-xl font-semibold text-foreground">
                Detalhes do Agendamento
              </SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground">
                Consulta das informações da reserva.
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col items-center justify-center p-8 rounded-xl border border-dashed border-border bg-card text-center gap-3">
              <AlertCircleIcon className="size-8 text-muted-foreground" />
              <div className="flex flex-col gap-1">
                <h4 className="font-semibold text-foreground text-sm">
                  Agendamento não encontrado
                </h4>
                <p className="text-xs text-muted-foreground max-w-[260px]">
                  O agendamento solicitado não foi encontrado ou não está
                  disponível nesta clínica.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border">
            <Button
              variant="outline"
              className="w-full"
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

  // 2. Loading State (when no details available yet)
  if (isLoading && !details) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-6 flex flex-col gap-6 overflow-y-auto"
        >
          <SheetHeader className="gap-2 text-left">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-7 w-48 mt-1" />
            <Skeleton className="h-4 w-36" />
          </SheetHeader>

          <div className="flex flex-col gap-4">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (!details) {
    return null;
  }

  const statusInfo = normalizeAppointmentStatus(details.status);
  const dateStr = details.localScheduledAt.slice(0, 10);
  const formattedDate = formatDateLabel(dateStr);
  const formattedTime = formatAppointmentTime(
    details.localScheduledAt,
    details.durationMinutes,
  );

  const _queueStatus = details.queueStatus ?? "WAITING";
  const awaitingArrival = canConfirmArrival(
    details.queueStatus,
    details.status,
  );
  const canStart = canStartAppointment(userRole, details.status);
  const canCancel = canCancelAppointment(details.status);
  const canEdit = canEditAppointment(details.status);

  const patientName =
    details.patient?.fullName ?? details.patientName ?? "Paciente";
  const professionalName =
    details.professional?.fullName ??
    details.professionalName ??
    "Profissional";
  const professionalRoleTitle =
    details.professional?.specialty ?? "Profissional Clínico";

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-6 flex flex-col justify-between overflow-y-auto"
        >
          <div className="flex flex-col gap-6">
            <SheetHeader className="gap-1.5 text-left">
              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant={statusInfo.variant}
                  data-status={statusInfo.key}
                >
                  {statusInfo.label}
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  ID: {details.id.slice(0, 8)}
                </span>
              </div>
              <SheetTitle className="text-xl font-semibold text-foreground">
                {patientName}
              </SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground">
                Consulta com {professionalName}
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
                  <p className="text-foreground font-medium">{formattedDate}</p>
                  <div className="flex items-center gap-1.5">
                    <ClockIcon className="size-3.5 text-muted-foreground" />
                    <span>
                      {formattedTime} ({details.durationMinutes} minutos)
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
                <div className="flex flex-col gap-1.5 pl-6 text-muted-foreground">
                  <p className="font-semibold text-foreground text-sm">
                    {patientName}
                  </p>

                  {/* Phone with Click-to-call */}
                  {details.patient?.phone ? (
                    <a
                      href={`tel:${details.patient.phone.replace(/\D/g, "")}`}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      <PhoneIcon className="size-3.5 text-primary" />
                      <span>
                        {formatPhoneWithAreaCode(details.patient.phone)}
                      </span>
                    </a>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Telefone não informado
                    </span>
                  )}

                  {/* CPF Masked */}
                  {details.patient?.cpf ? (
                    <p className="text-xs text-muted-foreground">
                      CPF:{" "}
                      <span className="font-mono">
                        {maskCpf(details.patient.cpf)}
                      </span>
                    </p>
                  ) : null}

                  {/* Email */}
                  {details.patient?.email ? (
                    <a
                      href={`mailto:${details.patient.email}`}
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <MailIcon className="size-3.5" />
                      <span>{details.patient.email}</span>
                    </a>
                  ) : null}
                </div>
              </div>

              {/* Dados do Profissional */}
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground">
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <StethoscopeIcon className="size-4 text-muted-foreground" />
                  <span>Profissional Responsável</span>
                </div>
                <div className="flex flex-col gap-1 pl-6 text-muted-foreground">
                  <p className="font-semibold text-foreground text-sm">
                    {professionalName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {professionalRoleTitle}
                  </p>
                </div>
              </div>

              {/* Observações (se presentes) */}
              {details.notes ? (
                <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <FileTextIcon className="size-4 text-muted-foreground" />
                    <span>Observações</span>
                  </div>
                  <p className="text-xs text-muted-foreground pl-6 whitespace-pre-wrap leading-relaxed">
                    {details.notes}
                  </p>
                </div>
              ) : null}

              {/* Status de Cancelamento (se cancelado) */}
              {details.status === "CANCELLED" ? (
                <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-card-foreground">
                  <div className="flex items-center gap-2 font-medium text-destructive">
                    <AlertCircleIcon className="size-4 text-destructive" />
                    <span>Agendamento Cancelado</span>
                  </div>
                  <div className="flex flex-col gap-1 pl-6 text-xs text-muted-foreground">
                    {details.cancellationReason && (
                      <p className="text-foreground font-medium">
                        Motivo: {details.cancellationReason}
                      </p>
                    )}
                    {details.cancelledAt && (
                      <p>
                        Cancelado em:{" "}
                        {new Date(details.cancelledAt).toLocaleString("pt-BR")}
                      </p>
                    )}
                  </div>
                </div>
              ) : null}

              {/* Histórico & Fila de Recepção */}
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground">
                <div className="flex items-center justify-between font-medium text-foreground">
                  <div className="flex items-center gap-2">
                    <ClockIcon className="size-4 text-muted-foreground" />
                    <span>Fila & Recepção</span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {formatQueueStatus(details.queueStatus)}
                  </Badge>
                </div>
                {details.arrivedAt ? (
                  <p className="text-xs text-muted-foreground pl-6">
                    Chegada registrada às{" "}
                    {new Date(details.arrivedAt).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground pl-6">
                    Aguardando confirmação de presença na recepção.
                  </p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {awaitingArrival ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleConfirmArrival}
                      disabled={isConfirmingArrival}
                      className="gap-1.5"
                    >
                      {isConfirmingArrival ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <UserCheckIcon className="size-4" />
                      )}
                      <span>
                        {isConfirmingArrival
                          ? "Confirmando..."
                          : "Confirmar chegada"}
                      </span>
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Contextual Action Buttons */}
          <div className="flex flex-col gap-2 pt-6 border-t border-border mt-6">
            {/* Iniciar atendimento: only clinical roles */}
            {canStart && (
              <Button
                asChild
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
              >
                <Link
                  href={`/app/${orgSlug}/consultations?startAppointmentId=${details.id}`}
                >
                  <PlayIcon className="size-4 mr-2" />
                  Iniciar atendimento
                </Link>
              </Button>
            )}

            {/* Editar agendamento */}
            {canEdit && (
              <Button
                variant="outline"
                type="button"
                onClick={handleOpenEdit}
                className="w-full"
              >
                <PencilIcon className="size-4 mr-2" />
                Editar agendamento
              </Button>
            )}

            {/* Cancelar agendamento: opens AlertDialog */}
            {canCancel && (
              <Button
                variant="outline"
                type="button"
                onClick={handleOpenCancelDialog}
                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
              >
                <Trash2Icon className="size-4 mr-2" />
                Cancelar agendamento
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirmation AlertDialog for Appointment Cancellation */}
      <AlertDialog
        open={isCancelDialogOpen}
        onOpenChange={setIsCancelDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar agendamento</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é definitiva e cancelará o atendimento deste paciente.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Explicit warning about immediate slot release */}
          <div
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5 my-1"
          >
            <AlertCircleIcon className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="flex flex-col gap-0.5">
              <span className="font-semibold text-xs">
                Liberação imediata de horário
              </span>
              <span className="text-[11px] leading-relaxed">
                Ao confirmar o cancelamento, este horário ficará imediatamente
                liberado e disponível na agenda para novas marcações.
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 py-1">
            {/* Standardized Cancellation Reason Select */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="cancel-reason-type"
                className="text-xs font-medium text-foreground"
              >
                Motivo do cancelamento{" "}
                <span className="text-destructive">*</span>
              </label>
              <Select
                value={cancelReasonType}
                onValueChange={(val) => {
                  setCancelReasonType(val as CancellationReasonType);
                  if (cancelError) setCancelError(null);
                }}
              >
                <SelectTrigger
                  id="cancel-reason-type"
                  className="w-full border-border bg-card"
                >
                  <SelectValue placeholder="Selecione o motivo padronizado..." />
                </SelectTrigger>
                <SelectContent className="z-[60]">
                  {CANCELLATION_REASONS.map((reason) => (
                    <SelectItem key={reason.value} value={reason.value}>
                      {reason.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Justification Textarea */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="cancel-justification"
                  className="text-xs font-medium text-foreground"
                >
                  Justificativa obrigatória{" "}
                  <span className="text-destructive">*</span>
                </label>
                <span
                  className={cn(
                    "text-[11px]",
                    cancelJustification.trim().length >= 10
                      ? "text-muted-foreground"
                      : "text-destructive font-medium",
                  )}
                >
                  {cancelJustification.trim().length}/10 mín.
                </span>
              </div>
              <Textarea
                id="cancel-justification"
                value={cancelJustification}
                onChange={(e) => {
                  setCancelJustification(e.target.value);
                  if (cancelError) setCancelError(null);
                }}
                placeholder="Descreva detalhadamente a justificativa para este cancelamento..."
                className="w-full border-border bg-card min-h-[80px] text-xs resize-none"
                rows={3}
              />
              {cancelJustification.trim().length > 0 &&
                cancelJustification.trim().length < 10 && (
                  <span className="text-[11px] text-destructive">
                    A justificativa deve ter no mínimo 10 caracteres (
                    {cancelJustification.trim().length}/10).
                  </span>
                )}
            </div>

            {/* Rejection / error handling banner */}
            {cancelError && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-start gap-2.5 my-1"
              >
                <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
                <span className="text-xs font-medium leading-relaxed">
                  {cancelError}
                </span>
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsCancelDialogOpen(false)}
              disabled={isCanceling}
              type="button"
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmCancel}
              disabled={
                !cancelReasonType ||
                cancelJustification.trim().length < 10 ||
                isCanceling
              }
              type="button"
            >
              {isCanceling ? "Cancelando..." : "Confirmar cancelamento"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
