import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import type { ProfilePhotoStore } from "../../services/profile-photo-store";
import * as m from "./model";
import { AccountService } from "./service";

export interface AccountModuleDeps {
  prisma: PrismaClient;
  jwtSecret: string;
  photoStore?: ProfilePhotoStore | null;
}

export function accountModule(deps: AccountModuleDeps) {
  const service = new AccountService({
    prisma: deps.prisma,
    photoStore: deps.photoStore,
  });

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
    })
    .patch(
      "/account/active-organization",
      ({ auth, body }) => service.setActiveOrganization(auth.userId, body),
      {
        body: m.activeOrganizationBody,
        response: { 200: m.activeOrganizationResponse },
      },
    )
    .patch(
      "/me/profile",
      ({ auth, body }) => service.updateProfile(auth.userId, body),
      {
        body: m.updateProfileBody,
        response: { 200: m.profileResponse },
      },
    )
    .post(
      "/me/profile/photo",
      ({ auth, body }) => service.uploadPhoto(auth.userId, body.file),
      {
        body: m.profilePhotoBody,
        response: { 200: m.profileResponse },
      },
    )
    .get(
      "/me/profile/photo/download-url",
      ({ auth }) => service.getPhotoUrl(auth.userId),
      {
        response: { 200: m.profilePhotoUrlResponse },
      },
    );
}
