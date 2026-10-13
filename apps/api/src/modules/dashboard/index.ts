import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import * as m from "./model";
import { DashboardService } from "./service";

export function dashboardModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
}) {
  const service = new DashboardService(deps.prisma);
  return new Elysia({ name: "dashboard" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
    .get(
      "/organizations/:orgSlug/dashboard/metrics",
      ({ organizationAccess, query }) =>
        service.metrics(organizationAccess.organizationId, query),
      {
        params: m.dashboardParams,
        query: m.dashboardQuery,
        organizationAccess: "dashboard:read",
        response: { 200: m.dashboardMetricsResponse },
      },
    );
}
