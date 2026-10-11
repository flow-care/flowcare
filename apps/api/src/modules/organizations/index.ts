import { Elysia, status } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import {
  clinicAddressBody,
  clinicContactBody,
  clinicDetailsResponse,
  createAdditionalOrganizationBody,
  createAdditionalOrganizationResponse,
  organizationsResponse,
  orgSlugParams,
} from "./model";
import { OrganizationsService } from "./service";

export function organizationsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
}) {
  const service = new OrganizationsService(deps.prisma);

  return new Elysia({ name: "organizations" })
    .use(authPlugin(deps))
    .group("/organizations", (group) =>
      group
        .get("", ({ auth }) => service.listForUser(auth.userId), {
          response: { 200: organizationsResponse },
        })
        .post(
          "",
          async ({ auth, body }) =>
            status(201, await service.createAdditional(auth.userId, body)),
          {
            body: createAdditionalOrganizationBody,
            response: { 201: createAdditionalOrganizationResponse },
          },
        )
        .get(
          "/:orgSlug/onboarding-details",
          ({ auth, params }) =>
            service.getClinicDetails(auth.userId, params.orgSlug),
          {
            params: orgSlugParams,
            response: { 200: clinicDetailsResponse },
          },
        )
        .put(
          "/:orgSlug/onboarding-contact",
          ({ auth, params, body }) =>
            service.saveClinicContact(auth.userId, params.orgSlug, body),
          {
            params: orgSlugParams,
            body: clinicContactBody,
            response: { 200: clinicDetailsResponse },
          },
        )
        .put(
          "/:orgSlug/onboarding-address",
          ({ auth, params, body }) =>
            service.saveClinicAddress(auth.userId, params.orgSlug, body),
          {
            params: orgSlugParams,
            body: clinicAddressBody,
            response: { 200: clinicDetailsResponse },
          },
        ),
    );
}
