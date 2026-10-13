import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import { Unauthenticated } from "../auth/errors";
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
        if (!auth) throw Unauthenticated();
        set.status = 201;
        return service.createCustomRole(
          organizationAccess.organizationId,
          auth.userId,
          body,
        );
      },
      {
        params: m.rolesOrganizationParams,
        body: m.createRoleBodySchema,
        organizationAccess: "team:manage",
        response: { 201: m.createRoleResponseSchema },
      },
    )
    .patch(
      "/organizations/:orgSlug/roles/:roleId",
      async ({ organizationAccess, auth, params, body }) => {
        if (!auth) throw Unauthenticated();
        return service.updateCustomRole(
          organizationAccess.organizationId,
          auth.userId,
          params.roleId,
          body,
        );
      },
      {
        params: m.roleParams,
        body: m.updateRoleBodySchema,
        organizationAccess: "team:manage",
        response: { 200: m.updateRoleResponseSchema },
      },
    )
    .put(
      "/organizations/:orgSlug/roles/:roleId",
      async ({ organizationAccess, auth, params, body }) => {
        if (!auth) throw Unauthenticated();
        return service.updateCustomRole(
          organizationAccess.organizationId,
          auth.userId,
          params.roleId,
          body,
        );
      },
      {
        params: m.roleParams,
        body: m.updateRoleBodySchema,
        organizationAccess: "team:manage",
        response: { 200: m.updateRoleResponseSchema },
      },
    )
    .patch(
      "/organizations/:orgSlug/settings/roles/:id",
      async ({ organizationAccess, auth, params, body }) => {
        if (!auth) throw Unauthenticated();
        return service.updateCustomRole(
          organizationAccess.organizationId,
          auth.userId,
          params.id,
          body,
        );
      },
      {
        params: m.roleIdAliasParams,
        body: m.updateRoleBodySchema,
        organizationAccess: "team:manage",
        response: { 200: m.updateRoleResponseSchema },
      },
    )
    .put(
      "/organizations/:orgSlug/settings/roles/:id",
      async ({ organizationAccess, auth, params, body }) => {
        if (!auth) throw Unauthenticated();
        return service.updateCustomRole(
          organizationAccess.organizationId,
          auth.userId,
          params.id,
          body,
        );
      },
      {
        params: m.roleIdAliasParams,
        body: m.updateRoleBodySchema,
        organizationAccess: "team:manage",
        response: { 200: m.updateRoleResponseSchema },
      },
    )
    .patch(
      "/settings/roles/:id",
      async ({ auth, params, body }) => {
        if (!auth) throw Unauthenticated();
        return service.updateCustomRoleByGlobalId(auth.userId, params.id, body);
      },
      {
        params: m.settingsRoleParams,
        body: m.updateRoleBodySchema,
        response: { 200: m.updateRoleResponseSchema },
      },
    )
    .put(
      "/settings/roles/:id",
      async ({ auth, params, body }) => {
        if (!auth) throw Unauthenticated();
        return service.updateCustomRoleByGlobalId(auth.userId, params.id, body);
      },
      {
        params: m.settingsRoleParams,
        body: m.updateRoleBodySchema,
        response: { 200: m.updateRoleResponseSchema },
      },
    );
}

export * from "./model";
export { RolesService } from "./service";
