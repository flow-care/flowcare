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
    (capability === "consultations:read" ||
      capability === "consultations:write" ||
      capability === "consultations:approve") &&
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
    .group("/organizations/:orgSlug", (group) =>
      group
        .get(
          "/consultations",
          ({ organizationAccess, query }) =>
            service.list(organizationAccess.organizationId, query),
          {
            params: m.orgSlugParams,
            query: m.listConsultationsQuery,
            organizationAccess: "consultations:read",
            response: { 200: m.listConsultationsResponse },
          },
        )
        .post(
          "/consultations",
          async ({ auth, organizationAccess, body, set }) => {
            const result = await service.start(
              organizationAccess.organizationId,
              auth.userId,
              body,
            );
            set.status = result.created ? 201 : 200;
            return result.consultation;
          },
          {
            params: m.orgSlugParams,
            body: m.startConsultationBody,
            organizationAccess: "consultations:write",
            response: {
              200: m.consultationDetailResponse,
              201: m.consultationDetailResponse,
            },
          },
        )
        .post(
          "/consultations/start",
          async ({ auth, organizationAccess, body, set }) => {
            const result = await service.start(
              organizationAccess.organizationId,
              auth.userId,
              body,
            );
            set.status = result.created ? 201 : 200;
            return result.consultation;
          },
          {
            params: m.orgSlugParams,
            body: m.startConsultationBody,
            organizationAccess: "consultations:write",
            response: {
              200: m.consultationDetailResponse,
              201: m.consultationDetailResponse,
            },
          },
        )
        .get(
          "/consultations/:consultationId",
          ({ organizationAccess, params }) =>
            service.getById(
              organizationAccess.organizationId,
              params.consultationId,
            ),
          {
            params: m.consultationIdParams,
            organizationAccess: "consultations:read",
            response: { 200: m.consultationDetailResponse },
          },
        ),
    );
}
