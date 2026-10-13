import { t } from "elysia";

export const auditOrganizationParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});

export const auditLogParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  auditId: t.String({ minLength: 1 }),
});

export const globalAuditLogParams = t.Object({
  auditId: t.String({ minLength: 1 }),
});

export const listAuditLogsQuery = t.Object({
  action: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  targetType: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  targetId: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  actorUserId: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 50 })),
});

export const auditLogItem = t.Object({
  id: t.String(),
  organizationId: t.Nullable(t.String()),
  actorUserId: t.String(),
  action: t.String(),
  targetType: t.String(),
  targetId: t.String(),
  metadata: t.Record(t.String(), t.Unknown()),
  createdAt: t.String(),
});

export const listAuditLogsResponse = t.Object({
  data: t.Array(auditLogItem),
});

export type AuditOrganizationParams = typeof auditOrganizationParams.static;
export type AuditLogParams = typeof auditLogParams.static;
export type GlobalAuditLogParams = typeof globalAuditLogParams.static;
export type ListAuditLogsQuery = typeof listAuditLogsQuery.static;
export type AuditLogItem = typeof auditLogItem.static;
export type ListAuditLogsResponse = typeof listAuditLogsResponse.static;
