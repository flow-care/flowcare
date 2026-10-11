import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { SessionRevocationAction } from "../src/modules/account/model";
import { signSessionToken } from "../src/services/session-token";

const env: Env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "revocation-test-secret",
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

type Session = {
  id: string;
  userId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  lastActiveAt: Date;
};
type Audit = {
  userId: string;
  actorSessionId: string;
  targetSessionId?: string;
  action: SessionRevocationAction;
  revokedCount: number;
};

function setup() {
  const now = Date.now();
  const expiresAt = new Date(now + 60_000);
  const pastExpiresAt = new Date(now - 60_000);
  const sessions: Session[] = [
    {
      id: "current",
      userId: "a",
      revokedAt: null,
      expiresAt,
      lastActiveAt: new Date(now),
    },
    {
      id: "session-other",
      userId: "a",
      revokedAt: null,
      expiresAt,
      lastActiveAt: new Date(now),
    },
    {
      id: "third",
      userId: "a",
      revokedAt: null,
      expiresAt,
      lastActiveAt: new Date(now),
    },
    {
      id: "expired-owned",
      userId: "a",
      revokedAt: null,
      expiresAt: pastExpiresAt,
      lastActiveAt: new Date(now - 120_000),
    },
    {
      id: "already-revoked",
      userId: "a",
      revokedAt: new Date(now - 10_000),
      expiresAt,
      lastActiveAt: new Date(now - 20_000),
    },
    {
      id: "foreign",
      userId: "b",
      revokedAt: null,
      expiresAt,
      lastActiveAt: new Date(now),
    },
  ];
  const audits: Audit[] = [];
  const prisma = {
    $transaction: async (operation: (tx: PrismaClient) => Promise<unknown>) =>
      operation(prisma as PrismaClient),
    session: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; userId: string };
      }) => {
        const session = sessions.find(
          (s) =>
            s.id === where.id &&
            s.userId === where.userId &&
            !s.revokedAt &&
            s.expiresAt > new Date(),
        );
        return session
          ? { id: session.id, lastActiveAt: session.lastActiveAt }
          : null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id?: string | { not: string }; userId: string };
        data: { revokedAt?: Date };
      }) => {
        let count = 0;
        for (const session of sessions) {
          if (
            session.userId !== where.userId ||
            session.revokedAt ||
            session.expiresAt <= new Date()
          )
            continue;
          if (typeof where.id === "string" && session.id !== where.id) continue;
          if (typeof where.id === "object" && session.id === where.id.not)
            continue;
          session.revokedAt = data.revokedAt ?? null;
          count++;
        }
        return { count };
      },
      findMany: async ({ where }: { where: { userId: string } }) =>
        sessions
          .filter(
            (s) =>
              s.userId === where.userId &&
              !s.revokedAt &&
              s.expiresAt > new Date(),
          )
          .map((s) => ({
            id: s.id,
            ipAddress: null,
            userAgent: null,
            lastActiveAt: s.lastActiveAt,
          })),
    },
    sessionRevocationAudit: {
      create: async ({ data }: { data: Audit }) => {
        audits.push(data);
        return data;
      },
    },
  } as unknown as PrismaClient;
  const app = createApp(env, { prisma, mailer: { send: async () => {} } });
  const token = (sid: string, sub = "a") =>
    signSessionToken({ sid, sub }, env.jwtSecret, 3600);
  const request = (path: string, sid?: string | null, method = "DELETE") =>
    app.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: sid
          ? {
              authorization: `Bearer ${token(sid, sid === "foreign" ? "b" : "a")}`,
            }
          : {},
      }),
    );
  return { sessions, audits, request };
}

describe("#333 session revocation", () => {
  test("rejects unauthenticated requests to revoke single or other sessions with 401 UNAUTHENTICATED", async () => {
    const { request, audits } = setup();

    const singleRes = await request("/me/sessions/session-other", null);
    expect(singleRes.status).toBe(401);
    expect(
      ((await singleRes.json()) as { error: { code: string } }).error.code,
    ).toBe("UNAUTHENTICATED");

    const otherRes = await request("/me/sessions/other", null);
    expect(otherRes.status).toBe(401);
    expect(
      ((await otherRes.json()) as { error: { code: string } }).error.code,
    ).toBe("UNAUTHENTICATED");

    expect(audits).toHaveLength(0);
  });

  test("revokes one owned session, audits it, removes it from active list, and rejects its token on next request", async () => {
    const { request, sessions, audits } = setup();
    const response = await request("/me/sessions/session-other", "current");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revokedCount: 1 });
    expect(
      sessions.find((s) => s.id === "session-other")?.revokedAt,
    ).toBeInstanceOf(Date);
    expect(audits).toEqual([
      {
        userId: "a",
        actorSessionId: "current",
        targetSessionId: "session-other",
        action: "SINGLE",
        revokedCount: 1,
      },
    ]);
    expect((await request("/me/profile", "session-other", "GET")).status).toBe(
      401,
    );
    const listRes = await request("/me/sessions", "current", "GET");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      sessions: Array<{ id: string }>;
    };
    expect(listBody.sessions.map((s) => s.id)).toEqual(["current", "third"]);
  });

  test("cannot revoke an already-revoked, expired, or non-existent session and does not write duplicate audit logs", async () => {
    const { request, audits } = setup();

    const firstRevoke = await request("/me/sessions/session-other", "current");
    expect(firstRevoke.status).toBe(200);
    expect(audits).toHaveLength(1);

    const duplicateRevoke = await request(
      "/me/sessions/session-other",
      "current",
    );
    expect(duplicateRevoke.status).toBe(404);
    expect(
      ((await duplicateRevoke.json()) as { error: { code: string } }).error
        .code,
    ).toBe("NOT_FOUND");

    const preRevokedRes = await request(
      "/me/sessions/already-revoked",
      "current",
    );
    expect(preRevokedRes.status).toBe(404);

    const expiredRes = await request("/me/sessions/expired-owned", "current");
    expect(expiredRes.status).toBe(404);

    const missingRes = await request("/me/sessions/non-existent", "current");
    expect(missingRes.status).toBe(404);

    expect(audits).toHaveLength(1);
  });

  test("cannot revoke a different account's session or audit a failed attempt", async () => {
    const { request, sessions, audits } = setup();
    const response = await request("/me/sessions/foreign", "current");
    expect(response.status).toBe(404);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe("NOT_FOUND");
    expect(sessions.find((s) => s.id === "foreign")?.revokedAt).toBeNull();
    expect(audits).toHaveLength(0);
  });

  test("rejects blank or overly long sessionId parameters with 400 VALIDATION_ERROR without auditing", async () => {
    const { request, audits } = setup();

    const whitespaceRes = await request("/me/sessions/%20%20%20", "current");
    expect(whitespaceRes.status).toBe(400);
    expect(
      ((await whitespaceRes.json()) as { error: { code: string } }).error.code,
    ).toBe("VALIDATION_ERROR");

    const tooLongRes = await request(
      `/me/sessions/${"x".repeat(201)}`,
      "current",
    );
    expect(tooLongRes.status).toBe(400);
    expect(
      ((await tooLongRes.json()) as { error: { code: string } }).error.code,
    ).toBe("VALIDATION_ERROR");

    expect(audits).toHaveLength(0);
  });

  test("revokes all other active sessions, keeps current and foreign sessions active, and audits count", async () => {
    const { request, sessions, audits } = setup();
    const response = await request("/me/sessions/other", "current");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revokedCount: 2 });
    expect(sessions.find((s) => s.id === "current")?.revokedAt).toBeNull();
    expect(sessions.find((s) => s.id === "foreign")?.revokedAt).toBeNull();
    expect(
      sessions.find((s) => s.id === "expired-owned")?.revokedAt,
    ).toBeNull();
    expect(audits).toEqual([
      {
        userId: "a",
        actorSessionId: "current",
        action: "OTHER",
        revokedCount: 2,
      },
    ]);
    expect((await request("/me/sessions", "session-other", "GET")).status).toBe(
      401,
    );
    expect((await request("/me/sessions", "current", "GET")).status).toBe(200);

    const secondResponse = await request("/me/sessions/other", "current");
    expect(secondResponse.status).toBe(200);
    expect(await secondResponse.json()).toEqual({ revokedCount: 0 });
    expect(audits).toHaveLength(2);
    expect(audits[1]).toEqual({
      userId: "a",
      actorSessionId: "current",
      action: "OTHER",
      revokedCount: 0,
    });
  });

  test("revoking current session audits the action and invalidates its own token", async () => {
    const { request, audits } = setup();
    const revokeRes = await request("/me/sessions/current", "current");
    expect(revokeRes.status).toBe(200);
    expect(await revokeRes.json()).toEqual({ revokedCount: 1 });
    expect(audits).toEqual([
      {
        userId: "a",
        actorSessionId: "current",
        targetSessionId: "current",
        action: "SINGLE",
        revokedCount: 1,
      },
    ]);
    expect((await request("/me/sessions", "current", "GET")).status).toBe(401);
  });
});
