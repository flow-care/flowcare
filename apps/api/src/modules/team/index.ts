import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  materializePermissions,
  PERMISSION_GROUP_META,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  type Permission,
  PRESET_PERMISSIONS,
} from "../../lib/permissions";
import { authPlugin } from "../../plugins/auth";
import {
  CUSTOM_ROLE_CAPABILITIES_CATALOG,
  organizationAccessPlugin,
} from "../../plugins/organization-access";
import * as m from "./model";
import { TeamService } from "./service";

/**
 * Catálogo das permissões para a tela de equipe: grupos, rótulos e presets.
 * Uma fonte só (o backend), para a UI não duplicar a lista.
 */
function permissionCatalog() {
  const descriptions = new Map(
    CUSTOM_ROLE_CAPABILITIES_CATALOG.map((item) => [
      item.name,
      item.description,
    ]),
  );
  return {
    groups: (
      Object.keys(PERMISSION_GROUPS) as Array<keyof typeof PERMISSION_GROUPS>
    ).map((groupId) => ({
      id: groupId,
      label: PERMISSION_GROUP_META[groupId].label,
      description: PERMISSION_GROUP_META[groupId].description,
      permissions: PERMISSION_GROUPS[groupId].map((name) => ({
        name,
        label: PERMISSION_LABELS[name as Permission] ?? name,
        description: descriptions.get(name as never) ?? "",
      })),
    })),
    presets: {
      ADMIN: materializePermissions(PRESET_PERMISSIONS.ADMIN),
      PROFESSIONAL: materializePermissions(PRESET_PERMISSIONS.PROFESSIONAL),
      RECEPTIONIST: materializePermissions(PRESET_PERMISSIONS.RECEPTIONIST),
    },
  };
}

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
    .patch(
      "/organizations/:orgSlug/members/:memberId/role",
      ({ organizationAccess, auth, params, body }) =>
        service.updateMemberRole({
          organizationId: organizationAccess.organizationId,
          actorUserId: auth!.userId,
          memberId: params.memberId,
          role: body.role,
          version: body.version,
        }),
      {
        params: m.memberRoleParams,
        body: m.updateMemberRoleBody,
        organizationAccess: "team:manage",
        response: { 200: m.updateMemberRoleResponse },
      },
    )
    .get(
      "/organizations/:orgSlug/permissions/catalog",
      () => permissionCatalog(),
      {
        params: m.teamOrgSlugParams,
        organizationAccess: "team:read",
        response: { 200: m.permissionCatalogResponse },
      },
    )
    .patch(
      "/organizations/:orgSlug/members/:memberId/permissions",
      ({ organizationAccess, auth, params, body }) =>
        service.updateMemberPermissions({
          organizationId: organizationAccess.organizationId,
          actorUserId: auth!.userId,
          memberId: params.memberId,
          body,
        }),
      {
        params: m.memberParams,
        body: m.updateMemberPermissionsBody,
        organizationAccess: "team:manage",
        response: { 200: m.updateMemberRoleResponse },
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
