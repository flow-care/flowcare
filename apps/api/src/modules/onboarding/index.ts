import { Elysia } from "elysia";
import { authPlugin } from "../../plugins/auth";
import * as m from "./model";
import type { OnboardingDeps } from "./service";
import { OnboardingService } from "./service";

/**
 * Controller HTTP do domínio onboarding (Módulo 2 do contrato).
 * #215: progresso; #216: criação da primeira clínica; #218: horários e conclusão.
 * Instância Elysia declarando o que usa: rotas aqui são autenticadas
 * (authPlugin injeta `auth` tipado). Erros de domínio sobem para o
 * onError da aplicação (envelope §2).
 */
export function onboardingModule(deps: OnboardingDeps) {
  const service = new OnboardingService({ prisma: deps.prisma });
  return new Elysia({ name: "onboarding" })
    .use(authPlugin({ prisma: deps.prisma, jwtSecret: deps.jwtSecret }))
    .group("/onboarding", (group) =>
      group
        .get("/progress", ({ auth }) => service.getProgress(auth.userId), {
          response: { 200: m.progressResponse },
        })
        .get("/profile", ({ auth }) => service.getProfile(auth.userId), {
          response: { 200: m.profileResponse },
        })
        .post(
          "/profile",
          ({ auth, body }) => service.saveProfile(auth.userId, body),
          {
            body: m.profileBody,
            response: { 200: m.profileResponse },
          },
        )
        .patch(
          "/profile",
          ({ auth, body }) => service.saveProfileDraft(auth.userId, body),
          {
            body: m.profileDraftBody,
            response: { 200: m.profileResponse },
          },
        )
        .get(
          "/check-slug",
          ({ query }) => service.checkSlugAvailability(query.slug),
          {
            query: m.checkSlugQuery,
            response: { 200: m.slugAvailabilityResponse },
          },
        )
        .post(
          "/organization",
          async ({ auth, body, status }) =>
            status(201, await service.createOrganization(auth.userId, body)),
          {
            body: m.createOrganizationBody,
            response: { 201: m.organizationCreatedResponse },
          },
        )
        .post(
          "/schedule-rules",
          ({ auth, body }) => service.saveScheduleRules(auth.userId, body),
          {
            body: m.scheduleRulesBody,
            response: { 200: m.scheduleRulesResponse },
          },
        )
        .post("/complete", ({ auth }) => service.complete(auth.userId), {
          response: { 200: m.completeResponse },
        }),
    );
}
