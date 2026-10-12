import type {
  AppointmentStatus,
  ConfirmationDecisionOrigin,
  ConfirmationDecisionStatus,
  PrismaClient,
  ReceptionQueueStatus,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type {
  AvailabilityQuery,
  CancelAppointmentBody,
  CancelAppointmentResponse,
  ConfirmationDecisionBody,
  ConfirmationDecisionResponse,
  ConfirmationItem,
  CreateAppointmentBody,
  CreateAppointmentResponse,
  ListQuery,
  PendingConfirmationsQuery,
  PendingConfirmationsResponse,
  ReceptionQueueItem,
  ReceptionQueueQuery,
  ReceptionQueueResponse,
  ReceptionQueueTransitionBody,
  UpdateAppointmentBody,
  UpdateAppointmentResponse,
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

type AppointmentSummaryRecord = {
  id: string;
  patientId: string;
  professionalId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
};

type ConfirmationRecord = {
  id: string;
  organizationId: string;
  appointmentId: string;
  status: ConfirmationDecisionStatus;
  origin: ConfirmationDecisionOrigin | null;
  originalMessage: string | null;
  originalMessageId: string | null;
  originalMessageAt: Date | null;
  note: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type CreatedAppointmentRecord = {
  id: string;
  patientId: string;
  professionalId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  notes: string | null;
  createdAt: Date;
  version?: number;
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

function parseUtcDateTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(value)) {
    throw new ApiError("VALIDATION_ERROR", 400, "Horário inválido.", {
      field: "scheduledAt",
    });
  }
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value.slice(0, 10)
  ) {
    throw new ApiError("VALIDATION_ERROR", 400, "Horário inválido.", {
      field: "scheduledAt",
    });
  }
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

function isUniqueConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function formatConfirmationItem(
  confirmation: ConfirmationRecord,
  appointment: AppointmentSummaryRecord,
  timeZone: string,
): ConfirmationItem {
  return {
    id: confirmation.id,
    appointmentId: confirmation.appointmentId,
    organizationId: confirmation.organizationId,
    patientId: appointment.patientId,
    professionalId: appointment.professionalId,
    scheduledAt: appointment.scheduledAt.toISOString(),
    localScheduledAt: localDateTime(appointment.scheduledAt, timeZone),
    durationMinutes: appointment.durationMinutes,
    appointmentStatus: appointment.status,
    status: confirmation.status,
    decision: confirmation.status,
    origin: confirmation.origin,
    source: confirmation.origin,
    originalMessage: confirmation.originalMessage,
    originalMessageId: confirmation.originalMessageId,
    originalMessageAt: confirmation.originalMessageAt
      ? confirmation.originalMessageAt.toISOString()
      : null,
    note: confirmation.note,
    decidedById: confirmation.decidedById,
    decidedAt: confirmation.decidedAt
      ? confirmation.decidedAt.toISOString()
      : null,
    createdAt: confirmation.createdAt.toISOString(),
    updatedAt: confirmation.updatedAt.toISOString(),
  };
}

function nextStatusForDecision(
  decision: ConfirmationDecisionStatus,
): AppointmentStatus {
  if (decision === "CONFIRMED") return "CONFIRMED";
  if (decision === "DECLINED") return "CANCELLED";
  return "RESERVED";
}

function isExclusionConflict(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const err = error as {
    code?: string;
    message?: string;
    meta?: { code?: string; constraint?: string };
  };
  return (
    err.code === "23P01" ||
    err.meta?.code === "23P01" ||
    (typeof err.message === "string" &&
      (err.message.includes("23P01") ||
        err.message.includes("Appointment_no_overlapping_active_slots")))
  );
}

function responseForCreated(
  appointment: CreatedAppointmentRecord,
  timeZone: string,
): CreateAppointmentResponse {
  const endsAt = new Date(
    appointment.scheduledAt.getTime() + appointment.durationMinutes * 60_000,
  );
  return {
    timeZone,
    appointment: {
      id: appointment.id,
      patientId: appointment.patientId,
      professionalId: appointment.professionalId,
      scheduledAt: appointment.scheduledAt.toISOString(),
      endsAt: endsAt.toISOString(),
      localScheduledAt: localDateTime(appointment.scheduledAt, timeZone),
      localEndsAt: localDateTime(endsAt, timeZone),
      durationMinutes: appointment.durationMinutes,
      status: appointment.status,
      notes: appointment.notes,
      createdAt: appointment.createdAt.toISOString(),
      ...(appointment.version !== undefined
        ? { version: appointment.version }
        : {}),
    },
  };
}
export class AppointmentsService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly prisma: PrismaClient) {}

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => current);
    this.locks.set(key, chain);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chain) {
        this.locks.delete(key);
      }
    }
  }

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
        version: true,
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
    const [appointments, pauses, exceptions] = await Promise.all([
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
      this.prisma.scheduleException.findMany({
        where: {
          organizationId,
          OR: [
            { professionalId: null },
            { professionalId: query.professionalId },
          ],
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
      ...exceptions.map((item) => ({ start: item.startsAt, end: item.endsAt })),
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

  async listPendingConfirmations(
    organizationId: string,
    query: PendingConfirmationsQuery = {},
  ): Promise<PendingConfirmationsResponse> {
    const organization = await this.organization(organizationId);
    const status: ConfirmationDecisionStatus = query.status ?? "PENDING";
    const limit = query.limit ?? 20;

    if (query.cursor) {
      const cursor = await this.prisma.appointmentConfirmation.findFirst({
        where: { id: query.cursor, organizationId },
        select: { id: true },
      });
      if (!cursor)
        throw new ApiError("VALIDATION_ERROR", 400, "Cursor inválido.");
    }

    const rows = await this.prisma.appointmentConfirmation.findMany({
      where: {
        organizationId,
        status,
        ...(query.professionalId
          ? { appointment: { professionalId: query.professionalId } }
          : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        appointment: {
          select: {
            id: true,
            patientId: true,
            professionalId: true,
            scheduledAt: true,
            durationMinutes: true,
            status: true,
          },
        },
      },
    });

    const hasNextPage = rows.length > limit;
    const page = rows.slice(0, limit);

    return {
      timeZone: organization.timezone,
      data: page.map((row) =>
        formatConfirmationItem(row, row.appointment, organization.timezone),
      ),
      pageInfo: {
        nextCursor: hasNextPage ? (page.at(-1)?.id ?? null) : null,
        hasNextPage,
      },
    };
  }

  async recordConfirmationDecision(
    organizationId: string,
    actorUserId: string,
    appointmentId: string,
    body: ConfirmationDecisionBody,
    idempotencyKey?: string,
  ): Promise<ConfirmationDecisionResponse> {
    if (!body.origin && !body.source) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Origem da decisão é obrigatória.",
        { field: "origin" },
      );
    }
    if (body.origin && body.source && body.origin !== body.source) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Origem da decisão inconsistente.",
        { field: "origin" },
      );
    }

    const origin = (body.origin ?? body.source)!;
    const note = body.note?.trim() ? body.note.trim() : null;
    const normalizedKey = idempotencyKey?.trim() || undefined;
    const requestHash = new Bun.CryptoHasher("sha256")
      .update(
        JSON.stringify({
          appointmentId,
          decision: body.decision,
          origin,
          note,
        }),
      )
      .digest("hex");

    const organization = await this.organization(organizationId);

    if (normalizedKey) {
      const replay = await this.findDecisionReplay(
        organizationId,
        appointmentId,
        normalizedKey,
        requestHash,
        organization.timezone,
      );
      if (replay) return replay;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (normalizedKey) {
          const existingByKey = await tx.confirmationDecision.findUnique({
            where: {
              organizationId_idempotencyKey: {
                organizationId,
                idempotencyKey: normalizedKey,
              },
            },
            include: {
              confirmation: true,
              appointment: {
                select: {
                  id: true,
                  patientId: true,
                  professionalId: true,
                  scheduledAt: true,
                  durationMinutes: true,
                  status: true,
                },
              },
            },
          });
          if (existingByKey) {
            if (
              existingByKey.requestHash !== requestHash ||
              existingByKey.appointmentId !== appointmentId
            ) {
              throw new ApiError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "A chave de idempotência já foi usada com outros dados.",
              );
            }
            return {
              confirmation: formatConfirmationItem(
                existingByKey.confirmation,
                existingByKey.appointment,
                organization.timezone,
              ),
            };
          }
        }

        const appointment = await tx.appointment.findFirst({
          where: { id: appointmentId, organizationId },
          select: {
            id: true,
            patientId: true,
            professionalId: true,
            scheduledAt: true,
            durationMinutes: true,
            status: true,
            cancelledAt: true,
          },
        });
        if (!appointment) {
          throw new ApiError("NOT_FOUND", 404, "Agendamento não encontrado.");
        }
        if (appointment.cancelledAt) {
          throw new ApiError(
            "INVALID_STATE_TRANSITION",
            409,
            "Agendamento cancelado não aceita novas decisões de confirmação.",
          );
        }
        if (
          appointment.status === "COMPLETED" ||
          appointment.status === "NO_SHOW"
        ) {
          throw new ApiError(
            "BUSINESS_RULE_VIOLATION",
            422,
            "Não é possível registrar decisão de confirmação para agendamento já encerrado.",
          );
        }

        const existingConfirmation = await tx.appointmentConfirmation.findFirst(
          {
            where: { appointmentId, organizationId },
          },
        );

        if (
          existingConfirmation &&
          existingConfirmation.decidedAt !== null &&
          existingConfirmation.status === body.decision &&
          existingConfirmation.origin === origin &&
          (existingConfirmation.note ?? null) === note
        ) {
          return {
            confirmation: formatConfirmationItem(
              existingConfirmation,
              appointment,
              organization.timezone,
            ),
          };
        }

        const nextAppointmentStatus = nextStatusForDecision(body.decision);
        const updatedAppointment =
          appointment.status === nextAppointmentStatus
            ? appointment
            : await tx.appointment.update({
                where: { id: appointment.id, cancelledAt: null },
                data: { status: nextAppointmentStatus },
                select: {
                  id: true,
                  patientId: true,
                  professionalId: true,
                  scheduledAt: true,
                  durationMinutes: true,
                  status: true,
                },
              });

        const now = new Date();
        // Original message fields (originalMessage, originalMessageId, originalMessageAt)
        // are never included in update data so the original message remains immutable.
        const savedConfirmation = existingConfirmation
          ? await tx.appointmentConfirmation.update({
              where: { id: existingConfirmation.id },
              data: {
                status: body.decision,
                origin,
                note,
                decidedById: actorUserId,
                decidedAt: now,
              },
            })
          : await tx.appointmentConfirmation.create({
              data: {
                organizationId,
                appointmentId: appointment.id,
                status: body.decision,
                origin,
                note,
                decidedById: actorUserId,
                decidedAt: now,
              },
            });

        const decisionRecord = await tx.confirmationDecision.create({
          data: {
            organizationId,
            appointmentId: appointment.id,
            confirmationId: savedConfirmation.id,
            decision: body.decision,
            origin,
            note,
            decidedById: actorUserId,
            decidedAt: now,
            idempotencyKey: normalizedKey ?? null,
            requestHash,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId,
            action: "MANUAL_CONFIRMATION_DECIDED",
            targetType: "APPOINTMENT",
            targetId: appointment.id,
            metadata: {
              confirmationId: savedConfirmation.id,
              decisionId: decisionRecord.id,
              previousStatus: existingConfirmation?.status ?? "PENDING",
              decision: body.decision,
              origin,
              appointmentStatus: updatedAppointment.status,
              decidedAt: now.toISOString(),
            },
          },
        });

        return {
          confirmation: formatConfirmationItem(
            savedConfirmation,
            updatedAppointment,
            organization.timezone,
          ),
        };
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2025"
      ) {
        throw new ApiError(
          "INVALID_STATE_TRANSITION",
          409,
          "Agendamento cancelado não aceita novas decisões de confirmação.",
        );
      }
      if (!normalizedKey || !isUniqueConflict(error)) throw error;
      const concurrentReplay = await this.findDecisionReplay(
        organizationId,
        appointmentId,
        normalizedKey,
        requestHash,
        organization.timezone,
      );
      if (concurrentReplay) return concurrentReplay;
      throw new ApiError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "A chave de idempotência está em uso.",
      );
    }
  }

  private async findDecisionReplay(
    organizationId: string,
    appointmentId: string,
    idempotencyKey: string,
    requestHash: string,
    timeZone: string,
  ): Promise<ConfirmationDecisionResponse | null> {
    const existing = await this.prisma.confirmationDecision.findUnique({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey },
      },
      include: {
        confirmation: true,
        appointment: {
          select: {
            id: true,
            patientId: true,
            professionalId: true,
            scheduledAt: true,
            durationMinutes: true,
            status: true,
          },
        },
      },
    });
    if (!existing) return null;
    if (
      existing.requestHash !== requestHash ||
      existing.appointmentId !== appointmentId
    ) {
      throw new ApiError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "A chave de idempotência já foi usada com outros dados.",
      );
    }
    return {
      confirmation: formatConfirmationItem(
        existing.confirmation,
        existing.appointment,
        timeZone,
      ),
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

  async update(
    organizationId: string,
    actorUserId: string,
    appointmentId: string,
    body: UpdateAppointmentBody,
    now = new Date(),
  ): Promise<UpdateAppointmentResponse> {
    if (Object.keys(body).every((key) => key === "version")) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Informe ao menos um campo para alterar.",
      );
    }
    const organization = await this.organization(organizationId);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.appointment.findFirst({
          where: { id: appointmentId, organizationId },
          select: {
            id: true,
            patientId: true,
            professionalId: true,
            scheduledAt: true,
            durationMinutes: true,
            status: true,
            notes: true,
            version: true,
          },
        });
        if (!current)
          throw new ApiError("NOT_FOUND", 404, "Agendamento não encontrado.");
        if (current.version !== body.version) {
          throw new ApiError(
            "VERSION_CONFLICT",
            409,
            "O agendamento foi atualizado em outra sessão.",
          );
        }
        if (!ACTIVE_STATUSES.includes(current.status)) {
          throw new ApiError(
            "INVALID_STATE_TRANSITION",
            409,
            "Agendamento em estado terminal não pode ser alterado.",
          );
        }

        const patientId = body.patientId ?? current.patientId;
        const professionalId = body.professionalId ?? current.professionalId;
        const scheduledAt = body.scheduledAt
          ? parseUtcDateTime(body.scheduledAt)
          : current.scheduledAt;
        const durationMinutes = body.durationMinutes ?? current.durationMinutes;
        const notes =
          body.notes === undefined ? current.notes : body.notes?.trim() || null;
        const endsAt = new Date(
          scheduledAt.getTime() + durationMinutes * 60_000,
        );
        const scheduleChanged =
          professionalId !== current.professionalId ||
          scheduledAt.getTime() !== current.scheduledAt.getTime() ||
          durationMinutes !== current.durationMinutes;

        if (body.patientId !== undefined && patientId !== current.patientId) {
          const patient = await tx.patient.findFirst({
            where: { id: patientId, organizationId },
            select: { id: true },
          });
          if (!patient)
            throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
        }
        if (scheduleChanged) {
          if (
            typeof (tx as { $executeRaw?: unknown }).$executeRaw === "function"
          ) {
            // Matches the advisory lock used by appointment creation.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}), hashtext(${professionalId}))`;
          }
          const professional = await tx.membership.findFirst({
            where: {
              organizationId,
              userId: professionalId,
              status: "ACTIVE",
              role: { in: ["PROFESSIONAL", "ADMIN_PROFESSIONAL"] },
            },
            select: { id: true },
          });
          if (!professional)
            throw new ApiError(
              "NOT_FOUND",
              404,
              "Profissional não encontrado.",
            );

          const parts = dateParts(scheduledAt, organization.timezone);
          const date = `${parts.year}-${parts.month}-${parts.day}`;
          const dayOfWeek = DAY_NAMES[parseDate(date).getUTCDay()] ?? "SUNDAY";
          const rules = await tx.weeklyScheduleRule.findMany({
            where: { organizationId, dayOfWeek },
            orderBy: { startTime: "asc" },
          });
          const fitsSchedule = rules.some((rule) => {
            const start = zonedDateTimeToUtc(
              date,
              rule.startTime,
              organization.timezone,
            );
            const end = zonedDateTimeToUtc(
              date,
              rule.endTime,
              organization.timezone,
            );
            return scheduledAt >= start && endsAt <= end;
          });
          if (!fitsSchedule) {
            throw new ApiError(
              "SLOT_CONFLICT",
              409,
              "O horário está fora do expediente configurado para a clínica.",
              { reason: "OUTSIDE_WORKING_HOURS" },
            );
          }
          const exception = await tx.scheduleException.findFirst({
            where: {
              organizationId,
              OR: [{ professionalId: null }, { professionalId }],
              startsAt: { lt: endsAt },
              endsAt: { gt: scheduledAt },
            },
            select: { startsAt: true, endsAt: true },
          });
          if (exception)
            throw new ApiError(
              "SLOT_CONFLICT",
              409,
              "O horário conflita com uma exceção da agenda.",
              { reason: "SCHEDULE_PAUSE" },
            );
          const pauses = await tx.professionalSchedulePause.findMany({
            where: {
              organizationId,
              professionalId,
              startsAt: { lt: endsAt },
              endsAt: { gt: scheduledAt },
            },
            select: { startsAt: true, endsAt: true },
          });
          if (
            pauses.some((pause) =>
              overlaps(scheduledAt, endsAt, pause.startsAt, pause.endsAt),
            )
          ) {
            throw new ApiError(
              "SLOT_CONFLICT",
              409,
              "O horário conflita com uma pausa do profissional.",
              { reason: "SCHEDULE_PAUSE" },
            );
          }
          const otherAppointments = await tx.appointment.findMany({
            where: {
              organizationId,
              professionalId,
              id: { not: appointmentId },
              status: { in: ACTIVE_STATUSES },
              scheduledAt: {
                gte: new Date(scheduledAt.getTime() - 86_400_000),
                lt: endsAt,
              },
            },
            select: { id: true, scheduledAt: true, durationMinutes: true },
          });
          if (
            otherAppointments.some((item) =>
              overlaps(
                scheduledAt,
                endsAt,
                item.scheduledAt,
                new Date(
                  item.scheduledAt.getTime() + item.durationMinutes * 60_000,
                ),
              ),
            )
          ) {
            throw new ApiError(
              "SLOT_CONFLICT",
              409,
              "O horário conflita com outro agendamento do profissional.",
              { reason: "APPOINTMENT_OVERLAP" },
            );
          }
        }

        const changed: Record<
          string,
          { before: string | number | null; after: string | number | null }
        > = {};
        const changes = {
          patientId: [current.patientId, patientId],
          professionalId: [current.professionalId, professionalId],
          scheduledAt: [
            current.scheduledAt.toISOString(),
            scheduledAt.toISOString(),
          ],
          durationMinutes: [current.durationMinutes, durationMinutes],
          notes: [current.notes, notes],
        } as const;
        for (const [field, [before, after]] of Object.entries(changes)) {
          if (before !== after) changed[field] = { before, after };
        }
        if (Object.keys(changed).length === 0) {
          throw new ApiError(
            "VALIDATION_ERROR",
            400,
            "Nenhuma alteração foi informada.",
          );
        }
        const result = await tx.appointment.updateMany({
          where: {
            id: appointmentId,
            organizationId,
            version: body.version,
            status: { in: ACTIVE_STATUSES },
          },
          data: {
            patientId,
            professionalId,
            scheduledAt,
            durationMinutes,
            notes,
            version: { increment: 1 },
            updatedAt: now,
          },
        });
        if (result.count !== 1) {
          throw new ApiError(
            "VERSION_CONFLICT",
            409,
            "O agendamento foi atualizado em outra sessão.",
          );
        }
        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId,
            action: "APPOINTMENT_UPDATED",
            targetType: "APPOINTMENT",
            targetId: appointmentId,
            metadata: {
              changed,
              versionBefore: body.version,
              versionAfter: body.version + 1,
              updatedAt: now.toISOString(),
            },
          },
        });
        return {
          appointment: {
            id: appointmentId,
            patientId,
            professionalId,
            scheduledAt: scheduledAt.toISOString(),
            durationMinutes,
            status: current.status,
            notes,
            version: body.version + 1,
            updatedAt: now.toISOString(),
          },
        };
      });
    } catch (error) {
      if (isExclusionConflict(error)) {
        throw new ApiError(
          "SLOT_CONFLICT",
          409,
          "O horário conflita com outro agendamento do profissional.",
          { reason: "APPOINTMENT_OVERLAP" },
        );
      }
      throw error;
    }
  }

  async cancel(
    organizationId: string,
    actorUserId: string,
    appointmentId: string,
    body: CancelAppointmentBody,
  ): Promise<CancelAppointmentResponse> {
    const cancellationReason = body.cancellationReason.trim();
    if (cancellationReason.length < 10) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "A justificativa deve ter pelo menos 10 caracteres.",
        { field: "cancellationReason" },
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.appointment.findFirst({
        where: { id: appointmentId, organizationId },
        select: { id: true, status: true, version: true },
      });
      if (!current) {
        throw new ApiError("NOT_FOUND", 404, "Agendamento não encontrado.");
      }
      if (
        current.status === "CANCELLED" ||
        current.status === "COMPLETED" ||
        current.status === "NO_SHOW"
      ) {
        throw new ApiError(
          "INVALID_STATE_TRANSITION",
          409,
          "Agendamento encerrado não pode ser cancelado.",
        );
      }
      if (current.version !== body.version) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "O agendamento foi alterado. Recarregue os dados.",
        );
      }

      const cancelledAt = new Date();
      const updated = await tx.appointment.updateMany({
        where: {
          id: appointmentId,
          organizationId,
          version: body.version,
          status: { in: ACTIVE_STATUSES },
        },
        data: {
          status: "CANCELLED",
          cancellationReason,
          cancelledAt,
          cancelledById: actorUserId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "O agendamento foi alterado. Recarregue os dados.",
        );
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: "APPOINTMENT_CANCELLED",
          targetType: "APPOINTMENT",
          targetId: appointmentId,
          metadata: {
            fromStatus: current.status,
            toStatus: "CANCELLED",
            cancellationReason,
            cancelledAt: cancelledAt.toISOString(),
            version: body.version + 1,
          },
        },
      });

      return {
        status: "CANCELLED" as const,
        cancellationReason,
        cancelledAt: cancelledAt.toISOString(),
        cancelledById: actorUserId,
        version: body.version + 1,
      };
    });
  }

  async create(
    organizationId: string,
    idempotencyKey: string,
    body: CreateAppointmentBody,
  ): Promise<CreateAppointmentResponse> {
    const key = idempotencyKey.trim();
    if (!key) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Cabeçalho Idempotency-Key é obrigatório.",
        { field: "idempotencyKey" },
      );
    }

    const scheduledAt = parseUtcDateTime(body.scheduledAt);
    if (
      !Number.isInteger(body.durationMinutes) ||
      body.durationMinutes < 1 ||
      body.durationMinutes > 1440
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Duração do agendamento inválida.",
        { field: "durationMinutes" },
      );
    }

    const notes =
      body.notes !== undefined && body.notes !== null
        ? body.notes.trim() || null
        : null;
    const endsAt = new Date(
      scheduledAt.getTime() + body.durationMinutes * 60_000,
    );
    const requestHash = new Bun.CryptoHasher("sha256")
      .update(
        JSON.stringify({
          patientId: body.patientId,
          professionalId: body.professionalId,
          scheduledAt: scheduledAt.toISOString(),
          durationMinutes: body.durationMinutes,
          notes,
        }),
      )
      .digest("hex");

    const organization = await this.organization(organizationId);

    return this.withLock(`${organizationId}:idempotency:${key}`, async () => {
      const replay = await this.findReplay(organizationId, key, requestHash);
      if (replay) return responseForCreated(replay, organization.timezone);

      return this.withLock(
        `${organizationId}:professional:${body.professionalId}`,
        async () => {
          const innerReplay = await this.findReplay(
            organizationId,
            key,
            requestHash,
          );
          if (innerReplay)
            return responseForCreated(innerReplay, organization.timezone);

          try {
            return await this.prisma.$transaction(async (tx) => {
              if (
                typeof (tx as { $executeRaw?: unknown }).$executeRaw ===
                "function"
              ) {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${organizationId}), hashtext(${body.professionalId}))`;
              }

              const patient = await tx.patient.findFirst({
                where: { id: body.patientId, organizationId },
                select: { id: true },
              });
              if (!patient)
                throw new ApiError(
                  "NOT_FOUND",
                  404,
                  "Paciente não encontrado.",
                );

              const professional = await tx.membership.findFirst({
                where: {
                  organizationId,
                  userId: body.professionalId,
                  status: "ACTIVE",
                  role: { in: ["PROFESSIONAL", "ADMIN_PROFESSIONAL"] },
                },
                select: { id: true },
              });
              if (!professional)
                throw new ApiError(
                  "NOT_FOUND",
                  404,
                  "Profissional não encontrado.",
                );

              const localParts = dateParts(scheduledAt, organization.timezone);
              const localDate = `${localParts.year}-${localParts.month}-${localParts.day}`;
              const dayOfWeek =
                DAY_NAMES[parseDate(localDate).getUTCDay()] ?? "SUNDAY";
              const rules = await tx.weeklyScheduleRule.findMany({
                where: { organizationId, dayOfWeek },
                orderBy: { startTime: "asc" },
              });
              const fitsSchedule = rules.some((rule) => {
                const intervalStart = zonedDateTimeToUtc(
                  localDate,
                  rule.startTime,
                  organization.timezone,
                );
                const intervalEnd = zonedDateTimeToUtc(
                  localDate,
                  rule.endTime,
                  organization.timezone,
                );
                return (
                  scheduledAt.getTime() >= intervalStart.getTime() &&
                  endsAt.getTime() <= intervalEnd.getTime()
                );
              });
              if (!fitsSchedule) {
                throw new ApiError(
                  "SLOT_CONFLICT",
                  409,
                  "O horário selecionado está fora do expediente configurado para a clínica.",
                  {
                    reason: "OUTSIDE_WORKING_HOURS",
                    professionalId: body.professionalId,
                    requestedStartsAt: scheduledAt.toISOString(),
                    requestedEndsAt: endsAt.toISOString(),
                    dayOfWeek,
                    timeZone: organization.timezone,
                  },
                );
              }

              const exception = await tx.scheduleException.findFirst({
                where: {
                  organizationId,
                  OR: [
                    { professionalId: null },
                    { professionalId: body.professionalId },
                  ],
                  startsAt: { lt: endsAt },
                  endsAt: { gt: scheduledAt },
                },
                select: { startsAt: true, endsAt: true },
              });
              if (exception)
                throw new ApiError(
                  "SLOT_CONFLICT",
                  409,
                  "O horário selecionado conflita com uma exceção da agenda.",
                  {
                    reason: "SCHEDULE_PAUSE",
                    professionalId: body.professionalId,
                    requestedStartsAt: scheduledAt.toISOString(),
                    requestedEndsAt: endsAt.toISOString(),
                    conflictingStartsAt: exception.startsAt.toISOString(),
                    conflictingEndsAt: exception.endsAt.toISOString(),
                  },
                );
              const pauses = await tx.professionalSchedulePause.findMany({
                where: {
                  organizationId,
                  professionalId: body.professionalId,
                  startsAt: { lt: endsAt },
                  endsAt: { gt: scheduledAt },
                },
                orderBy: { startsAt: "asc" },
                select: { startsAt: true, endsAt: true },
              });
              const conflictingPause = pauses.find((pause) =>
                overlaps(scheduledAt, endsAt, pause.startsAt, pause.endsAt),
              );
              if (conflictingPause) {
                throw new ApiError(
                  "SLOT_CONFLICT",
                  409,
                  "O horário selecionado conflita com uma pausa na agenda do profissional.",
                  {
                    reason: "SCHEDULE_PAUSE",
                    professionalId: body.professionalId,
                    requestedStartsAt: scheduledAt.toISOString(),
                    requestedEndsAt: endsAt.toISOString(),
                    conflictingStartsAt:
                      conflictingPause.startsAt.toISOString(),
                    conflictingEndsAt: conflictingPause.endsAt.toISOString(),
                  },
                );
              }

              const existingAppointments = await tx.appointment.findMany({
                where: {
                  organizationId,
                  professionalId: body.professionalId,
                  status: { in: ACTIVE_STATUSES },
                  scheduledAt: {
                    gte: new Date(scheduledAt.getTime() - 86_400_000),
                    lt: endsAt,
                  },
                },
                orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
                select: {
                  id: true,
                  scheduledAt: true,
                  durationMinutes: true,
                },
              });
              const conflictingAppointment = existingAppointments.find((item) =>
                overlaps(
                  scheduledAt,
                  endsAt,
                  item.scheduledAt,
                  new Date(
                    item.scheduledAt.getTime() + item.durationMinutes * 60_000,
                  ),
                ),
              );
              if (conflictingAppointment) {
                const conflictingEnd = new Date(
                  conflictingAppointment.scheduledAt.getTime() +
                    conflictingAppointment.durationMinutes * 60_000,
                );
                throw new ApiError(
                  "SLOT_CONFLICT",
                  409,
                  "O horário selecionado conflita com outro agendamento do profissional.",
                  {
                    reason: "APPOINTMENT_OVERLAP",
                    professionalId: body.professionalId,
                    requestedStartsAt: scheduledAt.toISOString(),
                    requestedEndsAt: endsAt.toISOString(),
                    conflictingAppointmentId: conflictingAppointment.id,
                    conflictingStartsAt:
                      conflictingAppointment.scheduledAt.toISOString(),
                    conflictingEndsAt: conflictingEnd.toISOString(),
                  },
                );
              }

              const appointment = await tx.appointment.create({
                data: {
                  organizationId,
                  patientId: body.patientId,
                  professionalId: body.professionalId,
                  scheduledAt,
                  durationMinutes: body.durationMinutes,
                  status: "RESERVED",
                  notes,
                },
                select: {
                  id: true,
                  patientId: true,
                  professionalId: true,
                  scheduledAt: true,
                  durationMinutes: true,
                  status: true,
                  notes: true,
                  createdAt: true,
                  version: true,
                },
              });
              await tx.appointmentCreationRequest.create({
                data: {
                  organizationId,
                  idempotencyKey: key,
                  requestHash,
                  appointmentId: appointment.id,
                },
              });
              return responseForCreated(appointment, organization.timezone);
            });
          } catch (error) {
            if (isExclusionConflict(error)) {
              throw new ApiError(
                "SLOT_CONFLICT",
                409,
                "O horário selecionado conflita com outro agendamento do profissional.",
                {
                  reason: "APPOINTMENT_OVERLAP",
                  professionalId: body.professionalId,
                  requestedStartsAt: scheduledAt.toISOString(),
                  requestedEndsAt: endsAt.toISOString(),
                },
              );
            }
            if (!isUniqueConflict(error)) throw error;
            const concurrentReplay = await this.findReplay(
              organizationId,
              key,
              requestHash,
            );
            if (concurrentReplay)
              return responseForCreated(
                concurrentReplay,
                organization.timezone,
              );
            throw new ApiError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "A chave de idempotência está em uso.",
            );
          }
        },
      );
    });
  }

  private async findReplay(
    organizationId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CreatedAppointmentRecord | null> {
    const request = await this.prisma.appointmentCreationRequest.findUnique({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey },
      },
      select: {
        requestHash: true,
        appointment: {
          select: {
            id: true,
            patientId: true,
            professionalId: true,
            scheduledAt: true,
            durationMinutes: true,
            status: true,
            notes: true,
            createdAt: true,
            version: true,
          },
        },
      },
    });
    if (!request) return null;
    if (request.requestHash !== requestHash)
      throw new ApiError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "A chave de idempotência já foi usada com outros dados.",
      );
    return request.appointment;
  }
}
