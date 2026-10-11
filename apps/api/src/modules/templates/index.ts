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
    capability === "templates:read" &&
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
        ),
    );
}
