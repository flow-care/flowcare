import { Elysia, status } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import {
  createPatientBody,
  idempotencyHeaders,
  listPatientsQuery,
  listPatientsResponse,
  patientDetailResponse,
  patientIdParams,
  patientOrganizationParams,
  patientOverviewResponse,
  patientResponse,
} from "./model";
import { PatientsService } from "./service";

export function patientsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
}) {
  const service = new PatientsService(deps.prisma);

  return new Elysia({ name: "patients" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
    .get(
      "/organizations/:orgSlug/patients",
      ({ organizationAccess, query }) =>
        service.list(organizationAccess.organizationId, query),
      {
        params: patientOrganizationParams,
        query: listPatientsQuery,
        organizationAccess: "patients:read",
        response: { 200: listPatientsResponse },
      },
    )
    .get(
      "/organizations/:orgSlug/patients/:id",
      ({ organizationAccess, params }) =>
        service.getById(organizationAccess.organizationId, params.id),
      {
        params: patientIdParams,
        organizationAccess: "patients:read",
        response: { 200: patientDetailResponse },
      },
    )
    .get(
      "/organizations/:orgSlug/patients/:id/overview",
      ({ organizationAccess, params }) =>
        service.getOverview(organizationAccess.organizationId, params.id, {
          canReadClinicalHistory: organizationAccess.capabilities.has(
            "patients:read_history",
          ),
        }),
      {
        params: patientIdParams,
        organizationAccess: "patients:read",
        response: { 200: patientOverviewResponse },
      },
    )
    .post(
      "/organizations/:orgSlug/patients",
      async ({ organizationAccess, headers, body }) =>
        status(
          201,
          await service.create(
            organizationAccess.organizationId,
            headers["idempotency-key"],
            body,
          ),
        ),
      {
        params: patientOrganizationParams,
        headers: idempotencyHeaders,
        body: createPatientBody,
        organizationAccess: "patients:write",
        response: { 201: patientResponse },
      },
    );
}
