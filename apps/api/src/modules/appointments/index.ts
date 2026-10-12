import { Elysia, status } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import * as m from "./model";
import { AppointmentsService } from "./service";

export function appointmentsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
}) {
  const service = new AppointmentsService(deps.prisma);
  return new Elysia({ name: "appointments" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
    .group("/organizations/:orgSlug/reception", (group) =>
      group
        .get(
          "/queue",
          ({ organizationAccess, query }) =>
            service.listReceptionQueue(
              organizationAccess.organizationId,
              query,
            ),
          {
            params: m.orgSlugParams,
            query: m.receptionQueueQuery,
            organizationAccess: "reception:read",
            response: { 200: m.receptionQueueResponse },
          },
        )
        .patch(
          "/queue/:appointmentId",
          ({ auth, organizationAccess, params, body }) =>
            service.transitionReceptionQueue(
              organizationAccess.organizationId,
              auth.userId,
              params.appointmentId,
              body,
            ),
          {
            params: m.appointmentParams,
            body: m.receptionQueueTransitionBody,
            organizationAccess: "reception:write",
            response: { 200: m.receptionQueueItem },
          },
        )
        .post(
          "/queue/:appointmentId",
          ({ auth, organizationAccess, params, body }) =>
            service.transitionReceptionQueue(
              organizationAccess.organizationId,
              auth.userId,
              params.appointmentId,
              body,
            ),
          {
            params: m.appointmentParams,
            body: m.receptionQueueTransitionBody,
            organizationAccess: "reception:write",
            response: { 200: m.receptionQueueItem },
          },
        ),
    )
    .group("/organizations/:orgSlug/appointments", (group) =>
      group
        .get(
          "/availability",
          ({ organizationAccess, query }) =>
            service.availability(organizationAccess.organizationId, query),
          {
            params: m.organizationParams,
            query: m.availabilityQuery,
            organizationAccess: "appointments:read",
            response: { 200: m.availabilityResponse },
          },
        )
        .get(
          "/confirmations/pending",
          ({ organizationAccess, query }) =>
            service.listPendingConfirmations(
              organizationAccess.organizationId,
              query,
            ),
          {
            params: m.orgSlugParams,
            query: m.pendingConfirmationsQuery,
            organizationAccess: "reception:read",
            response: { 200: m.pendingConfirmationsResponse },
          },
        )
        .patch(
          "/:appointmentId/confirmation",
          ({ auth, organizationAccess, params, headers, body }) =>
            service.recordConfirmationDecision(
              organizationAccess.organizationId,
              auth.userId,
              params.appointmentId,
              body,
              headers["idempotency-key"],
            ),
          {
            params: m.confirmationDecisionParams,
            headers: m.optionalIdempotencyHeaders,
            body: m.confirmationDecisionBody,
            organizationAccess: "reception:write",
            response: { 200: m.confirmationDecisionResponse },
          },
        )
        .post(
          "/:appointmentId/confirmation",
          ({ auth, organizationAccess, params, headers, body }) =>
            service.recordConfirmationDecision(
              organizationAccess.organizationId,
              auth.userId,
              params.appointmentId,
              body,
              headers["idempotency-key"],
            ),
          {
            params: m.confirmationDecisionParams,
            headers: m.optionalIdempotencyHeaders,
            body: m.confirmationDecisionBody,
            organizationAccess: "reception:write",
            response: { 200: m.confirmationDecisionResponse },
          },
        )
        .get(
          "/queue",
          ({ organizationAccess, query }) =>
            service.listReceptionQueue(
              organizationAccess.organizationId,
              query,
            ),
          {
            params: m.orgSlugParams,
            query: m.receptionQueueQuery,
            organizationAccess: "reception:read",
            response: { 200: m.receptionQueueResponse },
          },
        )
        .get(
          "",
          ({ organizationAccess, query }) =>
            service.list(organizationAccess.organizationId, query),
          {
            params: m.organizationParams,
            query: m.listQuery,
            organizationAccess: "appointments:read",
            response: { 200: m.listResponse },
          },
        )
        .post(
          "",
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
            params: m.organizationParams,
            headers: m.idempotencyHeaders,
            body: m.createAppointmentBody,
            organizationAccess: "appointments:write",
            response: { 201: m.createAppointmentResponse },
          },
        )
        .patch(
          "/:appointmentId/queue",
          ({ auth, organizationAccess, params, body }) =>
            service.transitionReceptionQueue(
              organizationAccess.organizationId,
              auth.userId,
              params.appointmentId,
              body,
            ),
          {
            params: m.appointmentParams,
            body: m.receptionQueueTransitionBody,
            organizationAccess: "reception:write",
            response: { 200: m.receptionQueueItem },
          },
        )
        .patch(
          "/:appointmentId/arrival",
          ({ auth, organizationAccess, params, body }) =>
            service.transitionReceptionQueue(
              organizationAccess.organizationId,
              auth.userId,
              params.appointmentId,
              body,
            ),
          {
            params: m.appointmentParams,
            body: m.receptionQueueTransitionBody,
            organizationAccess: "reception:write",
            response: { 200: m.receptionQueueItem },
          },
        )
        .patch(
          "/:appointmentId/reception-status",
          ({ auth, organizationAccess, params, body }) =>
            service.transitionReceptionQueue(
              organizationAccess.organizationId,
              auth.userId,
              params.appointmentId,
              body,
            ),
          {
            params: m.appointmentParams,
            body: m.receptionQueueTransitionBody,
            organizationAccess: "reception:write",
            response: { 200: m.receptionQueueItem },
          },
        )
        .post(
          "/:appointmentId/reception-status",
          ({ auth, organizationAccess, params, body }) =>
            service.transitionReceptionQueue(
              organizationAccess.organizationId,
              auth.userId,
              params.appointmentId,
              body,
            ),
          {
            params: m.appointmentParams,
            body: m.receptionQueueTransitionBody,
            organizationAccess: "reception:write",
            response: { 200: m.receptionQueueItem },
          },
        ),
    )
    .group("/organizations/:orgSlug/confirmations", (group) =>
      group
        .get(
          "/pending",
          ({ organizationAccess, query }) =>
            service.listPendingConfirmations(
              organizationAccess.organizationId,
              query,
            ),
          {
            params: m.orgSlugParams,
            query: m.pendingConfirmationsQuery,
            organizationAccess: "reception:read",
            response: { 200: m.pendingConfirmationsResponse },
          },
        )
        .post(
          "/:appointmentId/decision",
          ({ auth, organizationAccess, params, headers, body }) =>
            service.recordConfirmationDecision(
              organizationAccess.organizationId,
              auth.userId,
              params.appointmentId,
              body,
              headers["idempotency-key"],
            ),
          {
            params: m.confirmationDecisionParams,
            headers: m.optionalIdempotencyHeaders,
            body: m.confirmationDecisionBody,
            organizationAccess: "reception:write",
            response: { 200: m.confirmationDecisionResponse },
          },
        ),
    );
}
