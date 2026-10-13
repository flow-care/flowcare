import { Elysia, t } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { authPlugin } from "../../plugins/auth";
import {
  type OrganizationAccess,
  organizationAccessPlugin,
  resolveOrganizationAccess,
} from "../../plugins/organization-access";
import type { WhatsAppProvider } from "../../services/waha-client";
import { Unauthenticated } from "../auth/errors";
import { CommunicationsMessageService } from "./messages-service";
import * as m from "./model";
import { CommunicationsService } from "./service";

export function communicationsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  provider: WhatsAppProvider;
}) {
  const service = new CommunicationsService(deps);
  const messages = new CommunicationsMessageService(deps.prisma);
  return new Elysia({ name: "communications" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
    .model(m.models)
    .group("/organizations/:orgSlug/communications/whatsapp", (group) =>
      group
        .get(
          "/status",
          ({ organizationAccess, set }) => {
            set.headers["cache-control"] = "no-store";
            return service.status(organizationAccess.organizationId);
          },
          {
            params: t.Object({ orgSlug: t.String() }),
            organizationAccess: "communications:read",
            response: { 200: "communications.statusResponse" },
          },
        )
        .post(
          "/reconnect",
          ({ organizationAccess, set }) => {
            set.headers["cache-control"] = "no-store";
            return service.reconnect(organizationAccess.organizationId);
          },
          {
            params: t.Object({ orgSlug: t.String() }),
            organizationAccess: "settings:write",
            response: { 200: "communications.reconnectResponse" },
          },
        ),
    )
    .get(
      "/organizations/:orgSlug/communications/messages",
      async ({ auth, params, query, set }) => {
        if (!auth) throw Unauthenticated();
        set.headers["cache-control"] = "no-store";
        let access: OrganizationAccess;
        try {
          access = await resolveOrganizationAccess(
            deps.prisma,
            auth.userId,
            params.orgSlug,
            "communications:read",
          );
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            error.code !== "PERMISSION_DENIED"
          )
            throw error;
          access = await resolveOrganizationAccess(
            deps.prisma,
            auth.userId,
            params.orgSlug,
            "appointments:read",
          );
        }
        return messages.list(access.organizationId, query);
      },
      {
        params: t.Object({ orgSlug: t.String() }),
        query: m.messageQuery,
        response: { 200: "communications.messageResponse" },
      },
    )
    .patch(
      "/organizations/:orgSlug/patients/:patientId/communication-preferences",
      ({ organizationAccess, auth, params, body }) =>
        messages.preference(
          organizationAccess.organizationId,
          params.patientId,
          auth?.userId ?? "",
          body,
        ),
      {
        params: t.Object({
          orgSlug: t.String(),
          patientId: t.String({ format: "uuid" }),
        }),
        body: m.preferenceBody,
        organizationAccess: "patients:write",
        response: { 200: "communications.preferenceResponse" },
      },
    );
}

export function whatsappWebhookModule(deps: {
  prisma: PrismaClient;
  provider: WhatsAppProvider;
  secret: string | null | undefined;
}) {
  const messages = new CommunicationsMessageService(deps.prisma);
  return new Elysia({ name: "whatsapp-webhook" }).post(
    "/webhooks/whatsapp/status",
    async ({ request, headers, set }) => {
      set.headers["cache-control"] = "no-store";
      return messages.webhook(
        await request.text(),
        headers["x-webhook-hmac"] ?? null,
        headers["x-webhook-request-id"] ?? null,
        headers["x-webhook-timestamp"] ?? null,
        deps.secret,
      );
    },
    {
      headers: t.Object({
        "x-webhook-hmac": t.Optional(t.String()),
        "x-webhook-request-id": t.Optional(t.String()),
        "x-webhook-timestamp": t.Optional(t.String()),
      }),
      response: { 200: t.Object({ accepted: t.Boolean() }) },
    },
  );
}
