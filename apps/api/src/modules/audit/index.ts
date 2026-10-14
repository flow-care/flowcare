import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import * as m from "./model";
import { AuditService } from "./service";

export function auditModule(deps: { prisma: PrismaClient; jwtSecret: string }) {
  const service = new AuditService(deps.prisma);

  return new Elysia({ name: "audit" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
    .get(
      "/organizations/:orgSlug/audit-logs",
      ({ organizationAccess, query }) =>
        service.listForOrganization(organizationAccess.organizationId, query),
      {
        params: m.auditOrganizationParams,
        query: m.listAuditLogsQuery,
        organizationAccess: "audit:read",
        response: { 200: m.listAuditLogsResponse },
      },
    )
    .get(
      "/organizations/:orgSlug/audit",
      ({ organizationAccess, query }) =>
        service.listForOrganization(organizationAccess.organizationId, query),
      {
        params: m.auditOrganizationParams,
        query: m.listAuditLogsQuery,
        organizationAccess: "audit:read",
        response: { 200: m.listAuditLogsResponse },
      },
    )
    .post(
      "/organizations/:orgSlug/audit-logs",
      () => service.rejectMutation(),
      {
        params: m.auditOrganizationParams,
      },
    )
    .patch(
      "/organizations/:orgSlug/audit-logs",
      () => service.rejectMutation(),
      {
        params: m.auditOrganizationParams,
      },
    )
    .put("/organizations/:orgSlug/audit-logs", () => service.rejectMutation(), {
      params: m.auditOrganizationParams,
    })
    .delete(
      "/organizations/:orgSlug/audit-logs",
      () => service.rejectMutation(),
      {
        params: m.auditOrganizationParams,
      },
    )
    .patch(
      "/organizations/:orgSlug/audit-logs/:auditId",
      () => service.rejectMutation(),
      {
        params: m.auditLogParams,
      },
    )
    .put(
      "/organizations/:orgSlug/audit-logs/:auditId",
      () => service.rejectMutation(),
      {
        params: m.auditLogParams,
      },
    )
    .delete(
      "/organizations/:orgSlug/audit-logs/:auditId",
      () => service.rejectMutation(),
      {
        params: m.auditLogParams,
      },
    )
    .post("/audit-logs", () => service.rejectMutation())
    .patch("/audit-logs/:auditId", () => service.rejectMutation(), {
      params: m.globalAuditLogParams,
    })
    .put("/audit-logs/:auditId", () => service.rejectMutation(), {
      params: m.globalAuditLogParams,
    })
    .delete("/audit-logs/:auditId", () => service.rejectMutation(), {
      params: m.globalAuditLogParams,
    });
}

export const auditPlugin = auditModule;
