import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import {
  type OrganizationAccess,
  type OrganizationCapability,
  organizationAccessPlugin,
} from "../../plugins/organization-access";
import type { ConsultationAudioStore } from "../../services/consultation-audio-store";
import type { ExtractionProvider } from "../../services/extraction-provider";
import type { TranscriptionProvider } from "../../services/transcription-provider";
import { ConsultationAudioService } from "./audio-service";
import * as m from "./model";
import { ConsultationsService } from "./service";
import { ConsultationTranscriptionService } from "./transcription-service";

async function defaultClinicalEligibility(
  context: OrganizationAccess,
  capability: OrganizationCapability,
): Promise<boolean> {
  return (
    (capability === "consultations:read" ||
      capability === "consultations:write" ||
      capability === "consultations:approve") &&
    (context.role === "ADMIN" ||
      context.role === "ADMIN_PROFESSIONAL" ||
      context.role === "PROFESSIONAL")
  );
}

export function consultationsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  audioStore?: ConsultationAudioStore | null;
  transcriptionProvider?: TranscriptionProvider | null;
  extractionProvider?: ExtractionProvider | null;
  clinicalEligibility?: (
    context: OrganizationAccess,
    capability: OrganizationCapability,
  ) => Promise<boolean>;
}) {
  const service = new ConsultationsService(deps.prisma);
  const audioService = new ConsultationAudioService(
    deps.prisma,
    deps.audioStore ?? null,
  );
  const transcriptionService = new ConsultationTranscriptionService(
    deps.prisma,
    deps.transcriptionProvider ?? null,
    deps.audioStore ?? null,
    deps.extractionProvider ?? null,
  );
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
        )
        .post(
          "/consultations/:consultationId/audio",
          ({ auth, organizationAccess, params, body }) =>
            audioService.upload(
              organizationAccess.organizationId,
              params.consultationId,
              auth.userId,
              body,
            ),
          {
            params: m.consultationIdParams,
            body: m.uploadAudioBody,
            organizationAccess: "consultations:write",
            response: { 200: m.audioResponse },
          },
        )
        .post(
          "/consultations/:consultationId/audio/upload-url",
          ({ auth, organizationAccess, params, body }) =>
            audioService.prepare(
              organizationAccess.organizationId,
              params.consultationId,
              auth.userId,
              body,
            ),
          {
            params: m.consultationIdParams,
            body: m.prepareAudioBody,
            organizationAccess: "consultations:write",
            response: { 200: m.prepareAudioResponse },
          },
        )
        .post(
          "/consultations/:consultationId/audio/:audioId/complete",
          ({ auth, organizationAccess, params }) =>
            audioService.finalize(
              organizationAccess.organizationId,
              params.consultationId,
              params.audioId,
              auth.userId,
            ),
          {
            params: m.audioIdParams,
            organizationAccess: "consultations:write",
            response: { 200: m.audioResponse },
          },
        )
        .post(
          "/consultations/:consultationId/transcribe",
          async ({ auth, organizationAccess, params, headers, set }) => {
            const idempotencyKey = headers["idempotency-key"];
            const result = await transcriptionService.transcribe(
              organizationAccess.organizationId,
              params.consultationId,
              auth.userId,
              idempotencyKey,
            );
            set.status = 202;
            return result;
          },
          {
            params: m.consultationIdParams,
            headers: m.idempotencyHeaders,
            organizationAccess: "consultations:write",
            response: { 202: m.transcriptionResponse },
          },
        )
        .get(
          "/consultations/:consultationId/transcription",
          ({ organizationAccess, params }) =>
            transcriptionService.status(
              organizationAccess.organizationId,
              params.consultationId,
            ),
          {
            params: m.consultationIdParams,
            organizationAccess: "consultations:read",
            response: { 200: m.transcriptionStatusResponse },
          },
        )
        .patch(
          "/consultations/:consultationId/draft",
          ({ auth, organizationAccess, params, body }) =>
            service.saveDraft(
              organizationAccess.organizationId,
              auth.userId,
              organizationAccess.role,
              params.consultationId,
              body,
            ),
          {
            params: m.consultationIdParams,
            body: m.saveConsultationDraftBody,
            organizationAccess: "consultations:write",
            response: { 200: m.consultationDetailResponse },
          },
        )
        .put(
          "/consultations/:consultationId/draft",
          ({ auth, organizationAccess, params, body }) =>
            service.saveDraft(
              organizationAccess.organizationId,
              auth.userId,
              organizationAccess.role,
              params.consultationId,
              body,
            ),
          {
            params: m.consultationIdParams,
            body: m.saveConsultationDraftBody,
            organizationAccess: "consultations:write",
            response: { 200: m.consultationDetailResponse },
          },
        )
        .patch(
          "/consultations/:consultationId/anamnesis/draft",
          ({ auth, organizationAccess, params, body }) =>
            service.saveDraft(
              organizationAccess.organizationId,
              auth.userId,
              organizationAccess.role,
              params.consultationId,
              body,
            ),
          {
            params: m.consultationIdParams,
            body: m.saveConsultationDraftBody,
            organizationAccess: "consultations:write",
            response: { 200: m.consultationDetailResponse },
          },
        )
        .put(
          "/consultations/:consultationId/anamnesis/draft",
          ({ auth, organizationAccess, params, body }) =>
            service.saveDraft(
              organizationAccess.organizationId,
              auth.userId,
              organizationAccess.role,
              params.consultationId,
              body,
            ),
          {
            params: m.consultationIdParams,
            body: m.saveConsultationDraftBody,
            organizationAccess: "consultations:write",
            response: { 200: m.consultationDetailResponse },
          },
        )
        .post(
          "/consultations/:consultationId/approve",
          ({ auth, organizationAccess, params, body }) =>
            service.approve(
              organizationAccess.organizationId,
              auth.userId,
              organizationAccess.role,
              params.consultationId,
              body,
            ),
          {
            params: m.consultationIdParams,
            body: m.approveConsultationBody,
            organizationAccess: "consultations:approve",
            response: { 200: m.approveConsultationResponse },
          },
        )
        .put(
          "/consultations/:consultationId/approve",
          ({ auth, organizationAccess, params, body }) =>
            service.approve(
              organizationAccess.organizationId,
              auth.userId,
              organizationAccess.role,
              params.consultationId,
              body,
            ),
          {
            params: m.consultationIdParams,
            body: m.approveConsultationBody,
            organizationAccess: "consultations:approve",
            response: { 200: m.approveConsultationResponse },
          },
        )
        .post(
          "/consultations/:consultationId/anamnesis/approve",
          ({ auth, organizationAccess, params, body }) =>
            service.approve(
              organizationAccess.organizationId,
              auth.userId,
              organizationAccess.role,
              params.consultationId,
              body,
            ),
          {
            params: m.consultationIdParams,
            body: m.approveConsultationBody,
            organizationAccess: "consultations:approve",
            response: { 200: m.approveConsultationResponse },
          },
        )
        .put(
          "/consultations/:consultationId/anamnesis/approve",
          ({ auth, organizationAccess, params, body }) =>
            service.approve(
              organizationAccess.organizationId,
              auth.userId,
              organizationAccess.role,
              params.consultationId,
              body,
            ),
          {
            params: m.consultationIdParams,
            body: m.approveConsultationBody,
            organizationAccess: "consultations:approve",
            response: { 200: m.approveConsultationResponse },
          },
        ),
    );
}
