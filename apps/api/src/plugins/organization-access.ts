import { Elysia } from "elysia";
import type { MembershipRole, PrismaClient } from "../generated/prisma/client";
import { ApiError } from "../lib/api-error";
import { Unauthenticated } from "../modules/auth/errors";
import { authPlugin } from "./auth";

const capacityGroups = {
  common: [
    "organizations:read",
    "patients:read",
    "patients:write",
    "appointments:read",
    "appointments:write",
    "reception:read",
    "dashboard:read",
  ],
  administration: [
    "team:read",
    "team:invite",
    "team:manage",
    "roles:read",
    "usage:read",
    "settings:read",
    "settings:write",
    "audit:read",
  ],
  clinical: [
    "patients:read_history",
    "patients:attachments:read",
    "patients:attachments:write",
    "consultations:read",
    "consultations:write",
    "consultations:approve",
    "documents:read",
    "documents:write",
    "documents:issue",
    "documents:void",
    "templates:read",
    "templates:write",
  ],
  logistics: ["reception:write", "communications:read", "communications:write"],
} as const;

export type OrganizationCapability =
  (typeof capacityGroups)[keyof typeof capacityGroups][number];
type Role = MembershipRole;

const capabilities: Record<Role, ReadonlySet<OrganizationCapability>> = {
  ADMIN: new Set([
    ...capacityGroups.common,
    ...capacityGroups.administration,
    ...capacityGroups.logistics,
  ]),
  ADMIN_PROFESSIONAL: new Set(Object.values(capacityGroups).flat()),
  PROFESSIONAL: new Set([...capacityGroups.common, ...capacityGroups.clinical]),
  RECEPTIONIST: new Set([
    ...capacityGroups.common,
    ...capacityGroups.logistics,
  ]),
};

// Only these actions require a separate clinical qualification decision. The
// route implementing a clinical resource must supply its own resource-specific
// check; without one, clinical actions fail closed.
const qualifiedClinicalActions = new Set<OrganizationCapability>([
  "consultations:read",
  "consultations:write",
  "consultations:approve",
  "documents:read",
  "documents:write",
  "documents:issue",
  "documents:void",
  "templates:read",
  "templates:write",
]);

export function hasOrganizationCapability(
  role: Role,
  capability: OrganizationCapability,
) {
  return capabilities[role].has(capability);
}

export type OrganizationAccess = {
  organizationId: string;
  membershipId: string;
  role: Role;
  capabilities: ReadonlySet<OrganizationCapability>;
};

export async function resolveOrganizationAccess(
  prisma: PrismaClient,
  userId: string,
  slug: string,
  capability: OrganizationCapability,
  clinicalEligibility?: (
    context: OrganizationAccess,
    capability: OrganizationCapability,
  ) => Promise<boolean>,
): Promise<OrganizationAccess> {
  const membership = await prisma.membership.findFirst({
    where: { userId, organization: { slug } },
    select: { id: true, organizationId: true, role: true, status: true },
  });
  if (!membership)
    throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
  if (membership.status !== "ACTIVE")
    throw new ApiError("MEMBERSHIP_INACTIVE", 403, "Vínculo inativo.");
  if (!hasOrganizationCapability(membership.role, capability))
    throw new ApiError(
      "PERMISSION_DENIED",
      403,
      "Você não possui permissão para realizar esta ação.",
      { requiredPermission: capability },
    );

  const context: OrganizationAccess = {
    organizationId: membership.organizationId,
    membershipId: membership.id,
    role: membership.role,
    capabilities: capabilities[membership.role],
  };
  if (
    qualifiedClinicalActions.has(capability) &&
    !(await clinicalEligibility?.(context, capability))
  )
    throw new ApiError(
      "PERMISSION_DENIED",
      403,
      "Habilitação profissional necessária.",
      { requiredPermission: capability },
    );
  return context;
}

/** Install after authPlugin; each route opts into the capability it needs. */
export function organizationAccessPlugin(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  clinicalEligibility?: (
    context: OrganizationAccess,
    capability: OrganizationCapability,
  ) => Promise<boolean>;
}) {
  return new Elysia({ name: "organization-access" })
    .use(authPlugin(deps))
    .macro({
      organizationAccess: (capability: OrganizationCapability) => ({
        resolve: async ({ auth, params }) => {
          if (!auth) throw Unauthenticated();
          return {
            organizationAccess: await resolveOrganizationAccess(
              deps.prisma,
              auth.userId,
              (params as { orgSlug: string }).orgSlug,
              capability,
              deps.clinicalEligibility,
            ),
          };
        },
      }),
    });
}
