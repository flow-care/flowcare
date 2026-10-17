import { expect, mock, test } from "bun:test";
import { hash } from "argon2";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import {
  sessionMetadataFromRequest,
  summarizeUserAgent,
} from "../src/lib/session-metadata";

const testEnv: Env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "session-metadata-test-secret",
  databaseUrl: "postgresql://unused",
  corsOrigin: "http://localhost:3000",
  trustProxy: true,
  wahaBaseUrl: "http://127.0.0.1:1",
  wahaApiKey: null,
  webAppUrl: "http://localhost:3000",
  sesRegion: null,
  mailProvider: "disabled",
  mailFrom: null,
};

test("ignora X-Forwarded-For quando o proxy não é confiável", () => {
  const request = new Request("http://localhost", {
    headers: { "x-forwarded-for": "198.51.100.20" },
  });

  expect(
    sessionMetadataFromRequest({
      request,
      peerAddress: "203.0.113.10",
      trustProxy: false,
    }).ipAddress,
  ).toBe("203.0.113.10");
});

test("mantém metadado de navegador já normalizado", () => {
  expect(summarizeUserAgent("Chrome/Windows")).toBe("Chrome/Windows");
});

test("login persiste IP validado e navegador sem versão ou modelo", async () => {
  const password = "SenhaSegura123";
  const passwordHash = await hash(password);
  const createSession = mock(async ({ data }: Prisma.SessionCreateArgs) => ({
    id: "session-current",
    ...data,
  }));
  const prisma = {
    user: {
      findUnique: async () => ({
        id: "user-a",
        email: "user@example.com",
        fullName: "User Example",
        passwordHash,
        emailVerified: true,
        memberships: [],
        onboarding: null,
      }),
    },
    session: { create: createSession },
  } as unknown as PrismaClient;
  const app = createApp(testEnv, {
    prisma,
    mailer: { send: async () => {} },
    authRateLimiter: {
      consume: async () => ({ allowed: true, count: 1 }),
      reset: async () => {},
    },
  });

  const response = await app.handle(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
        "x-forwarded-for": "192.0.2.1, 203.0.113.25",
      },
      body: JSON.stringify({ email: "user@example.com", password }),
    }),
  );

  expect(response.status).toBe(200);
  expect(createSession).toHaveBeenCalledTimes(1);
  const data = createSession.mock.calls[0]?.[0].data;
  expect(data?.ipAddress).toBe("203.0.113.25");
  expect(data?.userAgent).toBe("Chrome/Windows");
  expect(JSON.stringify(data)).not.toContain("120.0.0.0");
  expect(JSON.stringify(data)).not.toContain("Win64");
});
