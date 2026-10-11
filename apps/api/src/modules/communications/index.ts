import { Elysia, t } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import type { WhatsAppProvider } from "../../services/waha-client";
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
        ),
    );
}
