import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import {
  type OrganizationAccess,
  type OrganizationCapability,
  organizationAccessPlugin,
} from "../../plugins/organization-access";
import { Unauthenticated } from "../auth/errors";
import * as m from "./model";
import { TemplatesService } from "./service";

async function defaultClinicalEligibility(
  context: OrganizationAccess,
  capability: OrganizationCapability,
): Promise<boolean> {
  return (
    (capability === "templates:read" || capability === "templates:write") &&
    (context.role === "ADMIN_PROFESSIONAL" || context.role === "PROFESSIONAL")
  );
}

export function templatesModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  clinicalEligibility?: (
    context: OrganizationAccess,
    capability: OrganizationCapability,
  ) => Promise<boolean>;
}) {
  const service = new TemplatesService(deps.prisma);
  const clinicalEligibility =
    deps.clinicalEligibility ?? defaultClinicalEligibility;

  return new Elysia({ name: "templates" })
    .use(authPlugin(deps))
    .use(
      organizationAccessPlugin({
        prisma: deps.prisma,
        jwtSecret: deps.jwtSecret,
        clinicalEligibility,
      }),
    )
    .get(
      "/templates/variables",
      ({ auth }) => {
        if (!auth) throw Unauthenticated();
        return service.listVariables();
      },
      {
        response: { 200: m.templateVariablesResponse },
      },
    )
    .group("/organizations/:orgSlug", (group) =>
      group
        .get("/templates/variables", () => service.listVariables(), {
          params: m.orgSlugParams,
          organizationAccess: "templates:read",
          response: { 200: m.templateVariablesResponse },
        })
        .get(
          "/templates",
          ({ organizationAccess, query }) =>
            service.list(organizationAccess.organizationId, query),
          {
            params: m.orgSlugParams,
            query: m.listTemplatesQuery,
            organizationAccess: "templates:read",
            response: { 200: m.listTemplatesResponse },
          },
        )
        .get(
          "/document-templates",
          ({ organizationAccess, query }) =>
            service.list(organizationAccess.organizationId, query),
          {
            params: m.orgSlugParams,
            query: m.listTemplatesQuery,
            organizationAccess: "templates:read",
            response: { 200: m.listTemplatesResponse },
          },
        )
        .get(
          "/templates/:templateId",
          ({ organizationAccess, params, query }) =>
            service.getById(
              organizationAccess.organizationId,
              params.templateId,
              query.version,
            ),
          {
            params: m.templateParams,
            query: m.getTemplateQuery,
            organizationAccess: "templates:read",
            response: { 200: m.templateDetailResponse },
          },
        )
        .get(
          "/document-templates/:templateId",
          ({ organizationAccess, params, query }) =>
            service.getById(
              organizationAccess.organizationId,
              params.templateId,
              query.version,
            ),
          {
            params: m.templateParams,
            query: m.getTemplateQuery,
            organizationAccess: "templates:read",
            response: { 200: m.templateDetailResponse },
          },
        )
        .get(
          "/templates/:templateId/versions",
          ({ organizationAccess, params }) =>
            service.listVersions(
              organizationAccess.organizationId,
              params.templateId,
            ),
          {
            params: m.templateParams,
            organizationAccess: "templates:read",
            response: { 200: m.templateVersionsResponse },
          },
        )
        .get(
          "/document-templates/:templateId/versions",
          ({ organizationAccess, params }) =>
            service.listVersions(
              organizationAccess.organizationId,
              params.templateId,
            ),
          {
            params: m.templateParams,
            organizationAccess: "templates:read",
            response: { 200: m.templateVersionsResponse },
          },
        )
        .get(
          "/templates/:templateId/versions/:version",
          ({ organizationAccess, params }) =>
            service.getById(
              organizationAccess.organizationId,
              params.templateId,
              params.version,
            ),
          {
            params: m.templateVersionParams,
            organizationAccess: "templates:read",
            response: { 200: m.templateDetailResponse },
          },
        )
        .get(
          "/document-templates/:templateId/versions/:version",
          ({ organizationAccess, params }) =>
            service.getById(
              organizationAccess.organizationId,
              params.templateId,
              params.version,
            ),
          {
            params: m.templateVersionParams,
            organizationAccess: "templates:read",
            response: { 200: m.templateDetailResponse },
          },
        )
        .post(
          "/templates",
          async ({ auth, organizationAccess, body, set }) => {
            if (!auth) throw Unauthenticated();
            const created = await service.create(
              organizationAccess.organizationId,
              auth.userId,
              body,
            );
            set.status = 201;
            return created;
          },
          {
            params: m.orgSlugParams,
            body: m.createTemplateBody,
            organizationAccess: "templates:write",
            response: { 201: m.templateDetailResponse },
          },
        )
        .post(
          "/document-templates",
          async ({ auth, organizationAccess, body, set }) => {
            if (!auth) throw Unauthenticated();
            const created = await service.create(
              organizationAccess.organizationId,
              auth.userId,
              body,
            );
            set.status = 201;
            return created;
          },
          {
            params: m.orgSlugParams,
            body: m.createTemplateBody,
            organizationAccess: "templates:write",
            response: { 201: m.templateDetailResponse },
          },
        )
        .patch(
          "/templates/:templateId",
          ({ auth, organizationAccess, params, body }) => {
            if (!auth) throw Unauthenticated();
            return service.update(
              organizationAccess.organizationId,
              auth.userId,
              params.templateId,
              body,
            );
          },
          {
            params: m.templateParams,
            body: m.updateTemplateBody,
            organizationAccess: "templates:write",
            response: { 200: m.templateDetailResponse },
          },
        )
        .patch(
          "/document-templates/:templateId",
          ({ auth, organizationAccess, params, body }) => {
            if (!auth) throw Unauthenticated();
            return service.update(
              organizationAccess.organizationId,
              auth.userId,
              params.templateId,
              body,
            );
          },
          {
            params: m.templateParams,
            body: m.updateTemplateBody,
            organizationAccess: "templates:write",
            response: { 200: m.templateDetailResponse },
          },
        )
        .put(
          "/templates/:templateId",
          ({ auth, organizationAccess, params, body }) => {
            if (!auth) throw Unauthenticated();
            return service.update(
              organizationAccess.organizationId,
              auth.userId,
              params.templateId,
              body,
            );
          },
          {
            params: m.templateParams,
            body: m.updateTemplateBody,
            organizationAccess: "templates:write",
            response: { 200: m.templateDetailResponse },
          },
        )
        .put(
          "/document-templates/:templateId",
          ({ auth, organizationAccess, params, body }) => {
            if (!auth) throw Unauthenticated();
            return service.update(
              organizationAccess.organizationId,
              auth.userId,
              params.templateId,
              body,
            );
          },
          {
            params: m.templateParams,
            body: m.updateTemplateBody,
            organizationAccess: "templates:write",
            response: { 200: m.templateDetailResponse },
          },
        ),
    );
}
