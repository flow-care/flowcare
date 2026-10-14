"use client";

import {
  AlertCircleIcon,
  CalendarIcon,
  CheckCircle2Icon,
  CheckIcon,
  ClockIcon,
  Loader2Icon,
  MessageCircleIcon,
  MessageSquareIcon,
  PhoneIcon,
  PhoneMissedIcon,
  PhoneOffIcon,
  RefreshCwIcon,
  UserIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAppointmentTime, formatDateLabel } from "@/lib/appointments";
import { formatPhoneWithAreaCode } from "@/lib/phone";
import type {
  ManualConfirmationDecision,
  PendingConfirmationItem,
} from "@/server/confirmations";
import { recordConfirmationAction } from "./actions";

interface PendingConfirmationsViewProps {
  orgSlug: string;
  initialData?: PendingConfirmationItem[];
  initialError?: string | null;
}

export function PendingConfirmationsView({
  orgSlug,
  initialData = [],
  initialError = null,
}: PendingConfirmationsViewProps) {
  const router = useRouter();
  const [isTransitionPending, startTransition] = useTransition();

  const [items, setItems] = useState<PendingConfirmationItem[]>(initialData);
  const [error, setError] = useState<string | null>(initialError);

  // Modal state for confirmation
  const [activeDialog, setActiveDialog] = useState<{
    item: PendingConfirmationItem;
    decision: ManualConfirmationDecision;
  } | null>(null);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRetry = () => {
    setError(null);
    startTransition(() => {
      router.refresh();
    });
  };

  const handleOpenDialog = (
    item: PendingConfirmationItem,
    decision: ManualConfirmationDecision,
  ) => {
    setActiveDialog({ item, decision });
    setNotes("");
  };

  const handleCloseDialog = () => {
    if (isSubmitting) return;
    setActiveDialog(null);
    setNotes("");
  };

  const handleConfirmDecision = async () => {
    if (!activeDialog) return;

    const { item, decision } = activeDialog;
    setIsSubmitting(true);

    try {
      const result = await recordConfirmationAction(
        orgSlug,
        item.appointmentId,
        decision,
        notes.trim() || undefined,
        "PHONE_CALL",
      );

      if (!result.success) {
        toast.error(result.error ?? "Erro ao registrar confirmação.");
        return;
      }

      // Remove card immediately from pending list
      setItems((prev) =>
        prev.filter((card) => card.appointmentId !== item.appointmentId),
      );
      handleCloseDialog();

      if (decision === "CONFIRMED") {
        toast.success(
          `Presença de ${item.patientName} confirmada com sucesso!`,
        );
      } else if (decision === "CANCELLED") {
        toast.success(`Agendamento de ${item.patientName} cancelado.`);
      } else {
        toast.info(
          `Tentativa sem resposta registrada para ${item.patientName}.`,
        );
      }
    } catch {
      toast.error(
        "Ocorreu uma falha ao conectar ao servidor. Tente novamente.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-12 text-center text-card-foreground my-4">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircleIcon className="size-6" />
        </div>
        <div className="max-w-md space-y-1.5">
          <h2 className="text-lg font-semibold text-foreground">
            Não foi possível carregar as confirmações
          </h2>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
        <Button
          variant="outline"
          onClick={handleRetry}
          disabled={isTransitionPending}
          className="gap-2 mt-2"
        >
          <RefreshCwIcon
            className={`size-4 ${isTransitionPending ? "animate-spin" : ""}`}
          />
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (isTransitionPending && items.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="p-5 rounded-xl border border-border bg-card flex flex-col gap-4 animate-pulse"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-5 w-32" />
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="flex gap-2 pt-2">
              <Skeleton className="h-8 w-44" />
              <Skeleton className="h-8 w-44" />
              <Skeleton className="h-8 w-44" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Empty className="border border-dashed border-border bg-card/40 py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckCircle2Icon className="size-6 text-primary" />
          </EmptyMedia>
          <EmptyTitle>Todas as confirmações estão em dia!</EmptyTitle>
          <EmptyDescription>
            Não há consultas pendentes de confirmação manual no momento.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="px-2.5 py-0.5 text-xs font-semibold"
          >
            {items.length} {items.length === 1 ? "pendência" : "pendências"}
          </Badge>
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Pacientes aguardando contato da recepção
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRetry}
          disabled={isTransitionPending}
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <RefreshCwIcon
            className={`size-3.5 ${isTransitionPending ? "animate-spin" : ""}`}
          />
          Atualizar
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {items.map((item) => {
          const phoneDigits = (item.patientPhone ?? "").replace(/\D/g, "");
          const formattedPhone = phoneDigits
            ? formatPhoneWithAreaCode(phoneDigits)
            : null;
          const whatsappUrl = phoneDigits
            ? `https://wa.me/55${phoneDigits}?text=${encodeURIComponent(
                `Olá, ${item.patientName}! Entramos em contato da clínica para confirmar sua consulta marcada para ${formatDateLabel(
                  item.localScheduledAt.slice(0, 10),
                )} às ${item.localScheduledAt.slice(11, 16)}.`,
              )}`
            : null;
          const telUrl = phoneDigits ? `tel:${phoneDigits}` : null;

          const dateStr = item.localScheduledAt.slice(0, 10);
          const formattedDate = formatDateLabel(dateStr);
          const timeRange = formatAppointmentTime(
            item.localScheduledAt,
            item.durationMinutes,
          );

          return (
            <div
              key={item.id}
              className="flex flex-col gap-3.5 p-5 rounded-xl border border-border bg-card text-card-foreground shadow-2xs transition-all hover:border-border/80"
            >
              {/* Header: Paciente, Telefone & Horário */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-foreground text-base tracking-tight">
                      {item.patientName}
                    </h3>
                  </div>

                  {/* Telefone e Ações Rápidas de Contato */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {formattedPhone && telUrl ? (
                      <>
                        <a
                          href={telUrl}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-foreground bg-muted/60 hover:bg-muted hover:text-primary transition-colors border border-border"
                          title="Ligar para o paciente"
                        >
                          <PhoneIcon className="size-3.5 text-muted-foreground" />
                          <span>{formattedPhone}</span>
                        </a>

                        {whatsappUrl && (
                          <a
                            href={whatsappUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors border border-emerald-200/50 dark:border-emerald-800/40"
                            title="Abrir WhatsApp Web"
                          >
                            <MessageCircleIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>WhatsApp</span>
                          </a>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground italic flex items-center gap-1.5 py-1">
                        <PhoneOffIcon className="size-3.5" />
                        Telefone não informado
                      </span>
                    )}
                  </div>
                </div>

                {/* Dados da Consulta: Data, Horário e Profissional */}
                <div className="flex flex-col sm:items-end gap-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground flex items-center gap-1.5">
                      <CalendarIcon className="size-3.5 text-muted-foreground" />
                      {formattedDate}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1.5">
                      <ClockIcon className="size-3.5 text-muted-foreground" />
                      {timeRange}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <UserIcon className="size-3.5 text-muted-foreground" />
                    <span>{item.professionalName}</span>
                  </div>
                </div>
              </div>

              {/* Mensagem original caso exista (contexto do WhatsApp) */}
              {item.originalMessage && (
                <div className="rounded-lg bg-muted/50 border border-border/70 p-3 text-xs text-muted-foreground flex flex-col gap-1">
                  <div className="flex items-center justify-between font-medium text-foreground">
                    <span className="flex items-center gap-1.5">
                      <MessageSquareIcon className="size-3.5 text-muted-foreground" />
                      Última mensagem do paciente:
                    </span>
                    {item.originalMessageAt && (
                      <span className="text-[11px] text-muted-foreground font-normal">
                        {new Date(item.originalMessageAt).toLocaleDateString(
                          "pt-BR",
                          {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )}
                      </span>
                    )}
                  </div>
                  <p className="italic text-foreground/90 pl-5">
                    "{item.originalMessage}"
                  </p>
                </div>
              )}

              {/* Botões de Ação Rápida */}
              <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
                <Button
                  size="sm"
                  variant="default"
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-2xs"
                  onClick={() => handleOpenDialog(item, "CONFIRMED")}
                >
                  <CheckIcon className="size-4" />
                  Confirmado manualmente
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="gap-1.5 shadow-2xs"
                  onClick={() => handleOpenDialog(item, "CANCELLED")}
                >
                  <XIcon className="size-4" />
                  Cancelado pelo paciente
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shadow-2xs"
                  onClick={() => handleOpenDialog(item, "NO_RESPONSE")}
                >
                  <PhoneMissedIcon className="size-4" />
                  Tentativa sem resposta
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dialog de Confirmação da Ação do Operador */}
      <Dialog
        open={Boolean(activeDialog)}
        onOpenChange={(open) => !open && handleCloseDialog()}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {activeDialog?.decision === "CONFIRMED" &&
                "Confirmar presença manualmente"}
              {activeDialog?.decision === "CANCELLED" && "Cancelar agendamento"}
              {activeDialog?.decision === "NO_RESPONSE" &&
                "Registrar tentativa sem resposta"}
            </DialogTitle>
            <DialogDescription>
              {activeDialog?.decision === "CONFIRMED" &&
                `Deseja confirmar a presença de ${activeDialog.item.patientName} para a consulta com ${activeDialog.item.professionalName}?`}
              {activeDialog?.decision === "CANCELLED" &&
                `Tem certeza de que deseja registrar o cancelamento da consulta de ${activeDialog.item.patientName}? O agendamento será cancelado na agenda.`}
              {activeDialog?.decision === "NO_RESPONSE" &&
                `Registrar que houve contato com ${activeDialog.item.patientName}, mas sem retorno do paciente?`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 py-2">
            <label
              htmlFor="confirmation-notes"
              className="text-xs font-medium text-foreground"
            >
              Observações (opcional)
            </label>
            <textarea
              id="confirmation-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex: Paciente confirmou por ligação telefônica / Caixa postal."
              maxLength={500}
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground shadow-2xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              onClick={handleCloseDialog}
              disabled={isSubmitting}
            >
              Voltar
            </Button>
            <Button
              type="button"
              variant={
                activeDialog?.decision === "CANCELLED"
                  ? "destructive"
                  : "default"
              }
              className={
                activeDialog?.decision === "CONFIRMED"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : ""
              }
              onClick={handleConfirmDecision}
              disabled={isSubmitting}
            >
              {isSubmitting && (
                <Loader2Icon className="size-4 animate-spin mr-1.5" />
              )}
              {activeDialog?.decision === "CONFIRMED" && "Confirmar presença"}
              {activeDialog?.decision === "CANCELLED" &&
                "Confirmar cancelamento"}
              {activeDialog?.decision === "NO_RESPONSE" &&
                "Registrar tentativa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
