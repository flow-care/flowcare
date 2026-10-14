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
  startDate: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
  endDate: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
  page: t.Optional(t.Integer({ minimum: 1, default: 1 })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
});

export const auditLogActorUser = t.Object({
  id: t.String(),
  fullName: t.String(),
  email: t.String(),
});

export const auditLogItem = t.Object({
  id: t.String(),
  organizationId: t.Nullable(t.String()),
  actorUserId: t.String(),
  actorName: t.Optional(t.Nullable(t.String())),
  actorUser: t.Optional(t.Nullable(auditLogActorUser)),
  action: t.String(),
  targetType: t.String(),
  targetId: t.String(),
  metadata: t.Record(t.String(), t.Unknown()),
  createdAt: t.String(),
});

export const auditPageInfo = t.Object({
  page: t.Integer({ minimum: 1 }),
  limit: t.Integer({ minimum: 1, maximum: 100 }),
  totalCount: t.Integer({ minimum: 0 }),
  totalPages: t.Integer({ minimum: 0 }),
  hasNextPage: t.Boolean(),
  hasPreviousPage: t.Boolean(),
});

export const listAuditLogsResponse = t.Object({
  data: t.Array(auditLogItem),
  pagination: t.Optional(auditPageInfo),
  pageInfo: t.Optional(auditPageInfo),
});

export type AuditOrganizationParams = typeof auditOrganizationParams.static;
export type AuditLogParams = typeof auditLogParams.static;
export type GlobalAuditLogParams = typeof globalAuditLogParams.static;
export type ListAuditLogsQuery = typeof listAuditLogsQuery.static;
export type AuditLogActorUser = typeof auditLogActorUser.static;
export type AuditLogItem = typeof auditLogItem.static;
export type AuditPageInfo = typeof auditPageInfo.static;
export type ListAuditLogsResponse = typeof listAuditLogsResponse.static;
