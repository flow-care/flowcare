"use client";

import { useForm, useStore } from "@tanstack/react-form";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveHoursAction } from "@/app/onboarding/configure-hours/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

const emptyInterval = () => ({
  id: crypto.randomUUID(),
  startTime: "08:00",
  endTime: "12:00",
  slotDurationMinutes: 30,
});

export function ConfigureHoursForm({ initial }: { initial: Schedule }) {
  const router = useRouter();
  const form = useForm({
    defaultValues: {
      timezone: initial.timezone,
      days: daysFromSchedule(initial.weeklySchedule),
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
  const updateDay = (
    index: number,
    update: (day: DaySchedule) => DaySchedule,
  ) => {
    form.setFieldValue(
      "days",
      days.map((day, current) => (current === index ? update(day) : day)),
    );
  };

  return (
    <form
      className="mt-8 space-y-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field name="timezone">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="clinic-timezone">
              Fuso horário da clínica
            </FieldLabel>
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
                      {timezone.replaceAll("_", " ")}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>
      <div className="space-y-4">
        {weekdays.map(({ id, label }, index) => {
          const day = days[index];
          return (
            <section key={id} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-4">
                <FieldLabel htmlFor={`day-${id}`} className="font-medium">
                  {label}
                </FieldLabel>
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
                          : current.intervals,
                    }))
                  }
                  aria-label={`${label} aberto`}
                />
              </div>
              {day.active && (
                <div className="mt-4 space-y-4">
                  {day.intervals.map((interval, intervalIndex) => (
                    <div
                      key={interval.id}
                      className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                    >
                      <Field>
                        <FieldLabel htmlFor={`${id}-${intervalIndex}-start`}>
                          Início
                        </FieldLabel>
                        <Input
                          id={`${id}-${intervalIndex}-start`}
                          type="time"
                          value={interval.startTime}
                          onChange={(event) =>
                            updateDay(index, (current) => ({
                              ...current,
                              intervals: current.intervals.map((item, i) =>
                                i === intervalIndex
                                  ? { ...item, startTime: event.target.value }
                                  : item,
                              ),
                            }))
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`${id}-${intervalIndex}-end`}>
                          Fim
                        </FieldLabel>
                        <Input
                          id={`${id}-${intervalIndex}-end`}
                          type="time"
                          value={interval.endTime}
                          onChange={(event) =>
                            updateDay(index, (current) => ({
                              ...current,
                              intervals: current.intervals.map((item, i) =>
                                i === intervalIndex
                                  ? { ...item, endTime: event.target.value }
                                  : item,
                              ),
                            }))
                          }
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover intervalo de ${label}`}
                        onClick={() =>
                          updateDay(index, (current) => ({
                            ...current,
                            intervals: current.intervals.filter(
                              (_, i) => i !== intervalIndex,
                            ),
                          }))
                        }
                      >
                        <Trash2Icon />
                      </Button>
                      <Field className="col-span-2">
                        <FieldLabel htmlFor={`${id}-${intervalIndex}-duration`}>
                          Duração dos atendimentos (minutos)
                        </FieldLabel>
                        <Input
                          id={`${id}-${intervalIndex}-duration`}
                          type="number"
                          min={1}
                          max={1440}
                          value={interval.slotDurationMinutes}
                          onChange={(event) =>
                            updateDay(index, (current) => ({
                              ...current,
                              intervals: current.intervals.map((item, i) =>
                                i === intervalIndex
                                  ? {
                                      ...item,
                                      slotDurationMinutes: Number(
                                        event.target.value,
                                      ),
                                    }
                                  : item,
                              ),
                            }))
                          }
                        />
                      </Field>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      updateDay(index, (current) => ({
                        ...current,
                        intervals: [...current.intervals, emptyInterval()],
                      }))
                    }
                  >
                    <PlusIcon /> Adicionar intervalo
                  </Button>
                </div>
              )}
            </section>
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
