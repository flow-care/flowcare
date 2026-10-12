import { Elysia, status } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import {
  createPatientBody,
  idempotencyHeaders,
  patientOrganizationParams,
  patientParams,
  patientResponse,
  updatePatientBody,
} from "./model";
import {
  assertOnlyAllowedPatientUpdateFields,
  PatientsService,
} from "./service";

export function patientsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
}) {
  const service = new PatientsService(deps.prisma);

  return new Elysia({ name: "patients" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
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
    )
    .patch(
      "/organizations/:orgSlug/patients/:patientId",
      ({ auth, organizationAccess, params, body }) =>
        service.update(
          organizationAccess.organizationId,
          auth.userId,
          params.patientId,
          body,
        ),
      {
        params: patientParams,
        body: updatePatientBody,
        transform({ body }) {
          assertOnlyAllowedPatientUpdateFields(body);
        },
        organizationAccess: "patients:write",
        response: { 200: patientResponse },
      },
    )
    .put(
      "/organizations/:orgSlug/patients/:patientId",
      ({ auth, organizationAccess, params, body }) =>
        service.update(
          organizationAccess.organizationId,
          auth.userId,
          params.patientId,
          body,
        ),
      {
        params: patientParams,
        body: updatePatientBody,
        transform({ body }) {
          assertOnlyAllowedPatientUpdateFields(body);
        },
        organizationAccess: "patients:write",
        response: { 200: patientResponse },
      },
    );
}
