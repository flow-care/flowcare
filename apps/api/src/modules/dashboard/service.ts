import type {
  AppointmentStatus,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type { DashboardQuery } from "./model";

function invalidPeriod(): never {
  throw new ApiError("VALIDATION_ERROR", 400, "Período inválido.");
}

function parseDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return invalidPeriod();
  return date;
}

function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function addDays(value: string, days: number): string {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localMidnightUtc(value: string, timeZone: string): Date {
  const target = parseDate(value).getTime();
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const represented = parseDate(
      localDate(new Date(instant), timeZone),
    ).getTime();
    const hourParts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const clock = Object.fromEntries(
      hourParts.map((part) => [part.type, part.value]),
    );
    const localTime =
      represented +
      Number(clock.hour) * 3_600_000 +
      Number(clock.minute) * 60_000 +
      Number(clock.second) * 1_000;
    instant += target - localTime;
  }
  if (localDate(new Date(instant), timeZone) !== value) return invalidPeriod();
  return new Date(instant);
}

function calculateMetricsPeriod(
  query: DashboardQuery,
  timeZone: string,
  now = new Date(),
) {
  if (query.period && (query.startDate || query.endDate))
    return invalidPeriod();
  if (Boolean(query.startDate) !== Boolean(query.endDate))
    return invalidPeriod();

  let startDate: string;
  let endDate: string;
  if (query.startDate && query.endDate) {
    startDate = query.startDate;
    endDate = query.endDate;
  } else {
    const today = localDate(now, timeZone);
    if (query.period === "week") {
      const weekday = parseDate(today).getUTCDay();
      startDate = addDays(today, -((weekday + 6) % 7));
      endDate = addDays(startDate, 7);
    } else if (query.period === "month") {
      startDate = `${today.slice(0, 7)}-01`;
      const [year, month] = startDate.split("-").map(Number) as [
        number,
        number,
      ];
      endDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    } else {
      startDate = today;
      endDate = addDays(today, 1);
    }
  }

  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (end < start || end.getTime() - start.getTime() > 366 * 86_400_000)
    return invalidPeriod();
  return {
    periodStart: localMidnightUtc(startDate, timeZone),
    periodEnd: localMidnightUtc(endDate, timeZone),
  };
}

export function metricsPeriod(
  query: DashboardQuery,
  timeZone: string,
  now = new Date(),
) {
  try {
    return calculateMetricsPeriod(query, timeZone, now);
  } catch (error) {
    if (error instanceof RangeError) return invalidPeriod();
    throw error;
  }
}

export class DashboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async metrics(
    organizationId: string,
    query: DashboardQuery,
    now = new Date(),
  ) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    if (!organization)
      throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
    const timeZone = organization.timezone || "America/Sao_Paulo";
    const period = metricsPeriod(query, timeZone, now);
    const rows = await this.prisma.appointment.groupBy({
      by: ["status"],
      where: {
        organizationId,
        scheduledAt: { gte: period.periodStart, lt: period.periodEnd },
      },
      _count: { _all: true },
    });
    const counts: Record<AppointmentStatus, number> = {
      RESERVED: 0,
      CONFIRMED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      NO_SHOW: 0,
    };
    for (const row of rows) counts[row.status] = row._count._all;
    const scheduledAppointments = counts.RESERVED + counts.CONFIRMED;
    const completedAppointments = counts.COMPLETED;
    const cancelledAppointments = counts.CANCELLED;
    const noShowAppointments = counts.NO_SHOW;
    const denominator = completedAppointments + noShowAppointments;
    const noShowRate = denominator
      ? Math.round((noShowAppointments / denominator) * 10_000) / 10_000
      : null;
    return {
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      timeZone,
      totalAppointments:
        scheduledAppointments +
        completedAppointments +
        cancelledAppointments +
        noShowAppointments,
      scheduledAppointments,
      completedAppointments,
      cancelledAppointments,
      noShowAppointments,
      noShowRate,
    };
  }
}
