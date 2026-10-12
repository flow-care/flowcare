import { Elysia, t } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import * as m from "./model";
import { AppointmentsService } from "./service";

export function appointmentsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
}) {
  const service = new AppointmentsService(deps.prisma);
  return new Elysia({ name: "appointments" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
    .group("/organizations/:orgSlug/appointments", (group) =>
      group
        .get(
          "/availability",
          ({ organizationAccess, query }) =>
            service.availability(organizationAccess.organizationId, query),
          {
            params: t.Object({ orgSlug: t.String() }),
            query: m.availabilityQuery,
            organizationAccess: "appointments:read",
            response: { 200: m.availabilityResponse },
          },
        )
        .get(
          "",
          ({ organizationAccess, query }) =>
            service.list(organizationAccess.organizationId, query),
          {
            params: t.Object({ orgSlug: t.String() }),
            query: m.listQuery,
            organizationAccess: "appointments:read",
            response: { 200: m.listResponse },
          },
        ),
    );
}
