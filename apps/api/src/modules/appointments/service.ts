import type {
  AppointmentStatus,
  ConfirmationDecisionOrigin,
  ConfirmationDecisionStatus,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type {
  AvailabilityQuery,
  ConfirmationDecisionBody,
  ConfirmationDecisionResponse,
  ConfirmationItem,
  ListQuery,
  PendingConfirmationsQuery,
  PendingConfirmationsResponse,
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
          },
        });
        if (!appointment) {
          throw new ApiError("NOT_FOUND", 404, "Agendamento não encontrado.");
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
                where: { id: appointment.id },
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
}
