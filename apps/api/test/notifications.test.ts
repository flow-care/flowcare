import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { PrismaClient } from "../src/generated/prisma/client";
import { signSessionToken } from "../src/services/session-token";

const env: Env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "notification-test-secret",
  databaseUrl: "postgresql://unused",
  corsOrigin: "http://localhost:3000",
  trustProxy: false,
  wahaBaseUrl: "http://127.0.0.1:1",
  wahaApiKey: null,
  webAppUrl: "http://localhost:3000",
  sesRegion: null,
  mailProvider: "disabled",
  mailFrom: null,
};

function setup() {
  const saved = new Map<string, boolean>();
  const prisma = {
    session: {
      findFirst: async ({ where }: { where: { userId: string } }) => ({
        id: `session-${where.userId}`,
        lastActiveAt: new Date(),
      }),
    },
    userNotificationPreference: {
      findMany: async ({ where }: { where: { userId: string } }) =>
        saved.has(where.userId)
          ? [
              {
                event: "ACCOUNT_SECURITY",
                channel: "EMAIL",
                enabled: saved.get(where.userId),
              },
            ]
          : [],
      upsert: async ({
        where,
      }: {
        where: { userId_event_channel: { userId: string } };
      }) => {
        saved.set(where.userId_event_channel.userId, true);
      },
    },
  } as unknown as PrismaClient;
  const app = createApp(env, { prisma, mailer: { send: async () => {} } });
  const request = (userId: string, method: string, body?: unknown) =>
    app.handle(
      new Request("http://localhost/api/account/notifications/preferences", {
        method,
        headers: {
          authorization: `Bearer ${signSessionToken({ sub: userId, sid: `session-${userId}` }, env.jwtSecret, 3600)}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  return { saved, request };
}

describe("notification preferences", () => {
  test("lists only available channel and persists on the authenticated account", async () => {
    const { saved, request } = setup();
    const initial = await request("user-a", "GET");
    expect(initial.status).toBe(200);
    expect(await initial.json()).toEqual({
      preferences: [
        {
          event: "ACCOUNT_SECURITY",
          channel: "EMAIL",
          enabled: true,
          required: true,
        },
      ],
    });
    const updated = await request("user-a", "PUT", {
      preferences: [
        { event: "ACCOUNT_SECURITY", channel: "EMAIL", enabled: true },
      ],
    });
    expect(updated.status).toBe(200);
    expect(saved.get("user-a")).toBe(true);
    expect(saved.has("user-b")).toBe(false);
    expect(await (await request("user-a", "GET")).json()).toEqual({
      preferences: [
        {
          event: "ACCOUNT_SECURITY",
          channel: "EMAIL",
          enabled: true,
          required: true,
        },
      ],
    });
  });

  test("rejects unavailable channels and disabling required email", async () => {
    const { saved, request } = setup();
    const unknown = await request("user-a", "PUT", {
      preferences: [
        { event: "ACCOUNT_SECURITY", channel: "WHATSAPP", enabled: true },
      ],
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Combinação de evento e canal indisponível.",
      },
    });
    const required = await request("user-a", "PUT", {
      preferences: [
        { event: "ACCOUNT_SECURITY", channel: "EMAIL", enabled: false },
      ],
    });
    expect(required.status).toBe(400);
    expect(await required.json()).toEqual({
      error: {
        code: "REQUIRED_NOTIFICATION",
        message: "Notificações de segurança não podem ser desativadas.",
      },
    });
    expect(saved.size).toBe(0);
  });
});
