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
    .get(
      "/organizations/:orgSlug/members",
      ({ organizationAccess }) =>
        service.listMembers(organizationAccess.organizationId),
      {
        params: m.teamOrgSlugParams,
        organizationAccess: "team:read",
        response: { 200: m.listMembersResponse },
      },
    )
    .delete(
      "/organizations/:orgSlug/members/:memberId",
      ({ organizationAccess, auth, params }) =>
        service.removeMember({
          organizationId: organizationAccess.organizationId,
          actorUserId: auth!.userId,
          memberId: params.memberId,
        }),
      {
        params: m.memberParams,
        organizationAccess: "team:manage",
        response: { 200: m.removeMemberResponse },
      },
    )
    .delete(
      "/organizations/:orgSlug/settings/team/:memberId",
      ({ organizationAccess, auth, params }) =>
        service.removeMember({
          organizationId: organizationAccess.organizationId,
          actorUserId: auth!.userId,
          memberId: params.memberId,
        }),
      {
        params: m.memberParams,
        organizationAccess: "team:manage",
        response: { 200: m.removeMemberResponse },
      },
    )
    .delete(
      "/settings/team/:memberId",
      ({ auth, params }) =>
        service.removeMember({
          actorUserId: auth!.userId,
          memberId: params.memberId,
        }),
      {
        params: m.standaloneMemberParams,
        response: { 200: m.removeMemberResponse },
      },
    );
}

export * from "./model";
export { TeamService } from "./service";
