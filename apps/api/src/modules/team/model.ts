import { t } from "elysia";

export const membershipRoles = [
  "ADMIN",
  "ADMIN_PROFESSIONAL",
  "PROFESSIONAL",
  "RECEPTIONIST",
] as const;

export const membershipRoleSchema = t.Union([
  t.Literal("ADMIN"),
  t.Literal("ADMIN_PROFESSIONAL"),
  t.Literal("PROFESSIONAL"),
  t.Literal("RECEPTIONIST"),
]);

export const teamOrgSlugParams = t.Object({
  orgSlug: t.String({ minLength: 1, maxLength: 120 }),
});

export const memberParams = t.Object({
  orgSlug: t.String({ minLength: 1, maxLength: 120 }),
  memberId: t.String({ minLength: 1, maxLength: 128 }),
});

export const memberRoleParams = memberParams;

export const standaloneMemberParams = t.Object({
  memberId: t.String({ minLength: 1, maxLength: 128 }),
});

export const updateMemberRoleBody = t.Object({
  role: membershipRoleSchema,
  version: t.Integer({ minimum: 1 }),
});

export const removeMemberResponse = t.Object({
  success: t.Boolean(),
  message: t.String(),
  memberId: t.String(),
});

export const memberItem = t.Object({
  id: t.String(),
  userId: t.String(),
  userName: t.String(),
  email: t.String(),
  role: membershipRoleSchema,
  /** Preset normalizado: ADMIN, PROFESSIONAL ou RECEPTIONIST. */
  preset: t.UnionEnum(["ADMIN", "PROFESSIONAL", "RECEPTIONIST"]),
  /** Permissões efetivas (preset, lista personalizada ou clínica solo). */
  permissions: t.Array(t.String()),
  /** `true` quando a lista foi personalizada e difere do preset. */
  isCustomized: t.Boolean(),
  status: t.UnionEnum(["ACTIVE", "SUSPENDED", "INVITED"]),
  version: t.Integer(),
  createdAt: t.String(),
});

export const listMembersResponse = t.Object({
  data: t.Array(memberItem),
  /** Clínica solo: o único membro ativo tem todas as permissões. */
  isSoloClinic: t.Boolean(),
  presetPermissions: t.Object({
    ADMIN: t.Array(t.String()),
    PROFESSIONAL: t.Array(t.String()),
    RECEPTIONIST: t.Array(t.String()),
  }),
});

export const permissionCatalogResponse = t.Object({
  groups: t.Array(
    t.Object({
      id: t.String(),
      label: t.String(),
      description: t.String(),
      permissions: t.Array(
        t.Object({
          name: t.String(),
          label: t.String(),
          description: t.String(),
        }),
      ),
    }),
  ),
  presets: t.Object({
    ADMIN: t.Array(t.String()),
    PROFESSIONAL: t.Array(t.String()),
    RECEPTIONIST: t.Array(t.String()),
  }),
});

export const updateMemberPermissionsBody = t.Object({
  /** Lista completa de permissões. Vazia restaura o preset do papel. */
  permissions: t.Optional(t.Array(t.String())),
  /** Troca o preset e limpa a personalização. */
  preset: t.Optional(t.UnionEnum(["ADMIN", "PROFESSIONAL", "RECEPTIONIST"])),
  version: t.Integer({ minimum: 1 }),
});

export const memberUserSummarySchema = t.Object({
  id: t.String(),
  fullName: t.String(),
  email: t.String(),
  professionalRole: t.Nullable(t.String()),
  professionalTitle: t.Nullable(t.String()),
  registrationNumber: t.Nullable(t.String()),
});

export const memberSummarySchema = t.Object({
  id: t.String(),
  userId: t.String(),
  organizationId: t.String(),
  role: membershipRoleSchema,
  status: t.String(),
  version: t.Integer(),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const updateMemberRoleResponse = t.Object({
  id: t.String(),
  userId: t.String(),
  organizationId: t.String(),
  role: membershipRoleSchema,
  status: t.String(),
  version: t.Integer(),
  createdAt: t.String(),
  updatedAt: t.String(),
  user: t.Optional(memberUserSummarySchema),
  member: t.Optional(memberSummarySchema),
});

export type TeamOrgSlugParams = typeof teamOrgSlugParams.static;
export type MemberParams = typeof memberParams.static;
export type MemberRoleParams = typeof memberRoleParams.static;
export type StandaloneMemberParams = typeof standaloneMemberParams.static;
export type MembershipRoleValue = typeof membershipRoleSchema.static;
export type UpdateMemberRoleBody = typeof updateMemberRoleBody.static;
export type RemoveMemberResponse = typeof removeMemberResponse.static;
export type MemberItem = typeof memberItem.static;
export type ListMembersResponse = typeof listMembersResponse.static;
export type MemberUserSummary = typeof memberUserSummarySchema.static;
export type MemberSummary = typeof memberSummarySchema.static;
export type UpdateMemberRoleResponse = typeof updateMemberRoleResponse.static;
export type UpdateMemberPermissionsBody =
  typeof updateMemberPermissionsBody.static;
export type PermissionCatalogResponse = typeof permissionCatalogResponse.static;
