export type DayOfWeek =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export interface WeeklyScheduleRule {
  dayOfWeek: DayOfWeek;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  slotDurationMinutes: number;
}

export interface WeeklyScheduleResponse {
  timezone: string;
  rules: WeeklyScheduleRule[];
}

export interface ScheduleExceptionItem {
  id: string;
  professionalId: string | null;
  startsAt: string; // ISO-8601
  endsAt: string; // ISO-8601
  timezone: string;
  reason: string | null;
}

export interface ScheduleExceptionsResponse {
  timezone: string;
  exceptions: ScheduleExceptionItem[];
}

export interface ScheduleProfessional {
  id: string;
  name: string;
  role?: string;
}

export interface DayScheduleGroup {
  dayOfWeek: DayOfWeek;
  label: string;
  shortLabel: string;
  rules: WeeklyScheduleRule[];
  hasOverlap: boolean;
  totalIntervals: number;
}

export const DAYS_OF_WEEK: readonly DayOfWeek[] = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export const DAY_OF_WEEK_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Segunda-feira",
  TUESDAY: "Terça-feira",
  WEDNESDAY: "Quarta-feira",
  THURSDAY: "Quinta-feira",
  FRIDAY: "Sexta-feira",
  SATURDAY: "Sábado",
  SUNDAY: "Domingo",
};

export const DAY_OF_WEEK_SHORT_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Seg",
  TUESDAY: "Ter",
  WEDNESDAY: "Qua",
  THURSDAY: "Qui",
  FRIDAY: "Sex",
  SATURDAY: "Sáb",
  SUNDAY: "Dom",
};

/**
 * Converts "HH:MM" into total minutes from start of day.
 */
export function timeToMinutes(timeStr: string): number {
  if (!timeStr || !timeStr.includes(":")) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Checks whether any two intervals within the same rule list overlap.
 * Intervals [A, B] and [C, D] overlap if A < D and C < B.
 */
export function checkIntervalOverlap(rules: WeeklyScheduleRule[]): boolean {
  if (rules.length <= 1) return false;
  for (let i = 0; i < rules.length; i++) {
    const startA = timeToMinutes(rules[i].startTime);
    const endA = timeToMinutes(rules[i].endTime);
    for (let j = i + 1; j < rules.length; j++) {
      const startB = timeToMinutes(rules[j].startTime);
      const endB = timeToMinutes(rules[j].endTime);
      if (startA < endB && startB < endA) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Groups weekly schedule rules by the 7 days of the week in chronological order (Monday to Sunday),
 * sorts intervals by startTime, and identifies overlapping intervals per day.
 */
export function groupScheduleRulesByDay(
  rules: WeeklyScheduleRule[],
): DayScheduleGroup[] {
  return DAYS_OF_WEEK.map((day) => {
    const dayRules = (rules || [])
      .filter((r) => r.dayOfWeek === day)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
    const hasOverlap = checkIntervalOverlap(dayRules);
    return {
      dayOfWeek: day,
      label: DAY_OF_WEEK_LABELS[day],
      shortLabel: DAY_OF_WEEK_SHORT_LABELS[day],
      rules: dayRules,
      hasOverlap,
      totalIntervals: dayRules.length,
    };
  });
}

/**
 * Returns formatted timezone offset, e.g. "GMT-3".
 */
export function formatTimezoneOffset(
  timezone: string,
  date: Date = new Date(),
): string {
  try {
    const formatter = new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    });
    const parts = formatter.formatToParts(date);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value;
    if (tzName) {
      return tzName.replace("UTC", "GMT");
    }
  } catch {
    // fallback
  }
  return "GMT-3";
}

/**
 * Returns a prominent user-facing callout string for the clinic timezone,
 * e.g. "Fuso horário oficial: América/São Paulo (GMT-3)".
 */
export function formatTimezoneCallout(timezone?: string | null): string {
  const tz = timezone?.trim() || "America/Sao_Paulo";
  const offset = formatTimezoneOffset(tz);

  let friendly = tz;
  if (tz === "America/Sao_Paulo") friendly = "América/São Paulo";
  else if (tz === "America/Manaus") friendly = "América/Manaus";
  else if (tz === "America/Belem") friendly = "América/Belém";
  else if (tz === "America/Fortaleza") friendly = "América/Fortaleza";
  else if (tz === "America/Recife") friendly = "América/Recife";
  else if (tz === "America/Cuiaba") friendly = "América/Cuiabá";
  else friendly = tz.replace(/_/g, " ");

  return `Fuso horário oficial: ${friendly} (${offset})`;
}

/**
 * Formats a schedule exception date range into human-readable Brazilian Portuguese.
 */
export function formatExceptionDateRange(
  startsAt: string,
  endsAt: string,
  timezone = "America/Sao_Paulo",
): string {
  try {
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return `${startsAt} — ${endsAt}`;
    }

    const dateOpt: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    };
    const timeOpt: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
    };

    const startDateStr = new Intl.DateTimeFormat("pt-BR", dateOpt).format(
      start,
    );
    const endDateStr = new Intl.DateTimeFormat("pt-BR", dateOpt).format(end);
    const startTimeStr = new Intl.DateTimeFormat("pt-BR", timeOpt).format(
      start,
    );
    const endTimeStr = new Intl.DateTimeFormat("pt-BR", timeOpt).format(end);

    const isSameDate = startDateStr === endDateStr;
    if (isSameDate) {
      if (
        startTimeStr === "00:00" &&
        (endTimeStr === "23:59" || endTimeStr === "00:00")
      ) {
        return `${startDateStr} (Dia inteiro)`;
      }
      return `${startDateStr}, ${startTimeStr} – ${endTimeStr}`;
    }

    return `${startDateStr} às ${startTimeStr} – ${endDateStr} às ${endTimeStr}`;
  } catch {
    return `${startsAt} — ${endsAt}`;
  }
}

/**
 * Filters exceptions list by professional selection:
 * - "all" or undefined/null: returns all exceptions
 * - "clinic": returns exceptions where professionalId is null (affects all clinic)
 * - specific id: returns exceptions matching that professionalId
 */
export function filterExceptions(
  exceptions: ScheduleExceptionItem[],
  filterProfessionalId?: string | null,
): ScheduleExceptionItem[] {
  if (!filterProfessionalId || filterProfessionalId === "all") {
    return exceptions;
  }
  if (filterProfessionalId === "clinic") {
    return exceptions.filter((item) => item.professionalId === null);
  }
  return exceptions.filter(
    (item) => item.professionalId === filterProfessionalId,
  );
}
