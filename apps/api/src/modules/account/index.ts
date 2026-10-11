import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import * as m from "./model";
import { AccountService } from "./service";

export interface AccountModuleDeps {
  prisma: PrismaClient;
  jwtSecret: string;
}

export function accountModule(deps: AccountModuleDeps) {
  const service = new AccountService({ prisma: deps.prisma });

  return new Elysia({ name: "account" })
    .model(m.accountModels)
    .use(authPlugin({ prisma: deps.prisma, jwtSecret: deps.jwtSecret }))
    .post(
      "/me/change-password",
      ({ auth, body }) =>
        service.changePassword(auth.userId, auth.sessionId, body),
      {
        body: m.changePasswordBody,
        response: { 200: m.changePasswordResponse },
      },
    )
    .get(
      "/me/sessions",
      ({ auth }) => service.listSessions(auth.userId, auth.sessionId),
      {
        response: { 200: m.sessionsResponse },
      },
    )
    .delete(
      "/me/sessions/other",
      ({ auth }) => service.revokeOtherSessions(auth.userId, auth.sessionId),
      { response: { 200: m.revokeSessionResponse } },
    )
    .delete(
      "/me/sessions/:sessionId",
      ({ auth, params }) =>
        service.revokeSession(auth.userId, auth.sessionId, params.sessionId),
      {
        params: m.sessionIdParams,
        response: { 200: m.revokeSessionResponse },
      },
    )
    .get("/me/profile", ({ auth }) => service.getProfile(auth.userId), {
      response: { 200: m.profileResponse },
    });
}
