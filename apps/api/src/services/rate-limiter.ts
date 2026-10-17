import { createHmac } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client";

/**
 * Limitador de tentativas por janela fixa, persistido no Postgres (#356).
 *
 * - A chave guardada é HMAC-SHA256 de `escopo + identificador` (IP ou e-mail)
 *   somado ao índice da janela: nenhum IP ou e-mail em texto plano é persistido.
 * - O incremento usa upsert atômico do Prisma (INSERT ... ON CONFLICT), então
 *   requisições concorrentes não ultrapassam o limite por condição de corrida.
 * - Erros de persistência sobem para o chamador, que decide falhar fechado.
 */
export interface RateLimitRule {
  /** Escopo estável, ex.: "login:ip". */
  scope: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  count: number;
}

export interface RateLimiter {
  consume(rule: RateLimitRule, identifier: string): Promise<RateLimitResult>;
  reset(rule: RateLimitRule, identifier: string): Promise<void>;
}

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

function assertValidRule(rule: RateLimitRule): void {
  if (
    !rule.scope.trim() ||
    !Number.isSafeInteger(rule.limit) ||
    rule.limit < 1 ||
    !Number.isSafeInteger(rule.windowSeconds) ||
    rule.windowSeconds < 1
  ) {
    throw new Error("Regra de rate limit inválida.");
  }
}

export function privateIdentifierDigest(
  secret: string,
  scope: string,
  identifier: string,
): string {
  return createHmac("sha256", secret)
    .update(`auth-private-identifier:${scope}:${identifier}`)
    .digest("hex");
}

export function rateLimitKey(
  secret: string,
  rule: RateLimitRule,
  identifier: string,
  now: number,
): { key: string; expiresAt: Date } {
  assertValidRule(rule);
  const windowMs = rule.windowSeconds * 1000;
  const windowIndex = Math.floor(now / windowMs);
  const digest = privateIdentifierDigest(secret, rule.scope, identifier);
  return {
    key: `${rule.scope}:${digest}:${windowIndex}`,
    expiresAt: new Date((windowIndex + 1) * windowMs),
  };
}

export function createPrismaRateLimiter(
  prisma: PrismaClient,
  secret: string,
  clock: () => number = Date.now,
): RateLimiter {
  let lastCleanupAt = 0;

  function cleanupExpired(now: number): void {
    if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
    lastCleanupAt = now;
    void prisma.authRateLimit
      .deleteMany({ where: { expiresAt: { lt: new Date(now) } } })
      .catch(() => {
        console.error("[rate-limit] falha ao remover janelas expiradas");
      });
  }

  return {
    async consume(rule, identifier) {
      const now = clock();
      const { key, expiresAt } = rateLimitKey(secret, rule, identifier, now);
      const bucket = await prisma.authRateLimit.upsert({
        where: { key },
        create: { key, count: 1, expiresAt },
        update: { count: { increment: 1 } },
        select: { count: true },
      });
      cleanupExpired(now);
      return { allowed: bucket.count <= rule.limit, count: bucket.count };
    },

    async reset(rule, identifier) {
      const { key } = rateLimitKey(secret, rule, identifier, clock());
      await prisma.authRateLimit.deleteMany({ where: { key } });
    },
  };
}
