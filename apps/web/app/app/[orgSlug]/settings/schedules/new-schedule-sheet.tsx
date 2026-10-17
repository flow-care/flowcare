"use client";

import { AlertTriangle, CalendarOff, Clock3, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  checkNewRuleConflict,
  DAY_OF_WEEK_LABELS,
  DAYS_OF_WEEK,
  type DayOfWeek,
  type ScheduleProfessional,
  validateExceptionInput,
  validateWeeklyRule,
  type WeeklyScheduleResponse,
  type WeeklyScheduleRule,
} from "@/lib/schedules";
import { addWeeklyRuleAction, createScheduleExceptionAction } from "./actions";

export interface NewScheduleFormProps {
  orgSlug: string;
  onClose: () => void;
  weeklySchedule: WeeklyScheduleResponse;
  professionals: ScheduleProfessional[];
  initialDay?: DayOfWeek;
  initialStartTime?: string;
  initialEndTime?: string;
}

export function NewScheduleForm({
  orgSlug,
  onClose,
  weeklySchedule,
  professionals,
  initialDay = "MONDAY",
  initialStartTime = "08:00",
  initialEndTime = "12:00",
}: NewScheduleFormProps) {
  const router = useRouter();
  const daySelectId = useId();
  const startTimeId = useId();
  const endTimeId = useId();
  const slotDurationId = useId();
  const professionalSelectId = useId();
  const startsAtId = useId();
  const endsAtId = useId();
  const reasonId = useId();

  const [sheetType, setSheetType] = useState<"weekly" | "exception">("weekly");

  // Weekly rule form state
  const [selectedDay, setSelectedDay] = useState<DayOfWeek>(initialDay);
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(initialEndTime);
  const [slotDuration, setSlotDuration] = useState("30");
  const [isSubmittingWeekly, setIsSubmittingWeekly] = useState(false);

  // Exception form state
  const [exceptionProfessional, setExceptionProfessional] =
    useState<string>("clinic");
  const [exceptionStartsAt, setExceptionStartsAt] = useState("");
  const [exceptionEndsAt, setExceptionEndsAt] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const [isSubmittingException, setIsSubmittingException] = useState(false);

  // Real-time weekly validation and conflict check
  const currentWeeklyRule: WeeklyScheduleRule = useMemo(() => {
    return {
      dayOfWeek: selectedDay,
      startTime,
      endTime,
      slotDurationMinutes: Number(slotDuration) || 30,
    };
  }, [selectedDay, startTime, endTime, slotDuration]);

  const weeklyValidation = useMemo(() => {
    return validateWeeklyRule(currentWeeklyRule);
  }, [currentWeeklyRule]);

  const hasWeeklyConflict = useMemo(() => {
    if (!weeklyValidation.valid) return false;
    return checkNewRuleConflict(weeklySchedule.rules, currentWeeklyRule);
  }, [weeklySchedule.rules, currentWeeklyRule, weeklyValidation.valid]);

  // Real-time exception validation
  const exceptionValidation = useMemo(() => {
    if (!exceptionStartsAt || !exceptionEndsAt) return { valid: false };
    return validateExceptionInput({
      startsAt: exceptionStartsAt,
      endsAt: exceptionEndsAt,
    });
  }, [exceptionStartsAt, exceptionEndsAt]);

  const handleSubmitWeekly = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!weeklyValidation.valid || hasWeeklyConflict) return;

    setIsSubmittingWeekly(true);
    try {
      const res = await addWeeklyRuleAction(orgSlug, currentWeeklyRule);
      if (res.ok) {
        toast.success(
          `Horário de ${DAY_OF_WEEK_LABELS[selectedDay]} (${startTime} às ${endTime}) cadastrado com sucesso!`,
        );
        onClose();
        router.refresh();
      } else {
        toast.error(res.message || "Não foi possível cadastrar o horário.");
      }
    } catch {
      toast.error("Erro inesperado ao salvar horário.");
    } finally {
      setIsSubmittingWeekly(false);
    }
  };

  const handleSubmitException = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exceptionValidation.valid) return;

    setIsSubmittingException(true);
    try {
      const startsAtIso = new Date(exceptionStartsAt).toISOString();
      const endsAtIso = new Date(exceptionEndsAt).toISOString();

      const res = await createScheduleExceptionAction(orgSlug, {
        professionalId:
          exceptionProfessional === "clinic" ? null : exceptionProfessional,
        startsAt: startsAtIso,
        endsAt: endsAtIso,
        reason: exceptionReason.trim() || undefined,
      });

      if (res.ok) {
        toast.success("Bloqueio de agenda criado com sucesso!");
        onClose();
        router.refresh();
      } else {
        toast.error(res.message || "Não foi possível cadastrar o bloqueio.");
      }
    } catch {
      toast.error("Erro inesperado ao cadastrar bloqueio.");
    } finally {
      setIsSubmittingException(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-foreground">
          Novo Horário ou Bloqueio
        </h2>
        <p className="text-xs text-muted-foreground">
          Adicione uma nova regra recorrente de atendimento ou configure um
          recesso pontual na agenda da clínica.
        </p>
      </div>

      <Tabs
        value={sheetType}
        onValueChange={(v) => setSheetType(v as "weekly" | "exception")}
        className="w-full"
      >
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="weekly" className="gap-1.5 text-xs font-medium">
            <Clock3 className="size-3.5" />
            Horário Recorrente
          </TabsTrigger>
          <TabsTrigger
            value="exception"
            className="gap-1.5 text-xs font-medium"
          >
            <CalendarOff className="size-3.5" />
            Bloqueio Pontual
          </TabsTrigger>
        </TabsList>

        {/* TAB: HORÁRIO RECORRENTE SEMANAL */}
        <TabsContent value="weekly">
          <form onSubmit={handleSubmitWeekly} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor={daySelectId}>Dia da semana</Label>
              <Select
                value={selectedDay}
                onValueChange={(val) => setSelectedDay(val as DayOfWeek)}
              >
                <SelectTrigger id={daySelectId} className="w-full">
                  <SelectValue placeholder="Selecione o dia" />
                </SelectTrigger>
                <SelectContent>
                  {DAYS_OF_WEEK.map((day) => (
                    <SelectItem key={day} value={day}>
                      {DAY_OF_WEEK_LABELS[day]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
              <Label htmlFor={slotDurationId}>
                Duração padrão por consulta (minutos)
              </Label>
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

            {/* Validation Warnings */}
            {!weeklyValidation.valid && weeklyValidation.error && (
              <div
                data-testid="rule-validation-error"
                className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive"
              >
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>{weeklyValidation.error}</span>
              </div>
            )}

            {hasWeeklyConflict && (
              <div
                data-testid="rule-conflict-warning"
                className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Conflito de horário detectado</p>
                  <p className="mt-0.5">
                    Já existe um intervalo de atendimento ativo em{" "}
                    {DAY_OF_WEEK_LABELS[selectedDay]} que sobrepõe o período de{" "}
                    {startTime} às {endTime}.
                  </p>
                </div>
              </div>
            )}

            <div className="pt-4 flex items-center justify-end gap-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmittingWeekly}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  !weeklyValidation.valid ||
                  hasWeeklyConflict ||
                  isSubmittingWeekly
                }
                className="gap-2"
              >
                {isSubmittingWeekly ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  "Cadastrar horário"
                )}
              </Button>
            </div>
          </form>
        </TabsContent>

        {/* TAB: BLOQUEIO PONTUAL DE AGENDA */}
        <TabsContent value="exception">
          <form onSubmit={handleSubmitException} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor={professionalSelectId}>Profissional afetado</Label>
              <Select
                value={exceptionProfessional}
                onValueChange={(val) => setExceptionProfessional(val)}
              >
                <SelectTrigger id={professionalSelectId} className="w-full">
                  <SelectValue placeholder="Selecione o profissional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="clinic">
                    Toda a clínica (Recesso / Feriado geral)
                  </SelectItem>
                  {professionals.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={startsAtId}>Início do bloqueio</Label>
                <Input
                  id={startsAtId}
                  type="datetime-local"
                  value={exceptionStartsAt}
                  onChange={(e) => setExceptionStartsAt(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={endsAtId}>Fim do bloqueio</Label>
                <Input
                  id={endsAtId}
                  type="datetime-local"
                  value={exceptionEndsAt}
                  onChange={(e) => setExceptionEndsAt(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={reasonId}>
                Motivo do bloqueio / recesso (opcional)
              </Label>
              <Input
                id={reasonId}
                placeholder="Ex: Feriado Nacional, Férias, Congresso Médico"
                value={exceptionReason}
                onChange={(e) => setExceptionReason(e.target.value)}
                maxLength={100}
              />
              <p className="text-xs text-muted-foreground">
                Os slots da agenda neste período serão bloqueados para novos
                agendamentos.
              </p>
            </div>

            {exceptionStartsAt &&
              exceptionEndsAt &&
              !exceptionValidation.valid && (
                <div
                  data-testid="exception-validation-error"
                  className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive"
                >
                  <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                  <span>{exceptionValidation.error}</span>
                </div>
              )}

            <div className="pt-4 flex items-center justify-end gap-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmittingException}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={!exceptionValidation.valid || isSubmittingException}
                className="gap-2"
              >
                {isSubmittingException ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Salvando bloqueio...
                  </>
                ) : (
                  "Cadastrar bloqueio"
                )}
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export interface NewScheduleSheetProps {
  orgSlug: string;
  isOpen: boolean;
  onClose: () => void;
  weeklySchedule: WeeklyScheduleResponse;
  professionals: ScheduleProfessional[];
}

export function NewScheduleSheet({
  orgSlug,
  isOpen,
  onClose,
  weeklySchedule,
  professionals,
}: NewScheduleSheetProps) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="sm:max-w-lg w-full overflow-y-auto">
        <SheetHeader className="sr-only">
          <SheetTitle>Novo Horário ou Bloqueio</SheetTitle>
          <SheetDescription>
            Adicione uma nova regra recorrente de atendimento ou configure um
            recesso pontual na agenda da clínica.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <NewScheduleForm
            orgSlug={orgSlug}
            onClose={onClose}
            weeklySchedule={weeklySchedule}
            professionals={professionals}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
