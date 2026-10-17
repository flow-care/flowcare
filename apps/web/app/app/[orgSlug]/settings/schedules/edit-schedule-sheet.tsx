"use client";

import {
  AlertCircle,
  AlertTriangle,
  CalendarOff,
  Clock3,
  Loader2,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import {
  DAY_OF_WEEK_LABELS,
  DAYS_OF_WEEK,
  type DayOfWeek,
  formatExceptionDateRange,
  type ScheduleExceptionsResponse,
  type ScheduleProfessional,
  validateWeeklyRule,
  type WeeklyScheduleResponse,
  type WeeklyScheduleRule,
} from "@/lib/schedules";
import {
  deleteDayRulesAction,
  deleteScheduleExceptionAction,
  updateDayRulesAction,
} from "./actions";

export interface EditScheduleFormProps {
  orgSlug: string;
  scheduleId: string | null;
  onClose: () => void;
  weeklySchedule: WeeklyScheduleResponse;
  exceptionsData: ScheduleExceptionsResponse;
  professionals: ScheduleProfessional[];
}

export function EditScheduleForm({
  orgSlug,
  scheduleId,
  onClose,
  weeklySchedule,
  exceptionsData,
  professionals,
}: EditScheduleFormProps) {
  const router = useRouter();
  const startTimeId = useId();
  const endTimeId = useId();
  const slotDurationId = useId();

  // 1. Check if scheduleId is a DayOfWeek
  const isDayOfWeek =
    scheduleId && (DAYS_OF_WEEK as readonly string[]).includes(scheduleId);
  const matchedDay = isDayOfWeek ? (scheduleId as DayOfWeek) : null;

  // 2. Check if scheduleId matches an exception
  const matchedException = useMemo(() => {
    if (!scheduleId || isDayOfWeek) return null;
    return exceptionsData.exceptions.find((e) => e.id === scheduleId) || null;
  }, [scheduleId, isDayOfWeek, exceptionsData.exceptions]);

  // Form states for DayOfWeek rule editing
  const initialDayRules = useMemo(() => {
    if (!matchedDay) return [];
    return weeklySchedule.rules.filter((r) => r.dayOfWeek === matchedDay);
  }, [matchedDay, weeklySchedule.rules]);

  const [startTime, setStartTime] = useState(
    initialDayRules[0]?.startTime || "08:00",
  );
  const [endTime, setEndTime] = useState(
    initialDayRules[0]?.endTime || "18:00",
  );
  const [slotDuration, setSlotDuration] = useState(
    String(initialDayRules[0]?.slotDurationMinutes || 30),
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  // Check if form is dirty
  const isDirty = useMemo(() => {
    if (!matchedDay) return false;
    const initialStart = initialDayRules[0]?.startTime || "08:00";
    const initialEnd = initialDayRules[0]?.endTime || "18:00";
    const initialSlot = String(initialDayRules[0]?.slotDurationMinutes || 30);
    return (
      startTime !== initialStart ||
      endTime !== initialEnd ||
      slotDuration !== initialSlot
    );
  }, [matchedDay, initialDayRules, startTime, endTime, slotDuration]);

  const handleSafeClose = () => {
    if (isDirty) {
      setShowDiscardDialog(true);
    } else {
      onClose();
    }
  };

  // Validation
  const ruleValidation = useMemo(() => {
    if (!matchedDay) return { valid: false };
    return validateWeeklyRule({
      dayOfWeek: matchedDay,
      startTime,
      endTime,
      slotDurationMinutes: Number(slotDuration) || 30,
    });
  }, [matchedDay, startTime, endTime, slotDuration]);

  // Save updated day rule
  const handleSaveDayRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchedDay || !ruleValidation.valid) return;

    setIsSubmitting(true);
    try {
      const updatedRule: WeeklyScheduleRule = {
        dayOfWeek: matchedDay,
        startTime,
        endTime,
        slotDurationMinutes: Number(slotDuration) || 30,
      };

      const res = await updateDayRulesAction(orgSlug, matchedDay, [
        updatedRule,
      ]);
      if (res.ok) {
        toast.success(
          `Horário de ${DAY_OF_WEEK_LABELS[matchedDay]} atualizado com sucesso!`,
        );
        onClose();
        router.refresh();
      } else {
        toast.error(res.message || "Não foi possível atualizar o horário.");
      }
    } catch {
      toast.error("Erro inesperado ao salvar alterações.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Disable / delete day rules
  const handleDeleteDayRule = async () => {
    if (!matchedDay) return;
    setIsDeleting(true);
    try {
      const res = await deleteDayRulesAction(orgSlug, matchedDay);
      if (res.ok) {
        toast.success(
          `Atendimento de ${DAY_OF_WEEK_LABELS[matchedDay]} desativado com sucesso.`,
        );
        onClose();
        router.refresh();
      } else {
        toast.error(res.message || "Não foi possível desativar o horário.");
      }
    } catch {
      toast.error("Erro inesperado ao desativar atendimento.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Delete exception
  const handleDeleteException = async () => {
    if (!matchedException) return;
    setIsDeleting(true);
    try {
      const res = await deleteScheduleExceptionAction(
        orgSlug,
        matchedException.id,
      );
      if (res.ok) {
        toast.success("Bloqueio de agenda excluído com sucesso.");
        onClose();
        router.refresh();
      } else {
        toast.error(res.message || "Não foi possível excluir o bloqueio.");
      }
    } catch {
      toast.error("Erro inesperado ao excluir bloqueio.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Case 1: scheduleId NOT found
  if (!isDayOfWeek && !matchedException) {
    return (
      <div data-testid="schedule-not-found" className="space-y-6">
        <div className="flex flex-col items-center justify-center p-6 text-center space-y-3 rounded-lg border border-destructive/20 bg-destructive/10">
          <AlertCircle className="size-10 text-destructive" />
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">
              Item não encontrado
            </h2>
            <p className="text-xs text-muted-foreground max-w-sm">
              O identificador ({scheduleId || "nenhum"}) não corresponde a uma
              regra de horário ou bloqueio desta clínica.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    );
  }

  // Case 2: Editing an Exception block
  if (matchedException) {
    const profName = matchedException.professionalId
      ? professionals.find((p) => p.id === matchedException.professionalId)
          ?.name || "Profissional específico"
      : "Toda a clínica (Geral)";

    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <CalendarOff className="size-5 text-amber-600" />
            Bloqueio de Agenda
          </h2>
          <p className="text-xs text-muted-foreground">
            Consulta e desativação do bloqueio de agenda configurado.
          </p>
        </div>

        <div className="space-y-4 rounded-lg border border-border bg-card p-4 text-sm">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Profissional ou Escopo
            </span>
            <p className="font-semibold text-foreground">{profName}</p>
          </div>

          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Período do Bloqueio
            </span>
            <p className="text-sm text-foreground">
              {formatExceptionDateRange(
                matchedException.startsAt,
                matchedException.endsAt,
                matchedException.timezone,
              )}
            </p>
          </div>

          {matchedException.reason && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Motivo / Justificativa
              </span>
              <p className="text-sm text-foreground">
                {matchedException.reason}
              </p>
            </div>
          )}
        </div>

        {/* Danger zone to remove exception */}
        <div className="space-y-3 pt-4 border-t border-border">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-destructive">
              Zona de Exclusão
            </h3>
            <p className="text-xs text-muted-foreground">
              Remover este bloqueio liberará imediatamente os horários na agenda
              para novos agendamentos de pacientes.
            </p>
          </div>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                className="w-full gap-2"
              >
                <Trash2 className="size-4" />
                {isDeleting ? "Excluindo..." : "Remover este bloqueio"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover bloqueio de agenda?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação removerá o bloqueio da clínica. Os horários
                  correspondentes voltarão a ficar disponíveis na agenda para
                  consultas.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteException}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Confirmar remoção
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="pt-2 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </div>
    );
  }

  // Case 3: Editing Weekly Schedule Rule for a DayOfWeek
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Clock3 className="size-5 text-primary" />
          Editar Horário: {matchedDay && DAY_OF_WEEK_LABELS[matchedDay]}
        </h2>
        <p className="text-xs text-muted-foreground">
          Ajuste o expediente ou desative o atendimento para este dia da semana.
        </p>
      </div>

      <form onSubmit={handleSaveDayRule} className="space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={startTimeId}>Início do expediente</Label>
            <Input
              id={startTimeId}
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={endTimeId}>Término do expediente</Label>
            <Input
              id={endTimeId}
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={slotDurationId}>Duração da consulta (minutos)</Label>
          <Select
            value={slotDuration}
            onValueChange={(v) => setSlotDuration(v)}
          >
            <SelectTrigger id={slotDurationId} className="w-full">
              <SelectValue placeholder="Selecione a duração" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="15">15 minutos</SelectItem>
              <SelectItem value="20">20 minutos</SelectItem>
              <SelectItem value="30">30 minutos (recomendado)</SelectItem>
              <SelectItem value="45">45 minutos</SelectItem>
              <SelectItem value="60">60 minutos (1 hora)</SelectItem>
              <SelectItem value="90">90 minutos (1h 30m)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Validation Warning */}
        {!ruleValidation.valid && ruleValidation.error && (
          <div
            data-testid="edit-validation-error"
            className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive"
          >
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>{ruleValidation.error}</span>
          </div>
        )}

        {/* Impact Warning for affected appointments */}
        <div
          data-testid="affected-appointments-alert"
          className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Aviso sobre agendamentos existentes</p>
            <p className="mt-0.5">
              Caso haja consultas já agendadas para este dia fora do novo
              intervalo, a interface avisará o operador para que sejam
              remarcadas.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-border">
          {/* Deactivate Day Dialog */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isDeleting || isSubmitting}
                className="text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5 mr-1" />
                Desativar dia
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Desativar atendimento em{" "}
                  {matchedDay && DAY_OF_WEEK_LABELS[matchedDay]}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Todos os horários de atendimento deste dia serão removidos.
                  Consultas já marcadas precisarão ser verificadas pelo
                  operador.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteDayRule}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Confirmar desativação
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSafeClose}
              disabled={isSubmitting || isDeleting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!ruleValidation.valid || isSubmitting || isDeleting}
              className="gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar alterações"
              )}
            </Button>
          </div>
        </div>
      </form>

      {/* Discard confirmation dialog when dirty */}
      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações pendentes?</AlertDialogTitle>
            <AlertDialogDescription>
              Você modificou as configurações de horário deste dia. Se fechar
              agora, as alterações serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDiscardDialog(false)}>
              Continuar editando
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowDiscardDialog(false);
                onClose();
              }}
            >
              Descartar alterações
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export interface EditScheduleSheetProps {
  orgSlug: string;
  isOpen: boolean;
  scheduleId: string | null;
  onClose: () => void;
  weeklySchedule: WeeklyScheduleResponse;
  exceptionsData: ScheduleExceptionsResponse;
  professionals: ScheduleProfessional[];
}

export function EditScheduleSheet({
  orgSlug,
  isOpen,
  scheduleId,
  onClose,
  weeklySchedule,
  exceptionsData,
  professionals,
}: EditScheduleSheetProps) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader className="sr-only">
          <SheetTitle>Editar Horário / Bloqueio</SheetTitle>
          <SheetDescription>
            Gerenciamento do item selecionado ({scheduleId || "configuração"}).
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <EditScheduleForm
            orgSlug={orgSlug}
            scheduleId={scheduleId}
            onClose={onClose}
            weeklySchedule={weeklySchedule}
            exceptionsData={exceptionsData}
            professionals={professionals}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
