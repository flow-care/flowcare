import { expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  createPrismaRateLimiter,
  type RateLimitRule,
  rateLimitKey,
} from "../src/services/rate-limiter";

const rule: RateLimitRule = {
  scope: "login:account",
  limit: 2,
  windowSeconds: 60,
};

function fakePrisma() {
  const buckets = new Map<
    string,
    { key: string; count: number; expiresAt: Date }
  >();
  const prisma = {
    authRateLimit: {
      upsert: async (args: {
        where: { key: string };
        create: { key: string; count: number; expiresAt: Date };
      }) => {
        const current = buckets.get(args.where.key);
        if (current) {
          current.count += 1;
          return { count: current.count };
        }
        buckets.set(args.create.key, { ...args.create });
        return { count: args.create.count };
      },
      deleteMany: async (args: {
        where: { key?: string; expiresAt?: { lt: Date } };
      }) => {
        let count = 0;
        for (const [key, bucket] of buckets) {
          if (
            key === args.where.key ||
            (args.where.expiresAt && bucket.expiresAt < args.where.expiresAt.lt)
          ) {
            buckets.delete(key);
            count += 1;
          }
        }
        return { count };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, buckets };
}

test("chave do rate limit pseudonimiza o identificador e separa janelas", () => {
  const identifier = "pessoa@example.com";
  const first = rateLimitKey("secret", rule, identifier, 1_000);
  const next = rateLimitKey("secret", rule, identifier, 61_000);

  expect(first.key).not.toContain(identifier);
  expect(first.key).not.toBe(next.key);
  expect(first.expiresAt).toEqual(new Date(60_000));
  expect(next.expiresAt).toEqual(new Date(120_000));
});

test("incremento compartilhado bloqueia acima do limite e reset libera a conta", async () => {
  const { prisma, buckets } = fakePrisma();
  const limiter = createPrismaRateLimiter(prisma, "secret", () => 1_000);

  const results = await Promise.all([
    limiter.consume(rule, "pessoa@example.com"),
    limiter.consume(rule, "pessoa@example.com"),
    limiter.consume(rule, "pessoa@example.com"),
  ]);

  expect(results.map((result) => result.allowed)).toEqual([true, true, false]);
  expect(buckets.size).toBe(1);
  await limiter.reset(rule, "pessoa@example.com");
  expect((await limiter.consume(rule, "pessoa@example.com")).allowed).toBe(
    true,
  );
});

test("falha de persistência do limitador é propagada", async () => {
  const prisma = {
    authRateLimit: {
      upsert: async () => {
        throw new Error("database unavailable");
      },
    },
  } as unknown as PrismaClient;
  const limiter = createPrismaRateLimiter(prisma, "secret", () => 1_000);

  await expect(limiter.consume(rule, "pessoa@example.com")).rejects.toThrow(
    "database unavailable",
  );
});

test("regras inválidas falham antes de tocar no banco", () => {
  expect(() =>
    rateLimitKey(
      "secret",
      { scope: "login", limit: 0, windowSeconds: 60 },
      "identifier",
      0,
    ),
  ).toThrow("Regra de rate limit inválida");
});
