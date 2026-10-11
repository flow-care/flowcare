import cors from "@elysiajs/cors";
import { Elysia, t } from "elysia";
import type { Env } from "./config/env";
import type { PrismaClient } from "./generated/prisma/client";
import { ApiError } from "./lib/api-error";
import { accountModule } from "./modules/account";
import { authModule } from "./modules/auth";
import type { AuthDeps } from "./modules/auth/service";
import { inviteModule } from "./modules/invites";
import { onboardingModule } from "./modules/onboarding";
import type { OnboardingDeps } from "./modules/onboarding/service";
import { organizationsModule } from "./modules/organizations";
import { storageModule } from "./modules/storage";
import { createSesWebhook } from "./modules/webhooks/ses";
import { requestLogger } from "./plugins/request-logger";
import type { Mailer } from "./services/mailer";

/**
 * Aplicação Elysia — montada via `createApp(env, deps)` para manter o app
 * desacoplado do processo (testável com outro banco/mailer, sem estado global).
 *
 * Convenções do contrato (docs/API_CONTRACT.md):
 * - §1: todo erro responde o envelope { error: { code, message } }
 * - §12: GET /health → { status, version, db, waha }
 * - Rotas de negócio entram por módulo em src/modules/<dominio>
 */
export interface AppDeps {
  prisma: PrismaClient;
  mailer: Mailer;
}

const WAHA_PROBE_TIMEOUT_MS = 1500;

async function probeWaha(env: Env): Promise<"ok" | "down"> {
  try {
    const headers: Record<string, string> = {};
    if (env.wahaApiKey) headers["x-api-key"] = env.wahaApiKey;
    const res = await fetch(`${env.wahaBaseUrl}/ping`, {
      headers,
      signal: AbortSignal.timeout(WAHA_PROBE_TIMEOUT_MS),
    });
    return res.ok ? "ok" : "down";
  } catch {
    return "down";
  }
}

async function probeDb(prisma: PrismaClient): Promise<"ok" | "down"> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return "ok";
  } catch {
    return "down";
  }
}

export function createApp(env: Env, deps: AppDeps) {
  const authDeps: AuthDeps = {
    prisma: deps.prisma,
    mailer: deps.mailer,
    config: {
      jwtSecret: env.jwtSecret,
      // TTL finito (#192 proíbe sessão sem expiração); MVP: 12h de sessão de trabalho.
      sessionTtlSeconds: 12 * 3600,
      emailVerificationTtlHours: 24,
      passwordResetTtlMinutes: 30,
      verificationResendPerHour: 3,
      webAppUrl: env.webAppUrl,
      trustProxy: env.trustProxy,
    },
  };
  const onboardingDeps: OnboardingDeps = {
    prisma: deps.prisma,
    jwtSecret: env.jwtSecret,
  };

  const app = new Elysia({ prefix: "/api" })
    .use(requestLogger)
    .use(createSesWebhook(env.snsTopicArn ?? null))
    .use(
      cors({
        origin: env.corsOrigin.split(",").map((o) => o.trim()),
        // credenciais não são usadas: auth é via header Bearer (§0)
      }),
    )
    .get(
      "/health",
      async () => ({
        status: "ok",
        version: env.version,
        db: await probeDb(deps.prisma),
        waha: await probeWaha(env),
      }),
      {
        response: t.Object({
          status: t.String(),
          version: t.String(),
          db: t.String(),
          waha: t.Union([t.Literal("ok"), t.Literal("down")]),
        }),
      },
    )
    .onError(({ code, error, status }) => {
      // Erros de domínio (ApiError) → envelope §2, num ponto único de tradução.
      // Registrado ANTES dos módulos: eventos do Elysia valem para rotas
      // registradas depois deste hook.
      if (error instanceof ApiError) {
        return status(error.httpStatus, {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        });
      }
      // §1 do contrato — envelope { error: { code, message } }, stack nunca vaza
      switch (code) {
        case "NOT_FOUND":
          return status(404, {
            error: { code: "NOT_FOUND", message: "Recurso não encontrado." },
          });
        case "VALIDATION":
        case "PARSE": {
          const path =
            code === "VALIDATION" && error.type === "body"
              ? error.all.find((issue) =>
                  /^\/[A-Za-z][A-Za-z0-9]*$/.test(issue.path),
                )?.path
              : undefined;
          const field = path?.slice(1);
          return status(400, {
            error: {
              code: "VALIDATION_ERROR",
              message: "Dados inválidos.",
              ...(field ? { details: { field } } : {}),
            },
          });
        }
        default:
          return status(500, {
            error: {
              code: "INTERNAL",
              message: "Erro interno. Tente novamente.",
            },
          });
      }
    })
    .use(authModule(authDeps))
    .use(onboardingModule(onboardingDeps))
    .use(organizationsModule({ prisma: deps.prisma, jwtSecret: env.jwtSecret }))
    .use(accountModule({ prisma: deps.prisma, jwtSecret: env.jwtSecret }))
    .use(
      inviteModule({
        prisma: deps.prisma,
        jwtSecret: env.jwtSecret,
        mailer: deps.mailer,
        webAppUrl: env.webAppUrl,
      }),
    )
    .use(
      storageModule({
        prisma: deps.prisma,
        jwtSecret: env.jwtSecret,
        config: {
          endpoint: env.storageEndpoint ?? null,
          bucket: env.storageBucket ?? null,
          region: env.storageRegion ?? "auto",
          accessKeyId: env.storageAccessKeyId ?? null,
          secretAccessKey: env.storageSecretAccessKey ?? null,
        },
      }),
    );

  return app;
}
