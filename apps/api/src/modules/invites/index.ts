import { Elysia, t } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import type { Mailer } from "../../services/mailer";
import * as m from "./model";
import { InviteService } from "./service";

export function inviteModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  mailer: Mailer;
  webAppUrl: string;
}) {
  const service = new InviteService(deps);
  return new Elysia({ name: "invites" })
    .get("/invites/:token", ({ params }) => service.getDetails(params.token), {
      params: t.Object({ token: t.String({ minLength: 20 }) }),
      response: { 200: m.inviteDetailsResponse },
    })
    .use(authPlugin({ prisma: deps.prisma, jwtSecret: deps.jwtSecret }))
    .use(organizationAccessPlugin(deps))
    .post(
      "/organizations/:orgSlug/invites",
      async ({ auth, params, body, status }) =>
        status(201, await service.create(auth.userId, params.orgSlug, body)),
      {
        params: t.Object({ orgSlug: t.String() }),
        body: m.createInviteBody,
        organizationAccess: "team:invite",
        response: { 201: m.inviteResponse },
      },
    )
    .post(
      "/invites/:token/accept",
      ({ auth, params }) => service.accept(auth.userId, params.token),
      {
        params: t.Object({ token: t.String({ minLength: 20 }) }),
        response: { 200: m.acceptResponse },
      },
    )
    .delete(
      "/organizations/:orgSlug/invites/:inviteId",
      ({ auth, params }) =>
        service.revoke(auth.userId, params.orgSlug, params.inviteId),
      {
        params: t.Object({ orgSlug: t.String(), inviteId: t.String() }),
        organizationAccess: "team:manage",
      },
    )
    .post(
      "/organizations/:orgSlug/invites/:inviteId/resend",
      ({ auth, params }) =>
        service.resend(auth.userId, params.orgSlug, params.inviteId),
      {
        params: t.Object({ orgSlug: t.String(), inviteId: t.String() }),
        organizationAccess: "team:invite",
        response: { 200: m.inviteResponse },
      },
    );
}
