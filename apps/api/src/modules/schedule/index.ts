import { Elysia, status } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import * as m from "./model";
import { ScheduleService } from "./service";

export function scheduleModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
}) {
  const service = new ScheduleService(deps.prisma);
  return new Elysia({ name: "schedule" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
    .group("/organizations/:orgSlug/settings", (group) =>
      group
        .get(
          "/schedule-rules",
          ({ organizationAccess }) =>
            service.weekly(organizationAccess.organizationId),
          {
            params: m.params,
            organizationAccess: "settings:read",
            response: { 200: m.weeklyResponse },
          },
        )
        .put(
          "/schedule-rules",
          ({ auth, organizationAccess, body }) =>
            service.replaceWeekly(
              organizationAccess.organizationId,
              auth.userId,
              body,
            ),
          {
            params: m.params,
            body: m.weeklyBody,
            organizationAccess: "settings:write",
            response: { 200: m.weeklyResponse },
          },
        )
        .get(
          "/schedule-exceptions",
          ({ organizationAccess }) =>
            service.exceptions(organizationAccess.organizationId),
          {
            params: m.params,
            organizationAccess: "settings:read",
            response: { 200: m.exceptionsResponse },
          },
        )
        .post(
          "/schedule-exceptions",
          async ({ auth, organizationAccess, body }) =>
            status(
              201,
              await service.addException(
                organizationAccess.organizationId,
                auth.userId,
                body,
              ),
            ),
          {
            params: m.params,
            body: m.exceptionBody,
            organizationAccess: "settings:write",
            response: { 201: m.exceptionResponse },
          },
        )
        .delete(
          "/schedule-exceptions/:exceptionId",
          ({ auth, organizationAccess, params }) =>
            service.deleteException(
              organizationAccess.organizationId,
              auth.userId,
              params.exceptionId,
            ),
          {
            params: m.exceptionParams,
            organizationAccess: "settings:write",
            response: { 200: m.deleteResponse },
          },
        ),
    );
}
