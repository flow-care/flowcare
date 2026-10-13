import { t } from "elysia";

export const memberRoleParams = t.Object({
  orgSlug: t.String({ minLength: 1, maxLength: 120 }),
  memberId: t.String({ minLength: 1, maxLength: 128 }),
});

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

export const updateMemberRoleBody = t.Object({
  role: membershipRoleSchema,
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

export type MemberRoleParams = typeof memberRoleParams.static;
export type MembershipRoleValue = typeof membershipRoleSchema.static;
export type UpdateMemberRoleBody = typeof updateMemberRoleBody.static;
export type MemberUserSummary = typeof memberUserSummarySchema.static;
export type MemberSummary = typeof memberSummarySchema.static;
export type UpdateMemberRoleResponse = typeof updateMemberRoleResponse.static;
