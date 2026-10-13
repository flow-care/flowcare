import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import {
  type OrganizationAccess,
  type OrganizationCapability,
  organizationAccessPlugin,
} from "../../plugins/organization-access";
import * as m from "./model";
import { DocumentsService } from "./service";

async function defaultClinicalEligibility(
  context: OrganizationAccess,
  capability: OrganizationCapability,
): Promise<boolean> {
  return (
    (capability === "documents:read" || capability === "documents:write") &&
    (context.role === "ADMIN_PROFESSIONAL" || context.role === "PROFESSIONAL")
  );
}

export function documentsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  clinicalEligibility?: (
    context: OrganizationAccess,
    capability: OrganizationCapability,
  ) => Promise<boolean>;
}) {
  const service = new DocumentsService(deps.prisma);
  const clinicalEligibility =
    deps.clinicalEligibility ?? defaultClinicalEligibility;

  return new Elysia({ name: "documents" })
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
        .post(
          "/documents",
          async ({ auth, organizationAccess, body, set }) => {
            const result = await service.createDraft(
              organizationAccess.organizationId,
              auth.userId,
              body,
            );
            set.status = 201;
            return result;
          },
          {
            params: m.orgSlugParams,
            body: m.createDocumentDraftBody,
            organizationAccess: "documents:write",
            response: { 201: m.documentResponse },
          },
        )
        .post(
          "/documents/drafts",
          async ({ auth, organizationAccess, body, set }) => {
            const result = await service.createDraft(
              organizationAccess.organizationId,
              auth.userId,
              body,
            );
            set.status = 201;
            return result;
          },
          {
            params: m.orgSlugParams,
            body: m.createDocumentDraftBody,
            organizationAccess: "documents:write",
            response: { 201: m.documentResponse },
          },
        )
        .get(
          "/documents/:documentId",
          ({ organizationAccess, params }) =>
            service.getById(
              organizationAccess.organizationId,
              params.documentId,
            ),
          {
            params: m.documentIdParams,
            organizationAccess: "documents:read",
            response: { 200: m.documentResponse },
          },
        )
        .get(
          "/documents/:documentId/versions",
          ({ organizationAccess, params }) =>
            service.listVersions(
              organizationAccess.organizationId,
              params.documentId,
            ),
          {
            params: m.documentIdParams,
            organizationAccess: "documents:read",
            response: { 200: m.documentVersionsResponse },
          },
        )
        .patch(
          "/documents/:documentId",
          ({ auth, organizationAccess, params, body }) =>
            service.updateDraft(
              organizationAccess.organizationId,
              auth.userId,
              params.documentId,
              body,
            ),
          {
            params: m.documentIdParams,
            body: m.updateDocumentDraftBody,
            organizationAccess: "documents:write",
            response: { 200: m.documentResponse },
          },
        )
        .put(
          "/documents/:documentId",
          ({ auth, organizationAccess, params, body }) =>
            service.updateDraft(
              organizationAccess.organizationId,
              auth.userId,
              params.documentId,
              body,
            ),
          {
            params: m.documentIdParams,
            body: m.updateDocumentDraftBody,
            organizationAccess: "documents:write",
            response: { 200: m.documentResponse },
          },
        )
        .patch(
          "/documents/:documentId/draft",
          ({ auth, organizationAccess, params, body }) =>
            service.updateDraft(
              organizationAccess.organizationId,
              auth.userId,
              params.documentId,
              body,
            ),
          {
            params: m.documentIdParams,
            body: m.updateDocumentDraftBody,
            organizationAccess: "documents:write",
            response: { 200: m.documentResponse },
          },
        )
        .put(
          "/documents/:documentId/draft",
          ({ auth, organizationAccess, params, body }) =>
            service.updateDraft(
              organizationAccess.organizationId,
              auth.userId,
              params.documentId,
              body,
            ),
          {
            params: m.documentIdParams,
            body: m.updateDocumentDraftBody,
            organizationAccess: "documents:write",
            response: { 200: m.documentResponse },
          },
        )
        .post(
          "/documents/:documentId/snapshot",
          ({ auth, organizationAccess, params, body }) =>
            service.prepareSnapshot(
              organizationAccess.organizationId,
              auth.userId,
              params.documentId,
              body,
            ),
          {
            params: m.documentIdParams,
            body: m.prepareDocumentSnapshotBody,
            organizationAccess: "documents:write",
            response: { 200: m.prepareDocumentSnapshotResponse },
          },
        )
        .post(
          "/documents/:documentId/prepare",
          ({ auth, organizationAccess, params, body }) =>
            service.prepareSnapshot(
              organizationAccess.organizationId,
              auth.userId,
              params.documentId,
              body,
            ),
          {
            params: m.documentIdParams,
            body: m.prepareDocumentSnapshotBody,
            organizationAccess: "documents:write",
            response: { 200: m.prepareDocumentSnapshotResponse },
          },
        ),
    );
}
