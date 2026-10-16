import { Elysia, t } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import type { WhatsAppProvider } from "../../services/waha-client";
import { Unauthenticated } from "../auth/errors";
import * as m from "./model";
import { CommunicationsService } from "./service";

export function communicationsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  provider: WhatsAppProvider;
}) {
  const service = new CommunicationsService(deps);
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
        )
        .get(
          "/templates",
          ({ organizationAccess, set }) => {
            set.headers["cache-control"] = "no-store";
            return service.listTemplates(organizationAccess.organizationId);
          },
          {
            params: t.Object({ orgSlug: t.String() }),
            organizationAccess: "settings:read",
            response: {
              200: "communications.whatsappTemplatesResponse",
            },
          },
        )
        .post(
          "/templates/:type/preview",
          ({ body, params, set }) => {
            set.headers["cache-control"] = "no-store";
            return service.previewTemplate(params.type, body.content);
          },
          {
            params: m.whatsappTemplateParams,
            body: m.previewWhatsappTemplateBody,
            organizationAccess: "settings:write",
            response: {
              200: "communications.whatsappTemplatePreviewResponse",
            },
          },
        )
        .get(
          "/templates/:type/versions",
          ({ organizationAccess, params, set }) => {
            set.headers["cache-control"] = "no-store";
            return service.listTemplateVersions(
              organizationAccess.organizationId,
              params.type,
            );
          },
          {
            params: m.whatsappTemplateParams,
            organizationAccess: "settings:read",
            response: {
              200: "communications.whatsappTemplateVersionsResponse",
            },
          },
        )
        .get(
          "/templates/:type/versions/:version",
          ({ organizationAccess, params, set }) => {
            set.headers["cache-control"] = "no-store";
            return service.getTemplateVersion(
              organizationAccess.organizationId,
              params.type,
              params.version,
            );
          },
          {
            params: m.whatsappTemplateVersionParams,
            organizationAccess: "settings:read",
            response: {
              200: m.whatsappTemplateVersionItem,
            },
          },
        )
        .put(
          "/templates/:type",
          ({ auth, organizationAccess, params, body, set }) => {
            if (!auth) throw Unauthenticated();
            set.headers["cache-control"] = "no-store";
            return service.saveTemplate(
              organizationAccess.organizationId,
              auth.userId,
              params.type,
              body,
            );
          },
          {
            params: m.whatsappTemplateParams,
            body: m.saveWhatsappTemplateBody,
            organizationAccess: "settings:write",
            response: {
              200: "communications.whatsappTemplateItem",
            },
          },
        ),
    );
}
