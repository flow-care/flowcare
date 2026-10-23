import { Elysia, status } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import {
  canReadAllClinical,
  organizationAccessPlugin,
} from "../../plugins/organization-access";
import type { ProfilePhotoStore } from "../../services/profile-photo-store";
import {
  archivePatientAttachmentBody,
  archivePatientAttachmentResponse,
  createPatientBody,
  idempotencyHeaders,
  listPatientAttachmentsQuery,
  listPatientAttachmentsResponse,
  listPatientsQuery,
  listPatientsResponse,
  patientAttachmentDownloadUrlResponse,
  patientAttachmentParams,
  patientDetailResponse,
  patientIdParams,
  patientOrganizationParams,
  patientOverviewResponse,
  patientParams,
  patientResponse,
  patientTimelineQuery,
  patientTimelineResponse,
  updatePatientBody,
  uploadPatientAttachmentBody,
  uploadPatientAttachmentResponse,
} from "./model";
import {
  assertOnlyAllowedPatientUpdateFields,
  PatientsService,
} from "./service";

export function patientsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  attachmentStore?: ProfilePhotoStore | null;
}) {
  const service = new PatientsService(deps.prisma, deps.attachmentStore);

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
          canReadClinicalHistory: organizationAccess.permissions.has(
            "patients:read_history",
          ),
          canReadHistorySummary: organizationAccess.permissions.has(
            "patients:read_history_summary",
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
    )
    .post(
      "/organizations/:orgSlug/patients/:id/attachments",
      async ({ auth, organizationAccess, params, body }) =>
        status(
          201,
          await service.uploadAttachment(
            organizationAccess.organizationId,
            params.id,
            auth.userId,
            body,
          ),
        ),
      {
        params: patientIdParams,
        body: uploadPatientAttachmentBody,
        organizationAccess: "patients:attachments:write",
        response: { 201: uploadPatientAttachmentResponse },
      },
    )
    .get(
      "/organizations/:orgSlug/patients/:id/attachments",
      ({ organizationAccess, params, query }) =>
        service.listAttachments(
          organizationAccess.organizationId,
          params.id,
          query,
        ),
      {
        params: patientIdParams,
        query: listPatientAttachmentsQuery,
        organizationAccess: "patients:attachments:read",
        response: { 200: listPatientAttachmentsResponse },
      },
    )
    .post(
      "/organizations/:orgSlug/patients/:id/attachments/:attachmentId/download-url",
      ({ auth, organizationAccess, params }) =>
        service.createDownloadUrl(
          organizationAccess.organizationId,
          params.id,
          params.attachmentId,
          auth.userId,
        ),
      {
        params: patientAttachmentParams,
        organizationAccess: "patients:attachments:read",
        response: { 200: patientAttachmentDownloadUrlResponse },
      },
    )
    .get(
      "/organizations/:orgSlug/patients/:id/attachments/:attachmentId/download-url",
      ({ auth, organizationAccess, params }) =>
        service.createDownloadUrl(
          organizationAccess.organizationId,
          params.id,
          params.attachmentId,
          auth.userId,
        ),
      {
        params: patientAttachmentParams,
        organizationAccess: "patients:attachments:read",
        response: { 200: patientAttachmentDownloadUrlResponse },
      },
    )
    .delete(
      "/organizations/:orgSlug/patients/:id/attachments/:attachmentId",
      ({ auth, organizationAccess, params, body }) =>
        service.archiveAttachment(
          organizationAccess.organizationId,
          params.id,
          params.attachmentId,
          auth.userId,
          body,
        ),
      {
        params: patientAttachmentParams,
        body: archivePatientAttachmentBody,
        organizationAccess: "patients:attachments:write",
        response: { 200: archivePatientAttachmentResponse },
      },
    )
    .post(
      "/organizations/:orgSlug/patients/:id/attachments/:attachmentId/archive",
      ({ auth, organizationAccess, params, body }) =>
        service.archiveAttachment(
          organizationAccess.organizationId,
          params.id,
          params.attachmentId,
          auth.userId,
          body,
        ),
      {
        params: patientAttachmentParams,
        body: archivePatientAttachmentBody,
        organizationAccess: "patients:attachments:write",
        response: { 200: archivePatientAttachmentResponse },
      },
    )
    .get(
      "/organizations/:orgSlug/patients/:id/timeline",
      ({ auth, organizationAccess, params, query }) =>
        service.getTimeline(
          organizationAccess.organizationId,
          params.id,
          auth.userId,
          query,
          { readAll: canReadAllClinical(organizationAccess) },
        ),
      {
        params: patientIdParams,
        query: patientTimelineQuery,
        organizationAccess: "patients:read_history",
        response: { 200: patientTimelineResponse },
      },
    )
    .get(
      "/organizations/:orgSlug/patients/:id/records",
      ({ auth, organizationAccess, params, query }) =>
        service.getTimeline(
          organizationAccess.organizationId,
          params.id,
          auth.userId,
          query,
          { readAll: canReadAllClinical(organizationAccess) },
        ),
      {
        params: patientIdParams,
        query: patientTimelineQuery,
        organizationAccess: "patients:read_history",
        response: { 200: patientTimelineResponse },
      },
    );
}
