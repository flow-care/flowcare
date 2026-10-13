import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import {
  AuditLogger,
  sanitizeAuditMetadata,
} from "../../services/audit-logger";
import type { ListAuditLogsQuery, ListAuditLogsResponse } from "./model";

export function AuditLogImmutableError() {
  return new ApiError(
    "AUDIT_LOG_IMMUTABLE",
    403,
    "Eventos de auditoria são imutáveis e não podem ser alterados ou removidos.",
  );
}

export class AuditService extends AuditLogger {
  constructor(private readonly db: PrismaClient) {
    super(db);
  }

  async listForOrganization(
    organizationId: string,
    query: ListAuditLogsQuery = {},
  ): Promise<ListAuditLogsResponse> {
    const limit = query.limit ?? 50;
    const rows = await this.db.auditLog.findMany({
      where: {
        organizationId,
        ...(query.action ? { action: query.action.trim() } : {}),
        ...(query.targetType ? { targetType: query.targetType.trim() } : {}),
        ...(query.targetId ? { targetId: query.targetId.trim() } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId.trim() } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });

    return {
      data: rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        actorUserId: row.actorUserId,
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
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  rejectMutation(): never {
    throw AuditLogImmutableError();
  }
}
