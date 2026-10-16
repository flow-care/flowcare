import { Elysia } from "elysia";
import { sessionMetadataFromRequest } from "../../lib/session-metadata";
import * as m from "./model";
import type { AuthDeps } from "./service";
import { AuthService } from "./service";

/**
 * Controller HTTP do domínio auth (Módulo 1 do contrato).
 * Handlers curtos: extraem valores do request e delegam ao service.
 * Rotas públicas; erros de domínio sobem para o onError da aplicação.
 */
export function authModule(deps: AuthDeps) {
  const service = new AuthService(deps);

  return new Elysia({ name: "auth" }).group("/auth", (group) =>
    group
      .post(
        "/register",
        async ({ body, request, server, status }) =>
          status(
            201,
            await service.register(
              body,
              sessionMetadataFromRequest({
                request,
                peerAddress: server?.requestIP(request)?.address ?? null,
                trustProxy: deps.config.trustProxy,
              }),
            ),
          ),
        {
          body: m.registerBody,
          response: { 201: m.messageResponse },
        },
      )
      .post(
        "/verify-email",
        ({ body, request, server }) =>
          service.verifyEmail(
            body.token,
            sessionMetadataFromRequest({
              request,
              peerAddress: server?.requestIP(request)?.address ?? null,
              trustProxy: deps.config.trustProxy,
            }),
          ),
        { body: m.verifyEmailBody, response: { 200: m.loginResponse } },
      )
      .post(
        "/resend-verification",
        ({ body, request, server }) =>
          service.resendVerification(
            body.email,
            sessionMetadataFromRequest({
              request,
              peerAddress: server?.requestIP(request)?.address ?? null,
              trustProxy: deps.config.trustProxy,
            }),
          ),
        {
          body: m.resendVerificationBody,
          response: { 200: m.messageResponse },
        },
      )
      .post(
        "/login",
        ({ body, request, server }) =>
          service.login(
            body,
            sessionMetadataFromRequest({
              request,
              peerAddress: server?.requestIP(request)?.address ?? null,
              trustProxy: deps.config.trustProxy,
            }),
          ),
        {
          body: m.loginBody,
          response: { 200: m.loginResponse },
        },
      )
      .post(
        "/forgot-password",
        ({ body, request, server }) =>
          service.forgotPassword(
            body,
            sessionMetadataFromRequest({
              request,
              peerAddress: server?.requestIP(request)?.address ?? null,
              trustProxy: deps.config.trustProxy,
            }),
          ),
        {
          body: m.forgotPasswordBody,
          response: { 200: m.messageResponse },
        },
      )
      .post(
        "/reset-password",
        ({ body, request, server }) =>
          service.resetPassword(
            body,
            sessionMetadataFromRequest({
              request,
              peerAddress: server?.requestIP(request)?.address ?? null,
              trustProxy: deps.config.trustProxy,
            }),
          ),
        {
          body: m.resetPasswordBody,
          response: { 200: m.messageResponse },
        },
      ),
  );
}
