import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import * as m from "./model";
import { TeamService } from "./service";

export function teamModule(deps: { prisma: PrismaClient; jwtSecret: string }) {
  const service = new TeamService(deps.prisma);

  return new Elysia({ name: "team" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
    .patch(
      "/organizations/:orgSlug/members/:memberId/role",
      async ({ organizationAccess, auth, params, body }) => {
        return service.updateMemberRole({
          organizationId: organizationAccess.organizationId,
          actorUserId: auth!.userId,
          memberId: params.memberId,
          role: body.role,
          version: body.version,
        });
      },
      {
        params: m.memberRoleParams,
        body: m.updateMemberRoleBody,
        organizationAccess: "team:manage",
        response: { 200: m.updateMemberRoleResponse },
      },
    );
}

export * from "./model";
export { TeamService } from "./service";
