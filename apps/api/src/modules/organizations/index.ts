import { Elysia, status } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import type { ProfilePhotoStore } from "../../services/profile-photo-store";
import {
  clinicAddressBody,
  clinicContactBody,
  clinicDetailsResponse,
  clinicLogoBody,
  clinicLogoUrlResponse,
  clinicSettingsResponse,
  clinicUsageQuery,
  clinicUsageResponse,
  createAdditionalOrganizationBody,
  createAdditionalOrganizationResponse,
  organizationsResponse,
  orgSlugParams,
  patchClinicSettingsBody,
  putClinicSettingsBody,
} from "./model";
import { OrganizationsService } from "./service";

export function organizationsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  logoStore?: ProfilePhotoStore | null;
}) {
  const service = new OrganizationsService(deps.prisma, deps.logoStore);

  return new Elysia({ name: "organizations" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
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
          "/:orgSlug",
          ({ auth, params }) =>
            service.getOrganizationBySlug(auth.userId, params.orgSlug),
          {
            params: orgSlugParams,
            organizationAccess: "organizations:read",
            response: { 200: clinicSettingsResponse },
          },
        )
        .get(
          "/:orgSlug/settings",
          ({ auth, params }) =>
            service.getClinicSettings(auth.userId, params.orgSlug),
          {
            params: orgSlugParams,
            organizationAccess: "settings:read",
            response: { 200: clinicSettingsResponse },
          },
        )
        .get(
          "/:orgSlug/settings/usage",
          ({ organizationAccess, query }) =>
            service.getTranscriptionUsage(
              organizationAccess.organizationId,
              query,
            ),
          {
            params: orgSlugParams,
            query: clinicUsageQuery,
            organizationAccess: ["usage:read", "settings:read"] as const,
            response: { 200: clinicUsageResponse },
          },
        )
        .get(
          "/:orgSlug/usage",
          ({ organizationAccess, query }) =>
            service.getTranscriptionUsage(
              organizationAccess.organizationId,
              query,
            ),
          {
            params: orgSlugParams,
            query: clinicUsageQuery,
            organizationAccess: ["usage:read", "settings:read"] as const,
            response: { 200: clinicUsageResponse },
          },
        )
        .patch(
          "/:orgSlug/settings",
          ({ auth, params, body }) =>
            service.updateClinicSettings(auth.userId, params.orgSlug, body),
          {
            params: orgSlugParams,
            body: patchClinicSettingsBody,
            organizationAccess: "settings:write",
            response: { 200: clinicSettingsResponse },
          },
        )
        .put(
          "/:orgSlug/settings",
          ({ auth, params, body }) =>
            service.updateClinicSettings(auth.userId, params.orgSlug, body),
          {
            params: orgSlugParams,
            body: putClinicSettingsBody,
            organizationAccess: "settings:write",
            response: { 200: clinicSettingsResponse },
          },
        )
        .post(
          "/:orgSlug/settings/logo",
          ({ auth, params, body }) =>
            service.uploadClinicLogo(auth.userId, params.orgSlug, body.file),
          {
            params: orgSlugParams,
            body: clinicLogoBody,
            organizationAccess: "settings:write",
            response: { 200: clinicSettingsResponse },
          },
        )
        .get(
          "/:orgSlug/settings/logo/download-url",
          ({ auth, params }) =>
            service.getClinicLogoDownloadUrl(auth.userId, params.orgSlug),
          {
            params: orgSlugParams,
            organizationAccess: "organizations:read",
            response: { 200: clinicLogoUrlResponse },
          },
        )
        .post(
          "/:orgSlug/logo",
          ({ auth, params, body }) =>
            service.uploadClinicLogo(auth.userId, params.orgSlug, body.file),
          {
            params: orgSlugParams,
            body: clinicLogoBody,
            organizationAccess: "settings:write",
            response: { 200: clinicSettingsResponse },
          },
        )
        .get(
          "/:orgSlug/logo/download-url",
          ({ auth, params }) =>
            service.getClinicLogoDownloadUrl(auth.userId, params.orgSlug),
          {
            params: orgSlugParams,
            organizationAccess: "organizations:read",
            response: { 200: clinicLogoUrlResponse },
          },
        )
        .get(
          "/:orgSlug/onboarding-details",
          ({ auth, params }) =>
            service.getClinicDetails(auth.userId, params.orgSlug),
          {
            params: orgSlugParams,
            organizationAccess: "settings:read",
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
            organizationAccess: "settings:write",
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
            organizationAccess: "settings:write",
            response: { 200: clinicDetailsResponse },
          },
        ),
    );
}
