import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import {
  type OrganizationAccess,
  type OrganizationCapability,
  organizationAccessPlugin,
} from "../../plugins/organization-access";
import * as m from "./model";
import { ConsultationsService } from "./service";

async function defaultClinicalEligibility(
  context: OrganizationAccess,
  capability: OrganizationCapability,
): Promise<boolean> {
  return (
    capability === "consultations:read" &&
    (context.role === "ADMIN_PROFESSIONAL" || context.role === "PROFESSIONAL")
  );
}

export function consultationsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  clinicalEligibility?: (
    context: OrganizationAccess,
    capability: OrganizationCapability,
  ) => Promise<boolean>;
}) {
  const service = new ConsultationsService(deps.prisma);
  const clinicalEligibility =
    deps.clinicalEligibility ?? defaultClinicalEligibility;

  return new Elysia({ name: "consultations" })
    .use(authPlugin(deps))
    .use(
      organizationAccessPlugin({
        prisma: deps.prisma,
        jwtSecret: deps.jwtSecret,
        clinicalEligibility,
      }),
    )
    .get(
      "/organizations/:orgSlug/consultations",
      ({ organizationAccess, query }) =>
        service.list(organizationAccess.organizationId, query),
      {
        params: m.orgSlugParams,
        query: m.listConsultationsQuery,
        organizationAccess: "consultations:read",
        response: { 200: m.listConsultationsResponse },
      },
    );
}
