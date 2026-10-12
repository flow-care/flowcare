import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type {
  MembershipRole,
  PrismaClient,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { communicationsModule } from "../src/modules/communications";
import {
  CommunicationsService,
  normalizeWahaStatus,
} from "../src/modules/communications/service";
import { signSessionToken } from "../src/services/session-token";
import type {
  WahaSession,
  WhatsAppProvider,
} from "../src/services/waha-client";

const secret = "communications-test-secret";
const organizationId = "11111111-1111-4111-8111-111111111111";

function providerFixture(initial: WahaSession | null = null) {
  let session = initial;
  const calls: string[] = [];
  const provider: WhatsAppProvider = {
    getSession: async (name) => {
      calls.push(`get:${name}`);
      return session;
    },
    createSession: async (name) => {
      calls.push(`create:${name}`);
      session = { status: "SCAN_QR_CODE", me: null };
      return session;
    },
    restartSession: async (name) => {
      calls.push(`restart:${name}`);
      session = { status: "SCAN_QR_CODE", me: null };
    },
    getQr: async (name) => {
      calls.push(`qr:${name}`);
      return { mimetype: "image/png", data: "private-qr" };
    },
  };
  return { provider, calls };
}

function routeFixture(role: MembershipRole) {
  let binding: { providerSessionName: string } | null = {
    providerSessionName: "private-session",
  };
  const prisma = {
    session: {
      findFirst: async () => ({
        id: "login-session",
        lastActiveAt: new Date(),
      }),
    },
    membership: {
      findFirst: async () => ({
        id: "membership",
        organizationId,
        role,
        status: "ACTIVE",
      }),
    },
    whatsAppSession: {
      findUnique: async () => binding,
      upsert: async ({
        create,
      }: {
        create: { providerSessionName: string };
      }) => {
        binding ??= { providerSessionName: create.providerSessionName };
        return binding;
      },
    },
  } as unknown as PrismaClient;
  const { provider, calls } = providerFixture({
    status: "WORKING",
    me: { id: "5511999998888@c.us" },
  });
  const app = new Elysia()
    .onError(({ error, status }) =>
      error instanceof ApiError
        ? status(error.httpStatus, { error: { code: error.code } })
        : status(500, { error: { code: "INTERNAL" } }),
    )
    .use(communicationsModule({ prisma, jwtSecret: secret, provider }));
  const token = signSessionToken(
    { sid: "login-session", sub: "user" },
    secret,
    60,
  );
  const request = (path: string, method = "GET", authenticated = true) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: authenticated
          ? { authorization: `Bearer ${token}` }
          : undefined,
      }),
    );
  return { request, calls };
}

describe("clinic WhatsApp connection", () => {
  test("normalizes provider states without leaking provider-specific values", () => {
    expect(normalizeWahaStatus("WORKING")).toBe("CONNECTED");
    expect(normalizeWahaStatus("SCAN_QR_CODE")).toBe("QR_CODE_REQUIRED");
    expect(normalizeWahaStatus("STARTING")).toBe("CONNECTING");
    expect(normalizeWahaStatus("STOPPED")).toBe("DISCONNECTED");
    expect(normalizeWahaStatus("FAILED")).toBe("ERROR");
    expect(normalizeWahaStatus("NEW_PROVIDER_STATE")).toBe("ERROR");
  });

  test("creates a clinic-owned provider binding and returns an expiring, unpersisted QR", async () => {
    let binding: { providerSessionName: string } | null = null;
    let createdProviderName: string | null = null;
    const persisted: unknown[] = [];
    const prisma = {
      whatsAppSession: {
        upsert: async ({
          create,
        }: {
          create: { providerSessionName: string };
        }) => {
          persisted.push(create);
          binding = { providerSessionName: create.providerSessionName };
          createdProviderName = create.providerSessionName;
          return binding;
        },
      },
    } as unknown as PrismaClient;
    const { provider, calls } = providerFixture();
    const service = new CommunicationsService({
      prisma,
      provider,
      now: () => new Date("2026-10-11T12:00:00.000Z"),
    });

    const result = await service.reconnect(organizationId);

    expect(result).toEqual({
      status: "QR_CODE_REQUIRED",
      phoneNumber: null,
      qrCode: "data:image/png;base64,private-qr",
      qrExpiresAt: "2026-10-11T12:00:20.000Z",
    });
    expect(persisted).toHaveLength(1);
    expect(JSON.stringify(persisted)).not.toContain("private-qr");
    if (!createdProviderName)
      throw new Error("Expected provider binding to be created");
    const providerName = createdProviderName;
    expect(calls).toEqual([
      `get:${providerName}`,
      `create:${providerName}`,
      `qr:${providerName}`,
    ]);
  });

  test("scopes status to active membership and restricts reconnect to administrators", async () => {
    const receptionist = routeFixture("RECEPTIONIST");
    const read = await receptionist.request(
      "/organizations/clinic-a/communications/whatsapp/status",
    );
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({
      status: "CONNECTED",
      phoneNumber: "5511999998888",
    });
    expect(read.headers.get("cache-control")).toBe("no-store");

    const denied = await receptionist.request(
      "/organizations/clinic-a/communications/whatsapp/reconnect",
      "POST",
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: { code: "PERMISSION_DENIED" },
    });
    expect(receptionist.calls).toEqual(["get:private-session"]);

    const admin = routeFixture("ADMIN");
    const allowed = await admin.request(
      "/organizations/clinic-a/communications/whatsapp/reconnect",
      "POST",
    );
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("cache-control")).toBe("no-store");

    const unauthenticated = await admin.request(
      "/organizations/clinic-a/communications/whatsapp/status",
      "GET",
      false,
    );
    expect(unauthenticated.status).toBe(401);
  });
});
