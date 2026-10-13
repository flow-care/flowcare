import { t } from "elysia";

export const teamOrgSlugParams = t.Object({
  orgSlug: t.String(),
});

export const memberParams = t.Object({
  orgSlug: t.String(),
  memberId: t.String(),
});

export const standaloneMemberParams = t.Object({
  memberId: t.String(),
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
  role: t.UnionEnum([
    "ADMIN",
    "ADMIN_PROFESSIONAL",
    "PROFESSIONAL",
    "RECEPTIONIST",
  ]),
  status: t.UnionEnum(["ACTIVE", "SUSPENDED", "INVITED"]),
});

export const listMembersResponse = t.Object({
  data: t.Array(memberItem),
});

export type TeamOrgSlugParams = typeof teamOrgSlugParams.static;
export type MemberParams = typeof memberParams.static;
export type StandaloneMemberParams = typeof standaloneMemberParams.static;
export type RemoveMemberResponse = typeof removeMemberResponse.static;
export type MemberItem = typeof memberItem.static;
export type ListMembersResponse = typeof listMembersResponse.static;
