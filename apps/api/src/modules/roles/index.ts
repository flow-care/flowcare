import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import * as m from "./model";
import { RolesService } from "./service";

export function rolesModule(deps: { prisma: PrismaClient; jwtSecret: string }) {
  const service = new RolesService(deps.prisma);

  return new Elysia({ name: "roles" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
    .get(
      "/organizations/:orgSlug/roles/capabilities",
      () => service.getCapabilitiesCatalog(),
      {
        params: m.rolesOrganizationParams,
        organizationAccess: "roles:read",
        response: { 200: m.listCapabilitiesResponseSchema },
      },
    )
    .get(
      "/organizations/:orgSlug/roles",
      ({ organizationAccess }) =>
        service.listRoles(organizationAccess.organizationId),
      {
        params: m.rolesOrganizationParams,
        organizationAccess: "roles:read",
        response: { 200: m.listRolesResponseSchema },
      },
    )
    .post(
      "/organizations/:orgSlug/roles",
      async ({ organizationAccess, auth, body, set }) => {
        set.status = 201;
        return service.createCustomRole(
          organizationAccess.organizationId,
          auth!.userId,
          body,
        );
      },
      {
        params: m.rolesOrganizationParams,
        body: m.createRoleBodySchema,
        organizationAccess: "team:manage",
        response: { 201: m.createRoleResponseSchema },
      },
    );
}

export * from "./model";
export { RolesService } from "./service";
