import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { CLINICAL_ROLES } from "../../lib/roles";
import { recordAuditEvent } from "../../services/audit-logger";
import type { ExceptionBody, WeeklyBody } from "./model";

function validTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new ApiError("VALIDATION_ERROR", 400, "Fuso horário inválido.");
  }
}
function minute(value: string) {
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
function validateRules(rules: WeeklyBody["rules"]) {
  const byDay = new Map<string, { start: number; end: number }[]>();
  for (const rule of rules) {
    const start = minute(rule.startTime),
      end = minute(rule.endTime);
    if (start >= end || rule.slotDurationMinutes > end - start) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Intervalo ou duração inválidos.",
      );
    }
    const previous = byDay.get(rule.dayOfWeek) ?? [];
    if (previous.some((item) => start < item.end && item.start < end)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Há horários sobrepostos no mesmo dia.",
      );
    }
    previous.push({ start, end });
    byDay.set(rule.dayOfWeek, previous);
  }
}
function formatException(item: {
  id: string;
  professionalId: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  reason: string | null;
}) {
  return {
    id: item.id,
    professionalId: item.professionalId,
    startsAt: item.startsAt.toISOString(),
    endsAt: item.endsAt.toISOString(),
    timezone: item.timezone,
    reason: item.reason,
  };
}
export class ScheduleService {
  constructor(private readonly prisma: PrismaClient) {}

  async weekly(organizationId: string) {
    const [organization, rules] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { timezone: true },
      }),
      this.prisma.weeklyScheduleRule.findMany({
        where: { organizationId },
        orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
      }),
    ]);
    return {
      timezone: organization.timezone,
      rules: rules.map((rule) => ({
        dayOfWeek: rule.dayOfWeek as WeeklyBody["rules"][number]["dayOfWeek"],
        startTime: rule.startTime,
        endTime: rule.endTime,
        slotDurationMinutes: rule.slotDurationMinutes,
      })),
    };
  }

  async replaceWeekly(
    organizationId: string,
    actorUserId: string,
    body: WeeklyBody,
  ) {
    validTimezone(body.timezone);
    validateRules(body.rules);
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: organizationId },
        data: { timezone: body.timezone },
      });
      await tx.weeklyScheduleRule.deleteMany({ where: { organizationId } });
      if (body.rules.length)
        await tx.weeklyScheduleRule.createMany({
          data: body.rules.map((rule) => ({ organizationId, ...rule })),
        });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "WEEKLY_SCHEDULE_UPDATED",
        targetType: "ORGANIZATION",
        targetId: organizationId,
        metadata: { timezone: body.timezone, ruleCount: body.rules.length },
      });
    });
    return { timezone: body.timezone, rules: body.rules };
  }

  async exceptions(organizationId: string) {
    const [organization, items] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { timezone: true },
      }),
      this.prisma.scheduleException.findMany({
        where: { organizationId },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      }),
    ]);
    return {
      timezone: organization.timezone,
      exceptions: items.map(formatException),
    };
  }

  async addException(
    organizationId: string,
    actorUserId: string,
    body: ExceptionBody,
  ) {
    const startsAt = new Date(body.startsAt),
      endsAt = new Date(body.endsAt);
    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      startsAt >= endsAt
    ) {
      throw new ApiError("VALIDATION_ERROR", 400, "Intervalo inválido.");
    }
    if (body.professionalId) {
      const professional = await this.prisma.membership.findFirst({
        where: {
          organizationId,
          userId: body.professionalId,
          status: "ACTIVE",
          role: { in: CLINICAL_ROLES },
        },
        select: { id: true },
      });
      if (!professional)
        throw new ApiError("NOT_FOUND", 404, "Profissional não encontrado.");
    }
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { timezone: true },
    });
    const overlap = await this.prisma.scheduleException.findFirst({
      where: {
        organizationId,
        professionalId: body.professionalId ?? null,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
      select: { id: true },
    });
    if (overlap)
      throw new ApiError("SCHEDULE_CONFLICT", 409, "Exceções sobrepostas.");
    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const created = await tx.scheduleException.create({
          data: {
            organizationId,
            professionalId: body.professionalId ?? null,
            startsAt,
            endsAt,
            timezone: organization.timezone,
            reason: body.reason ?? null,
          },
        });
        await recordAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: "SCHEDULE_EXCEPTION_CREATED",
          targetType: "SCHEDULE_EXCEPTION",
          targetId: created.id,
          metadata: {
            professionalId: created.professionalId,
            startsAt: created.startsAt.toISOString(),
            endsAt: created.endsAt.toISOString(),
          },
        });
        return created;
      });
      return { exception: formatException(item) };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "P2004" || error.code === "P2010")
      )
        throw new ApiError("SCHEDULE_CONFLICT", 409, "Exceções sobrepostas.");
      throw error;
    }
  }

  async deleteException(
    organizationId: string,
    actorUserId: string,
    exceptionId: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const deleted = await tx.scheduleException.deleteMany({
        where: { id: exceptionId, organizationId },
      });
      if (deleted.count)
        await recordAuditEvent(tx, {
          organizationId,
          actorUserId,
          action: "SCHEDULE_EXCEPTION_DELETED",
          targetType: "SCHEDULE_EXCEPTION",
          targetId: exceptionId,
          metadata: {},
        });
      return deleted;
    });
    if (!result.count)
      throw new ApiError("NOT_FOUND", 404, "Exceção não encontrada.");
    return { deleted: true };
  }
}
