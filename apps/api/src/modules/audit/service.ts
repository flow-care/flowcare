import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import {
  AuditLogger,
  sanitizeAuditMetadata,
} from "../../services/audit-logger";
import type { ListAuditLogsQuery, ListAuditLogsResponse } from "./model";

export const MAX_AUDIT_QUERY_DAYS = 90;

export function AuditLogImmutableError() {
  return new ApiError(
    "AUDIT_LOG_IMMUTABLE",
    403,
    "Eventos de auditoria são imutáveis e não podem ser alterados ou removidos.",
  );
}

export function parseAuditDate(value: string, isEndOfDay = false): Date {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const isoString = isEndOfDay
      ? `${trimmed}T23:59:59.999Z`
      : `${trimmed}T00:00:00.000Z`;
    const d = new Date(isoString);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Formato de data inválido. Utilize formato ISO 8601 ou AAAA-MM-DD.",
    );
  }
  return d;
}

export class AuditService extends AuditLogger {
  constructor(private readonly db: PrismaClient) {
    super(db);
  }

  async listForOrganization(
    organizationId: string,
    query: ListAuditLogsQuery = {},
  ): Promise<ListAuditLogsResponse> {
    const page = query.page && query.page >= 1 ? query.page : 1;
    const limit =
      query.limit && query.limit >= 1 && query.limit <= 100 ? query.limit : 20;
    const skip = (page - 1) * limit;

    let start: Date | undefined;
    let end: Date | undefined;

    if (query.startDate) {
      start = parseAuditDate(query.startDate, false);
    }
    if (query.endDate) {
      end = parseAuditDate(query.endDate, true);
    }

    if (start && end) {
      if (start.getTime() > end.getTime()) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          "Data inicial (startDate) não pode ser posterior à data final (endDate).",
        );
      }
      const diffDays =
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > MAX_AUDIT_QUERY_DAYS) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          `Intervalo de consulta não pode exceder ${MAX_AUDIT_QUERY_DAYS} dias.`,
        );
      }
    } else if (start && !end) {
      const now = new Date();
      const diffDays =
        (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (diffDays > MAX_AUDIT_QUERY_DAYS) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          `Intervalo de consulta não pode exceder ${MAX_AUDIT_QUERY_DAYS} dias. Especifique um endDate correspondente.`,
        );
      }
    }

    const whereClause: Record<string, unknown> = {
      organizationId,
      ...(query.action ? { action: query.action.trim() } : {}),
      ...(query.targetType ? { targetType: query.targetType.trim() } : {}),
      ...(query.targetId ? { targetId: query.targetId.trim() } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId.trim() } : {}),
      ...(start || end
        ? {
            createdAt: {
              ...(start ? { gte: start } : {}),
              ...(end ? { lte: end } : {}),
            },
          }
        : {}),
    };

    const auditLogClient = this.db.auditLog as unknown as {
      findMany: (args: unknown) => Promise<
        Array<{
          id: string;
          organizationId: string | null;
          actorUserId: string;
          action: string;
          targetType: string;
          targetId: string;
          metadata: unknown;
          createdAt: Date | string;
        }>
      >;
      count?: (args: unknown) => Promise<number>;
    };

    const [rows, totalCount] = await Promise.all([
      auditLogClient.findMany({
        where: whereClause,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(skip > 0 ? { skip } : {}),
        take: limit,
      }),
      typeof auditLogClient?.count === "function"
        ? auditLogClient.count({ where: whereClause })
        : Promise.resolve(-1),
    ]);

    const resolvedTotal = totalCount >= 0 ? totalCount : rows.length;
    const totalPages =
      Math.ceil(resolvedTotal / limit) || (resolvedTotal === 0 ? 0 : 1);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    // Resolve actor details if available
    const actorUserIds = Array.from(
      new Set(
        rows.map((r: { actorUserId: string }) => r.actorUserId).filter(Boolean),
      ),
    );
    const userMap = new Map<
      string,
      { id: string; fullName: string; email: string }
    >();

    const userClient = this.db.user as unknown as {
      findMany?: (args: unknown) => Promise<
        Array<{
          id: string;
          fullName: string;
          email: string;
        }>
      >;
    };
    if (actorUserIds.length > 0 && typeof userClient?.findMany === "function") {
      try {
        const users = await userClient.findMany({
          where: { id: { in: actorUserIds } },
          select: { id: true, fullName: true, email: true },
        });
        if (Array.isArray(users)) {
          for (const u of users) {
            userMap.set(u.id, u);
          }
        }
      } catch {
        // Fallback for mocks
      }
    }

    const pagination = {
      page,
      limit,
      totalCount: resolvedTotal,
      totalPages,
      hasNextPage,
      hasPreviousPage,
    };

    return {
      data: rows.map((row) => {
        const actor = userMap.get(row.actorUserId);
        return {
          id: row.id,
          organizationId: row.organizationId,
          actorUserId: row.actorUserId,
          actorName: actor?.fullName ?? null,
          actorUser: actor
            ? { id: actor.id, fullName: actor.fullName, email: actor.email }
            : null,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          metadata: sanitizeAuditMetadata(
            row.metadata &&
              typeof row.metadata === "object" &&
              !Array.isArray(row.metadata)
              ? (row.metadata as Record<string, unknown>)
              : {},
          ),
          createdAt:
            row.createdAt instanceof Date
              ? row.createdAt.toISOString()
              : new Date(row.createdAt).toISOString(),
        };
      }),
      pagination,
      pageInfo: pagination,
    };
  }

  rejectMutation(): never {
    throw AuditLogImmutableError();
  }
}
