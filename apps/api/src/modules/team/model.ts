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
  status: t.UnionEnum(["ACTIVE", "SUSPENDED", "INVITED"]),
});

export const listMembersResponse = t.Object({
  data: t.Array(memberItem),
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
