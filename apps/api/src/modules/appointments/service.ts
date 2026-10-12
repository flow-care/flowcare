import type {
  AppointmentStatus,
  PrismaClient,
  ReceptionQueueStatus,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type {
  AvailabilityQuery,
  ListQuery,
  ReceptionQueueItem,
  ReceptionQueueQuery,
  ReceptionQueueResponse,
  ReceptionQueueTransitionBody,
} from "./model";

const MAX_RANGE_DAYS = 31;
const ACTIVE_STATUSES: AppointmentStatus[] = ["RESERVED", "CONFIRMED"];
const DAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

export const RECEPTION_QUEUE_TRANSITIONS: Readonly<
  Record<ReceptionQueueStatus, readonly ReceptionQueueStatus[]>
> = {
  WAITING: ["ARRIVED", "NO_SHOW"],
  ARRIVED: ["CALLED", "IN_SERVICE", "NO_SHOW"],
  CALLED: ["IN_SERVICE", "NO_SHOW"],
  IN_SERVICE: ["COMPLETED"],
  COMPLETED: [],
  NO_SHOW: [],
};

function dateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function zonedDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = dateParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    candidate += target - represented;
  }
  const result = new Date(candidate);
  const parts = dateParts(result, timeZone);
  if (
    parts.year !== String(year).padStart(4, "0") ||
    parts.month !== String(month).padStart(2, "0") ||
    parts.day !== String(day).padStart(2, "0") ||
    parts.hour !== String(hour).padStart(2, "0") ||
    parts.minute !== String(minute).padStart(2, "0")
  ) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Data ou horário inválido no fuso da clínica.",
    );
  }
  return result;
}

function localDateTime(date: Date, timeZone: string) {
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function localDate(date: Date, timeZone: string) {
  const parts = dateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function parseDate(date: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw new ApiError("VALIDATION_ERROR", 400, "Data inválida.");
  return parsed;
}

function addDays(date: string, days: number) {
  const parsed = parseDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function overlaps(
  start: Date,
  end: Date,
  blockedStart: Date,
  blockedEnd: Date,
) {
  return start < blockedEnd && blockedStart < end;
}

function resolveCurrentQueueStatus(row: {
  status: AppointmentStatus;
  queueStatus?: ReceptionQueueStatus | null;
}): ReceptionQueueStatus | "CANCELLED" {
  if (row.status === "CANCELLED") return "CANCELLED";
  if (row.status === "COMPLETED") return "COMPLETED";
  if (row.status === "NO_SHOW") return "NO_SHOW";
  return row.queueStatus ?? "WAITING";
}

function toReceptionQueueItem(
  row: {
    id: string;
    patientId: string;
    professionalId: string;
    scheduledAt: Date;
    durationMinutes: number;
    status: AppointmentStatus;
    queueStatus?: ReceptionQueueStatus | null;
    arrivedAt?: Date | null;
    queueUpdatedAt?: Date | null;
    queueUpdatedById?: string | null;
    version?: number | null;
  },
  timeZone: string,
): ReceptionQueueItem {
  const effectiveQueueStatus: ReceptionQueueStatus =
    row.status === "COMPLETED"
      ? "COMPLETED"
      : row.status === "NO_SHOW"
        ? "NO_SHOW"
        : (row.queueStatus ?? "WAITING");

  return {
    id: row.id,
    appointmentId: row.id,
    patientId: row.patientId,
    professionalId: row.professionalId,
    scheduledAt: row.scheduledAt.toISOString(),
    localScheduledAt: localDateTime(row.scheduledAt, timeZone),
    durationMinutes: row.durationMinutes,
    status: row.status,
    queueStatus: effectiveQueueStatus,
    arrivedAt: row.arrivedAt ? row.arrivedAt.toISOString() : null,
    queueUpdatedAt: row.queueUpdatedAt
      ? row.queueUpdatedAt.toISOString()
      : null,
    queueUpdatedById: row.queueUpdatedById ?? null,
    version: row.version ?? 0,
  };
}

export class AppointmentsService {
  constructor(private readonly prisma: PrismaClient) {}

  private async organization(organizationId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timezone: true },
    });
    try {
      new Intl.DateTimeFormat("en", { timeZone: organization.timezone });
    } catch {
      throw new ApiError("INTERNAL", 500, "Fuso horário da clínica inválido.");
    }
    return organization;
  }

  async list(organizationId: string, query: ListQuery) {
    const organization = await this.organization(organizationId);
    const start = parseDate(query.startDate);
    const end = parseDate(query.endDate);
    const rangeDays =
      Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (rangeDays < 1 || rangeDays > MAX_RANGE_DAYS)
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "O período deve ter entre 1 e 31 dias.",
      );

    const startAt = zonedDateTimeToUtc(
      query.startDate,
      "00:00",
      organization.timezone,
    );
    const endAt = zonedDateTimeToUtc(
      addDays(query.endDate, 1),
      "00:00",
      organization.timezone,
    );
    const limit = query.limit ?? 50;
    if (query.cursor) {
      const cursor = await this.prisma.appointment.findFirst({
        where: { id: query.cursor, organizationId },
        select: { id: true },
      });
      if (!cursor)
        throw new ApiError("VALIDATION_ERROR", 400, "Cursor inválido.");
    }
    const rows = await this.prisma.appointment.findMany({
      where: {
        organizationId,
        scheduledAt: { gte: startAt, lt: endAt },
        ...(query.professionalId
          ? { professionalId: query.professionalId }
          : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        patientId: true,
        professionalId: true,
        scheduledAt: true,
        durationMinutes: true,
        status: true,
      },
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      timeZone: organization.timezone,
      appointments: page.map((row) => ({
        ...row,
        scheduledAt: row.scheduledAt.toISOString(),
        localScheduledAt: localDateTime(row.scheduledAt, organization.timezone),
      })),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async availability(organizationId: string, query: AvailabilityQuery) {
    const organization = await this.organization(organizationId);
    const date = parseDate(query.date);
    const professional = await this.prisma.membership.findFirst({
      where: {
        organizationId,
        userId: query.professionalId,
        status: "ACTIVE",
        role: { in: ["PROFESSIONAL", "ADMIN_PROFESSIONAL"] },
      },
      select: { id: true },
    });
    if (!professional)
      throw new ApiError("NOT_FOUND", 404, "Profissional não encontrado.");

    const dayOfWeek = DAY_NAMES[date.getUTCDay()];
    const rules = await this.prisma.weeklyScheduleRule.findMany({
      where: { organizationId, dayOfWeek },
      orderBy: { startTime: "asc" },
    });
    const dayStart = zonedDateTimeToUtc(
      query.date,
      "00:00",
      organization.timezone,
    );
    const dayEnd = zonedDateTimeToUtc(
      addDays(query.date, 1),
      "00:00",
      organization.timezone,
    );
    const [appointments, pauses] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          organizationId,
          professionalId: query.professionalId,
          status: { in: ACTIVE_STATUSES },
          scheduledAt: {
            gte: new Date(dayStart.getTime() - 86_400_000),
            lt: dayEnd,
          },
        },
        select: { scheduledAt: true, durationMinutes: true },
      }),
      this.prisma.professionalSchedulePause.findMany({
        where: {
          organizationId,
          professionalId: query.professionalId,
          startsAt: { lt: dayEnd },
          endsAt: { gt: dayStart },
        },
        select: { startsAt: true, endsAt: true },
      }),
    ]);
    const blocked = [
      ...appointments.map((item) => ({
        start: item.scheduledAt,
        end: new Date(
          item.scheduledAt.getTime() + item.durationMinutes * 60_000,
        ),
      })),
      ...pauses.map((pause) => ({ start: pause.startsAt, end: pause.endsAt })),
    ];
    const slots = [];
    for (const rule of rules) {
      const intervalStart = zonedDateTimeToUtc(
        query.date,
        rule.startTime,
        organization.timezone,
      );
      const intervalEnd = zonedDateTimeToUtc(
        query.date,
        rule.endTime,
        organization.timezone,
      );
      for (
        let startsAt = intervalStart;
        startsAt.getTime() + rule.slotDurationMinutes * 60_000 <=
        intervalEnd.getTime();
        startsAt = new Date(
          startsAt.getTime() + rule.slotDurationMinutes * 60_000,
        )
      ) {
        const endsAt = new Date(
          startsAt.getTime() + rule.slotDurationMinutes * 60_000,
        );
        if (
          blocked.some((item) =>
            overlaps(startsAt, endsAt, item.start, item.end),
          )
        )
          continue;
        slots.push({
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          localStartsAt: localDateTime(startsAt, organization.timezone),
          localEndsAt: localDateTime(endsAt, organization.timezone),
        });
      }
    }
    return {
      date: query.date,
      professionalId: query.professionalId,
      timeZone: organization.timezone,
      slots,
    };
  }

  async listReceptionQueue(
    organizationId: string,
    query: ReceptionQueueQuery = {},
    now = new Date(),
  ): Promise<ReceptionQueueResponse> {
    if (
      query.status !== undefined &&
      query.queueStatus !== undefined &&
      query.status !== query.queueStatus
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Conflito entre status e queueStatus informados.",
        { field: "status" },
      );
    }

    const organization = await this.organization(organizationId);
    const targetDate = query.date ?? localDate(now, organization.timezone);
    parseDate(targetDate);

    const dayStart = zonedDateTimeToUtc(
      targetDate,
      "00:00",
      organization.timezone,
    );
    const dayEnd = zonedDateTimeToUtc(
      addDays(targetDate, 1),
      "00:00",
      organization.timezone,
    );
    const statusFilter = query.queueStatus ?? query.status;

    const rows = await this.prisma.appointment.findMany({
      where: {
        organizationId,
        scheduledAt: { gte: dayStart, lt: dayEnd },
        status: { not: "CANCELLED" },
        ...(query.professionalId
          ? { professionalId: query.professionalId }
          : {}),
        ...(statusFilter ? { queueStatus: statusFilter } : {}),
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        patientId: true,
        professionalId: true,
        scheduledAt: true,
        durationMinutes: true,
        status: true,
        queueStatus: true,
        arrivedAt: true,
        queueUpdatedAt: true,
        queueUpdatedById: true,
        version: true,
      },
    });

    return {
      date: targetDate,
      timeZone: organization.timezone,
      queue: rows.map((row) =>
        toReceptionQueueItem(row, organization.timezone),
      ),
    };
  }

  async transitionReceptionQueue(
    organizationId: string,
    actorUserId: string,
    appointmentId: string,
    body: ReceptionQueueTransitionBody,
    now = new Date(),
  ): Promise<ReceptionQueueItem> {
    if (
      body.status !== undefined &&
      body.queueStatus !== undefined &&
      body.status !== body.queueStatus
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Conflito entre status e queueStatus informados.",
        { field: "status" },
      );
    }

    const targetStatus = body.queueStatus ?? body.status;
    if (!targetStatus) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "O estado de destino da fila é obrigatório.",
        { field: "status" },
      );
    }

    const organization = await this.organization(organizationId);

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.appointment.findFirst({
        where: { id: appointmentId, organizationId },
        select: {
          id: true,
          patientId: true,
          professionalId: true,
          scheduledAt: true,
          durationMinutes: true,
          status: true,
          queueStatus: true,
          arrivedAt: true,
          queueUpdatedAt: true,
          queueUpdatedById: true,
          version: true,
        },
      });

      if (!current) {
        throw new ApiError("NOT_FOUND", 404, "Agendamento não encontrado.");
      }

      const currentVersion = current.version ?? 0;
      if (currentVersion !== body.version) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "O agendamento foi atualizado em outra sessão. Recarregue a fila.",
        );
      }

      const fromStatus = resolveCurrentQueueStatus(current);
      const allowedTransitions =
        fromStatus === "CANCELLED"
          ? []
          : RECEPTION_QUEUE_TRANSITIONS[fromStatus];

      if (!allowedTransitions.includes(targetStatus)) {
        throw new ApiError(
          "INVALID_STATE_TRANSITION",
          409,
          `Transição inválida de ${fromStatus} para ${targetStatus}.`,
          {
            from: fromStatus,
            to: targetStatus,
            allowedTransitions: [...allowedTransitions],
          },
        );
      }

      const nextAppointmentStatus: AppointmentStatus =
        targetStatus === "COMPLETED"
          ? "COMPLETED"
          : targetStatus === "NO_SHOW"
            ? "NO_SHOW"
            : current.status;
      const nextArrivedAt =
        targetStatus === "ARRIVED"
          ? (current.arrivedAt ?? now)
          : (current.arrivedAt ?? null);
      const nextVersion = currentVersion + 1;

      const updated = await tx.appointment.updateMany({
        where: {
          id: appointmentId,
          organizationId,
          version: body.version,
          status: current.status,
          queueStatus: current.queueStatus,
        },
        data: {
          status: nextAppointmentStatus,
          queueStatus: targetStatus,
          arrivedAt: nextArrivedAt,
          queueUpdatedAt: now,
          queueUpdatedById: actorUserId,
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "O agendamento foi atualizado em outra sessão. Recarregue a fila.",
        );
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: "RECEPTION_QUEUE_UPDATED",
          targetType: "APPOINTMENT",
          targetId: current.id,
          metadata: {
            fromStatus,
            toStatus: targetStatus,
            appointmentStatus: nextAppointmentStatus,
            arrivedAt: nextArrivedAt ? nextArrivedAt.toISOString() : null,
            transitionedAt: now.toISOString(),
            version: nextVersion,
          },
        },
      });

      return toReceptionQueueItem(
        {
          ...current,
          status: nextAppointmentStatus,
          queueStatus: targetStatus,
          arrivedAt: nextArrivedAt,
          queueUpdatedAt: now,
          queueUpdatedById: actorUserId,
          version: nextVersion,
        },
        organization.timezone,
      );
    });
  }
}
