import { t } from "elysia";

export const rolesOrganizationParams = t.Object({
  orgSlug: t.String(),
});

export const capabilityItemSchema = t.Object({
  name: t.String(),
  group: t.String(),
  description: t.String(),
});

export const listCapabilitiesResponseSchema = t.Object({
  capabilities: t.Array(capabilityItemSchema),
  data: t.Array(capabilityItemSchema),
});

export const systemRoleSchema = t.Object({
  role: t.String(),
  name: t.String(),
  description: t.String(),
  capabilities: t.Array(t.String()),
  memberCount: t.Number(),
  isSystem: t.Literal(true),
});

export const customRoleSchema = t.Object({
  id: t.String(),
  organizationId: t.String(),
  name: t.String(),
  description: t.Nullable(t.String()),
  capabilities: t.Array(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  isSystem: t.Literal(false),
});

export const listRolesResponseSchema = t.Object({
  systemRoles: t.Array(systemRoleSchema),
  customRoles: t.Array(customRoleSchema),
  roles: t.Array(
    t.Union([
      t.Object({
        role: t.String(),
        name: t.String(),
        description: t.String(),
        capabilities: t.Array(t.String()),
        memberCount: t.Number(),
        isSystem: t.Literal(true),
      }),
      t.Object({
        id: t.String(),
        organizationId: t.String(),
        name: t.String(),
        description: t.Nullable(t.String()),
        capabilities: t.Array(t.String()),
        createdAt: t.String(),
        updatedAt: t.String(),
        isSystem: t.Literal(false),
      }),
    ]),
  ),
  data: t.Array(
    t.Union([
      t.Object({
        role: t.String(),
        name: t.String(),
        description: t.String(),
        capabilities: t.Array(t.String()),
        memberCount: t.Number(),
        isSystem: t.Literal(true),
      }),
      t.Object({
        id: t.String(),
        organizationId: t.String(),
        name: t.String(),
        description: t.Nullable(t.String()),
        capabilities: t.Array(t.String()),
        createdAt: t.String(),
        updatedAt: t.String(),
        isSystem: t.Literal(false),
      }),
    ]),
  ),
});

export const createRoleBodySchema = t.Object({
  name: t.String({ minLength: 2, maxLength: 50 }),
  description: t.Optional(t.Nullable(t.String())),
  capabilities: t.Array(t.String(), { minItems: 1 }),
});

export const createRoleResponseSchema = t.Object({
  id: t.String(),
  organizationId: t.String(),
  name: t.String(),
  description: t.Nullable(t.String()),
  capabilities: t.Array(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  isSystem: t.Literal(false),
  role: customRoleSchema,
});

export type RolesOrganizationParams = typeof rolesOrganizationParams.static;
export type CapabilityItem = typeof capabilityItemSchema.static;
export type ListCapabilitiesResponse =
  typeof listCapabilitiesResponseSchema.static;
export type SystemRoleItem = typeof systemRoleSchema.static;
export type CustomRoleItem = typeof customRoleSchema.static;
export type ListRolesResponse = typeof listRolesResponseSchema.static;
export type CreateRoleInput = typeof createRoleBodySchema.static;
export type CreateRoleResponse = typeof createRoleResponseSchema.static;
