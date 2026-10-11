"use client";

import { useForm, useStore } from "@tanstack/react-form";
import { MoonIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef } from "react";
import { toast } from "sonner";
import { saveHoursAction } from "@/app/onboarding/configure-hours/actions";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  type DaySchedule,
  daysFromSchedule,
  rulesFromDays,
  type Schedule,
  validateDays,
  weekdays,
} from "@/lib/onboarding-hours";

const timezones = [
  "America/Sao_Paulo",
  "America/Fortaleza",
  "America/Manaus",
  "America/Cuiaba",
  "America/Rio_Branco",
  "America/Noronha",
] as const;

const timezoneLabels: Record<string, string> = {
  "America/Sao_Paulo": "(UTC-03:00) Horário de Brasília",
  "America/Fortaleza": "(UTC-03:00) Fortaleza",
  "America/Manaus": "(UTC-04:00) Manaus",
  "America/Cuiaba": "(UTC-04:00) Cuiabá",
  "America/Rio_Branco": "(UTC-05:00) Rio Branco",
  "America/Noronha": "(UTC-02:00) Fernando de Noronha",
};

function formatTimezone(timezone: string) {
  return timezoneLabels[timezone] ?? timezone.replaceAll("_", " ");
}

function resolveSlotDuration(startTime: string, endTime: string) {
  const start =
    Number(startTime.slice(0, 2)) * 60 + Number(startTime.slice(3, 5));
  const end = Number(endTime.slice(0, 2)) * 60 + Number(endTime.slice(3, 5));
  const diff = end - start;
  return Number.isFinite(diff) && diff > 0 ? Math.min(30, diff) : 30;
}

const emptyInterval = () => ({
  id: crypto.randomUUID(),
  startTime: "09:00",
  endTime: "17:30",
  slotDurationMinutes: 30,
});

function createDefaultDays(initial: Schedule): DaySchedule[] {
  if (initial.weeklySchedule.length > 0) {
    return daysFromSchedule(initial.weeklySchedule);
  }
  return weekdays.map(({ id }) => {
    const isWeekday = id !== "SATURDAY" && id !== "SUNDAY";
    return {
      dayOfWeek: id,
      active: isWeekday,
      intervals: isWeekday
        ? [
            {
              id: `${id}-0`,
              startTime: "09:00",
              endTime: "17:30",
              slotDurationMinutes: 30,
            },
          ]
        : [],
    };
  });
}

export function ConfigureHoursForm({ initial }: { initial: Schedule }) {
  const router = useRouter();
  const previousActiveDaysRef = useRef<DaySchedule[] | null>(null);
  const form = useForm({
    defaultValues: {
      timezone: initial.timezone,
      days: createDefaultDays(initial),
    },
    validators: { onSubmit: ({ value }) => validateDays(value.days) },
    onSubmitInvalid: ({ value }) =>
      toast.error(
        validateDays(value.days) ?? "Confira os horários informados.",
      ),
    onSubmit: async ({ value }) => {
      const result = await saveHoursAction({
        timezone: value.timezone,
        weeklySchedule: rulesFromDays(value.days),
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Horários salvos.");
      router.replace("/");
    },
  });
  const days = useStore(form.store, (state) => state.values.days);
  const hasActiveDays = days.some((day) => day.active);

  const updateDay = (
    index: number,
    update: (day: DaySchedule) => DaySchedule,
  ) => {
    form.setFieldValue(
      "days",
      days.map((day, current) => (current === index ? update(day) : day)),
    );
  };

  const toggleAllDays = (enabled: boolean) => {
    if (!enabled) {
      previousActiveDaysRef.current = days;
      form.setFieldValue(
        "days",
        days.map((day) => ({ ...day, active: false })),
      );
      return;
    }
    const saved = previousActiveDaysRef.current;
    if (saved?.some((day) => day.active)) {
      form.setFieldValue("days", saved);
      return;
    }
    form.setFieldValue(
      "days",
      days.map((day) => {
        const isWeekday =
          day.dayOfWeek !== "SATURDAY" && day.dayOfWeek !== "SUNDAY";
        return {
          ...day,
          active: isWeekday,
          intervals:
            isWeekday && !day.intervals.length
              ? [emptyInterval()]
              : day.intervals,
        };
      }),
    );
  };

  return (
    <form
      className="mt-8 space-y-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <FieldLabel
            htmlFor="enable-business-hours"
            className="cursor-pointer text-sm font-medium"
          >
            Habilitar
          </FieldLabel>
          <p className="text-xs text-muted-foreground">
            Ative ou desative rapidamente os horários de atendimento
          </p>
        </div>
        <Switch
          id="enable-business-hours"
          checked={hasActiveDays}
          onCheckedChange={toggleAllDays}
          aria-label="Habilitar horários de atendimento"
        />
      </div>

      <form.Field name="timezone">
        {(field) => (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-4">
            <div className="space-y-0.5">
              <FieldLabel
                htmlFor="clinic-timezone"
                className="text-sm font-medium"
              >
                Fuso horário
              </FieldLabel>
              <p className="text-xs text-muted-foreground">
                Defina seu fuso horário
              </p>
            </div>
            <Select
              value={field.state.value}
              onValueChange={(value) =>
                field.handleChange(value ?? field.state.value)
              }
            >
              <SelectTrigger id="clinic-timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([initial.timezone, ...timezones])].map(
                  (timezone) => (
                    <SelectItem key={timezone} value={timezone}>
                      {formatTimezone(timezone)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <Separator />

      <div className="space-y-3">
        {weekdays.map(({ id, label }, index) => {
          const day = days[index];
          const interval = day.intervals[0] ?? {
            id: `${id}-0`,
            startTime: "09:00",
            endTime: "17:30",
            slotDurationMinutes: 30,
          };
          return (
            <div
              key={id}
              className="grid grid-cols-1 gap-2.5 sm:grid-cols-[160px_1fr] sm:items-center sm:gap-4"
            >
              <div className="flex items-center gap-3">
                <Switch
                  id={`day-${id}`}
                  checked={day.active}
                  onCheckedChange={(active) =>
                    updateDay(index, (current) => ({
                      ...current,
                      active,
                      intervals:
                        active && !current.intervals.length
                          ? [emptyInterval()]
                          : current.intervals.slice(0, 1),
                    }))
                  }
                  aria-label={`${label} aberto`}
                />
                <FieldLabel
                  htmlFor={`day-${id}`}
                  className="cursor-pointer whitespace-nowrap text-sm font-medium"
                >
                  {label}
                </FieldLabel>
              </div>

              {day.active ? (
                <div className="grid grid-cols-2 gap-3">
                  <InputGroup className="justify-between px-3">
                    <InputGroupAddon align="inline-start" className="p-0">
                      <InputGroupText>De</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      id={`${id}-0-start`}
                      aria-label={`Início de ${label}`}
                      type="time"
                      value={interval.startTime}
                      onChange={(event) => {
                        const startTime = event.target.value;
                        updateDay(index, (current) => {
                          const target = current.intervals[0] ?? emptyInterval();
                          return {
                            ...current,
                            intervals: [
                              {
                                ...target,
                                startTime,
                                slotDurationMinutes: resolveSlotDuration(
                                  startTime,
                                  target.endTime,
                                ),
                              },
                            ],
                          };
                        });
                      }}
                      className="w-auto flex-none px-0 text-right text-sm font-medium [&::-webkit-calendar-picker-indicator]:hidden"
                    />
                  </InputGroup>

                  <InputGroup className="justify-between px-3">
                    <InputGroupAddon align="inline-start" className="p-0">
                      <InputGroupText>Até</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput
                      id={`${id}-0-end`}
                      aria-label={`Fim de ${label}`}
                      type="time"
                      value={interval.endTime}
                      onChange={(event) => {
                        const endTime = event.target.value;
                        updateDay(index, (current) => {
                          const target = current.intervals[0] ?? emptyInterval();
                          return {
                            ...current,
                            intervals: [
                              {
                                ...target,
                                endTime,
                                slotDurationMinutes: resolveSlotDuration(
                                  target.startTime,
                                  endTime,
                                ),
                              },
                            ],
                          };
                        });
                      }}
                      className="w-auto flex-none px-0 text-right text-sm font-medium [&::-webkit-calendar-picker-indicator]:hidden"
                    />
                  </InputGroup>
                </div>
              ) : (
                <div className="flex h-[47px] items-center gap-2.5 rounded-lg bg-card/55 px-3.5 text-sm text-muted-foreground">
                  <MoonIcon className="size-4 text-muted-foreground" />
                  <span>Fechado</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(pending) => (
            <Button
              type="submit"
              disabled={pending}
              className="h-[46px] rounded-lg px-5 text-base font-normal"
            >
              {pending ? (
                <>
                  <Spinner className="mr-2 size-4" /> Salvando...
                </>
              ) : (
                "Continuar"
              )}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
