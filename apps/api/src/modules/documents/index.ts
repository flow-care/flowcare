import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { isClinicalRole } from "../../lib/roles";
import { authPlugin } from "../../plugins/auth";
import {
  canReadAllClinical,
  clinicalOwnerPicker,
  type OrganizationAccess,
  type OrganizationCapability,
  organizationAccessPlugin,
} from "../../plugins/organization-access";
import * as m from "./model";
import { DocumentsService } from "./service";

export function documentsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  pdf?: ConstructorParameters<typeof DocumentsService>[1];
}) {
  const service = new DocumentsService(deps.prisma, deps.pdf);

  return new Elysia({ name: "documents" })
    .use(authPlugin(deps))
    .use(
      organizationAccessPlugin({
        prisma: deps.prisma,
        jwtSecret: deps.jwtSecret,
      }),
    )
    .group("/organizations/:orgSlug", (group) =>
      group
        .get(
          "/documents",
          ({ organizationAccess, query }) =>
            service.list(organizationAccess.organizationId, {
              ...query,
              // Sem `clinical:read_all`, só os documentos que ele assinou.
              ...(canReadAllClinical(organizationAccess)
                ? {}
                : { authorId: organizationAccess.userId }),
            }),
          {
            params: m.orgSlugParams,
            query: m.listDocumentsQuery,
            organizationAccess: "documents:read",
            response: { 200: m.listDocumentsResponse },
          },
        )
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
          ({ organizationAccess, params, query }) =>
            service.getById(
              organizationAccess.organizationId,
              params.documentId,
              query?.version,
              clinicalOwnerPicker(organizationAccess),
            ),
          {
            params: m.documentIdParams,
            query: m.getDocumentQuery,
            organizationAccess: "documents:read",
            response: { 200: m.documentResponse },
          },
        )
        .get(
          "/documents/:documentId/pdf",
          async ({ organizationAccess, params, set }) => {
            const pdfBytes = await service.getPdf(
              organizationAccess.organizationId,
              params.documentId,
              clinicalOwnerPicker(organizationAccess),
            );
            set.headers["content-type"] = "application/pdf";
            set.headers["content-disposition"] =
              `inline; filename="documento-${params.documentId}.pdf"`;
            return new Response(pdfBytes, {
              status: 200,
              headers: {
                "content-type": "application/pdf",
                "content-disposition": `inline; filename="documento-${params.documentId}.pdf"`,
              },
            });
          },
          {
            params: m.documentIdParams,
            organizationAccess: "documents:read",
          },
        )
        .get(
          "/documents/:documentId/versions",
          ({ organizationAccess, params, query }) =>
            service.listVersions(
              organizationAccess.organizationId,
              params.documentId,
              query,
              clinicalOwnerPicker(organizationAccess),
            ),
          {
            params: m.documentIdParams,
            query: m.listVersionsQuery,
            organizationAccess: "documents:read",
            response: { 200: m.documentVersionsResponse },
          },
        )
        .get(
          "/documents/:documentId/versions/:versionId",
          ({ organizationAccess, params }) =>
            service.getVersion(
              organizationAccess.organizationId,
              params.documentId,
              params.versionId,
              clinicalOwnerPicker(organizationAccess),
            ),
          {
            params: m.documentVersionParams,
            organizationAccess: "documents:read",
            response: { 200: m.documentVersionDetailResponse },
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
        )
        .post(
          "/documents/:documentId/issue",
          ({ auth, organizationAccess, params }) =>
            service.issue(
              organizationAccess.organizationId,
              auth.userId,
              params.documentId,
            ),
          {
            params: m.documentIdParams,
            organizationAccess: "documents:issue",
            response: { 200: m.issueDocumentResponse },
          },
        )
        .post(
          "/documents/:documentId/rectify",
          async ({ auth, organizationAccess, params, set }) => {
            const result = await service.rectify(
              organizationAccess.organizationId,
              auth.userId,
              params.documentId,
              { canIssueOthers: canReadAllClinical(organizationAccess) },
            );
            set.status = 201;
            return result;
          },
          {
            params: m.documentIdParams,
            organizationAccess: "documents:write",
            response: { 201: m.rectifyDocumentResponse },
          },
        )
        .post(
          "/documents/:documentId/void",
          ({ auth, organizationAccess, params, body }) =>
            service.void(
              organizationAccess.organizationId,
              auth.userId,
              organizationAccess.role,
              params.documentId,
              body,
              { canVoidOthers: canReadAllClinical(organizationAccess) },
            ),
          {
            params: m.documentIdParams,
            body: m.voidDocumentBody,
            organizationAccess: "documents:void",
            response: { 200: m.voidDocumentResponse },
          },
        ),
    );
}
