export const weekdays = [
  { id: "MONDAY", label: "Segunda-feira" },
  { id: "TUESDAY", label: "Terça-feira" },
  { id: "WEDNESDAY", label: "Quarta-feira" },
  { id: "THURSDAY", label: "Quinta-feira" },
  { id: "FRIDAY", label: "Sexta-feira" },
  { id: "SATURDAY", label: "Sábado" },
  { id: "SUNDAY", label: "Domingo" },
] as const;

export type Weekday = (typeof weekdays)[number]["id"];
export type ScheduleRule = {
  dayOfWeek: Weekday;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
};
export type Schedule = { timezone: string; weeklySchedule: ScheduleRule[] };
export type DaySchedule = {
  dayOfWeek: Weekday;
  active: boolean;
  intervals: (Omit<ScheduleRule, "dayOfWeek"> & { id: string })[];
};

export function daysFromSchedule(rules: ScheduleRule[]): DaySchedule[] {
  return weekdays.map(({ id }) => {
    const intervals = rules
      .filter((rule) => rule.dayOfWeek === id)
      .map(({ startTime, endTime, slotDurationMinutes }, index) => ({
        id: `${id}-${index}`,
        startTime,
        endTime,
        slotDurationMinutes,
      }));
    return { dayOfWeek: id, active: intervals.length > 0, intervals };
  });
}

export function validateDays(days: DaySchedule[]): string | undefined {
  const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  let count = 0;
  for (const day of days) {
    if (!day.active) continue;
    const label = weekdays.find(({ id }) => id === day.dayOfWeek)?.label;
    if (!day.intervals.length) return `Adicione um intervalo para ${label}.`;
    count += day.intervals.length;
    for (const interval of day.intervals) {
      if (
        !timePattern.test(interval.startTime) ||
        !timePattern.test(interval.endTime)
      )
        return `Informe horários válidos para ${label}.`;
      const start =
        Number(interval.startTime.slice(0, 2)) * 60 +
        Number(interval.startTime.slice(3));
      const end =
        Number(interval.endTime.slice(0, 2)) * 60 +
        Number(interval.endTime.slice(3));
      if (start >= end) return `O início deve ser anterior ao fim em ${label}.`;
      if (
        !Number.isInteger(interval.slotDurationMinutes) ||
        interval.slotDurationMinutes < 1 ||
        interval.slotDurationMinutes > end - start
      )
        return `A duração dos atendimentos não cabe no intervalo de ${label}.`;
      if (
        day.intervals.some(
          (other) =>
            other !== interval &&
            timePattern.test(other.startTime) &&
            timePattern.test(other.endTime) &&
            start <
              Number(other.endTime.slice(0, 2)) * 60 +
                Number(other.endTime.slice(3)) &&
            Number(other.startTime.slice(0, 2)) * 60 +
              Number(other.startTime.slice(3)) <
              end,
        )
      )
        return `Há horários sobrepostos em ${label}.`;
    }
  }
  if (count > 100) return "Limite de 100 intervalos excedido.";
  return undefined;
}

export function rulesFromDays(days: DaySchedule[]): ScheduleRule[] {
  return days.flatMap((day) =>
    day.active
      ? day.intervals.map(({ startTime, endTime, slotDurationMinutes }) => ({
          dayOfWeek: day.dayOfWeek,
          startTime,
          endTime,
          slotDurationMinutes,
        }))
      : [],
  );
}
