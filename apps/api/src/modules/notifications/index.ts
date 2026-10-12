import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import * as m from "./model";
import { NotificationsService } from "./service";

export function notificationsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
}) {
  const service = new NotificationsService(deps.prisma);
  return new Elysia({ name: "notifications" })
    .use(authPlugin(deps))
    .get(
      "/account/notifications/preferences",
      ({ auth }) => service.get(auth.userId),
      {
        response: { 200: m.preferencesResponse },
      },
    )
    .put(
      "/account/notifications/preferences",
      ({ auth, body }) => service.update(auth.userId, body),
      {
        body: m.updatePreferencesBody,
        response: { 200: m.preferencesResponse },
      },
    );
}
