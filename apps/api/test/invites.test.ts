import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { PrismaClient } from "../src/generated/prisma/client";
import { hashToken } from "../src/lib/tokens";
import { InviteService } from "../src/modules/invites/service";
import { signSessionToken } from "../src/services/session-token";

const token = "test_invite_token_123456789012345";
const tokenHash = hashToken(token);
const now = new Date();
const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
const past = new Date(now.getTime() - 1000);

describe("Módulo de convites (Issue #213)", () => {
  test("create rejects an email that already belongs to the clinic", async () => {
    let inviteCreated = false;
    const prisma = {
      membership: {
        findFirst: async ({
          where,
        }: {
          where: { userId?: string; user?: { email: string } };
        }) => {
          if (where.userId)
            return { organization: { id: "org-1", name: "Clínica" } };
          expect(where.user?.email).toBe("pessoa@exemplo.com");
          return { id: "member-1" };
        },
      },
      organizationInvite: {
        create: async () => {
          inviteCreated = true;
        },
      },
    } as unknown as PrismaClient;
    const service = new InviteService({
      prisma,
      mailer: {} as never,
      webAppUrl: "",
    });
    await expect(
      service.create("admin-1", "clinica", {
        email: " Pessoa@Exemplo.com ",
        role: "PROFESSIONAL",
      }),
    ).rejects.toMatchObject({ code: "ALREADY_EXISTS", httpStatus: 409 });
    expect(inviteCreated).toBe(false);
  });

  test("list retorna só convites pendentes da clínica autorizada sem expor tokens", async () => {
    let queriedOrganization: string | undefined;
    const prisma = {
      membership: {
        findFirst: async () => ({
          organization: { id: "org-1", name: "Clínica" },
        }),
      },
      organizationInvite: {
        findMany: async ({ where }: { where: { organizationId: string } }) => {
          queriedOrganization = where.organizationId;
          return [
            {
              id: "inv-1",
              email: "pessoa@exemplo.com",
              role: "PROFESSIONAL",
              expiresAt: future,
              tokenHash: "secret",
            },
          ];
        },
      },
    } as unknown as PrismaClient;
    const service = new InviteService({
      prisma,
      mailer: {} as never,
      webAppUrl: "http://localhost:3000",
    });
    const result = await service.list("admin-1", "clinica");
    expect(queriedOrganization).toBe("org-1");
    expect(result.data).toEqual([
      {
        id: "inv-1",
        email: "pessoa@exemplo.com",
        role: "PROFESSIONAL",
        expiresAt: future.toISOString(),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("resend informa falha de entrega para permitir nova tentativa", async () => {
    const prisma = {
      membership: {
        findFirst: async ({ where }: any) =>
          where.user
            ? null
            : {
                organization: { id: "org-1", name: "Clínica" },
              },
      },
      organizationInvite: {
        findFirst: async () => ({
          id: "inv-1",
          email: "pessoa@exemplo.com",
          expiresAt: future,
        }),
        updateMany: async () => ({ count: 1 }),
        findUniqueOrThrow: async () => ({
          id: "inv-1",
          email: "pessoa@exemplo.com",
          expiresAt: future,
        }),
      },
    } as unknown as PrismaClient;
    const service = new InviteService({
      prisma,
      mailer: {
        send: async () => {
          throw new Error("SES indisponível");
        },
      },
      webAppUrl: "http://localhost:3000",
    });
    await expect(
      service.resend("admin-1", "clinica", "inv-1"),
    ).rejects.toMatchObject({
      code: "EMAIL_DELIVERY_FAILED",
      httpStatus: 503,
    });
  });

  test("resend renews an expired invite and invalidates its old token", async () => {
    const oldHash = hashToken("old-token");
    let storedHash = oldHash;
    let expiresAt = past;
    let sentToken = "";
    const prisma = {
      membership: {
        findFirst: async ({ where }: any) =>
          where.user
            ? null
            : { organization: { id: "org-1", name: "Clínica" } },
      },
      organizationInvite: {
        findFirst: async () => ({
          id: "inv-1",
          email: "pessoa@exemplo.com",
          tokenHash: oldHash,
          expiresAt: past,
        }),
        updateMany: async ({ where, data }: any) => {
          expect(where.organizationId).toBe("org-1");
          expect(where.tokenHash).toBe(oldHash);
          storedHash = data.tokenHash;
          expiresAt = data.expiresAt;
          return { count: 1 };
        },
        findUniqueOrThrow: async () => ({
          id: "inv-1",
          email: "pessoa@exemplo.com",
          expiresAt,
        }),
        findUnique: async ({ where }: any) =>
          where.tokenHash === storedHash
            ? {
                email: "pessoa@exemplo.com",
                role: "PROFESSIONAL",
                expiresAt,
                revokedAt: null,
                acceptedAt: null,
                organization: { name: "Clínica", slug: "clinica", owner: null },
              }
            : null,
      },
    } as unknown as PrismaClient;
    const service = new InviteService({
      prisma,
      mailer: {
        send: async ({ text }: any) => {
          sentToken = text.split("/accept-invite/")[1];
        },
      },
      webAppUrl: "http://localhost:3000",
    });
    const result = await service.resend("admin-1", "clinica", "inv-1");
    expect(storedHash).toBe(hashToken(sentToken));
    expect(storedHash).not.toBe(oldHash);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 6 * 24 * 60 * 60 * 1000,
    );
    await expect(service.getDetails("old-token")).rejects.toMatchObject({
      code: "INVITE_EXPIRED",
    });
  });

  test("revoke rejects an invite outside the clinic and does not change it", async () => {
    let scopedOrganization = "";
    const prisma = {
      membership: {
        findFirst: async () => ({ organization: { id: "org-1" } }),
      },
      organizationInvite: {
        updateMany: async ({ where }: any) => {
          scopedOrganization = where.organizationId;
          return { count: 0 };
        },
      },
    } as unknown as PrismaClient;
    const service = new InviteService({
      prisma,
      mailer: {} as never,
      webAppUrl: "",
    });
    await expect(
      service.revoke("admin-1", "clinica", "other-invite"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
    expect(scopedOrganization).toBe("org-1");
  });

  test("getDetails retorna dados da clínica para convite ativo", async () => {
    const prisma = {
      organizationInvite: {
        findUnique: async ({ where }: { where: { tokenHash: string } }) => {
          if (where.tokenHash === tokenHash) {
            return {
              id: "inv-1",
              email: "medico@exemplo.com",
              role: "PROFESSIONAL",
              expiresAt: future,
              revokedAt: null,
              acceptedAt: null,
              organization: {
                name: "Clínica Vida",
                slug: "clinica-vida",
              },
            };
          }
          return null;
        },
      },
    } as unknown as PrismaClient;

    const service = new InviteService({
      prisma,
      mailer: { send: async () => ({ messageId: "1" }) } as any,
      webAppUrl: "http://localhost:3000",
    });

    const details = await service.getDetails(token);
    expect(details.organizationName).toBe("Clínica Vida");
    expect(details.organizationSlug).toBe("clinica-vida");
    expect(details.email).toBe("medico@exemplo.com");
    expect(details.role).toBe("PROFESSIONAL");
    expect(details.expiresAt).toBe(future.toISOString());
  });

  test("getDetails recusa token expirado com 410 INVITE_EXPIRED", async () => {
    const prisma = {
      organizationInvite: {
        findUnique: async () => ({
          id: "inv-1",
          email: "medico@exemplo.com",
          role: "PROFESSIONAL",
          expiresAt: past,
          revokedAt: null,
          acceptedAt: null,
          organization: { name: "Clínica", slug: "clinica" },
        }),
      },
    } as unknown as PrismaClient;

    const service = new InviteService({
      prisma,
      mailer: {} as any,
      webAppUrl: "http://localhost:3000",
    });

    try {
      await service.getDetails(token);
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe("INVITE_EXPIRED");
      expect(err.httpStatus).toBe(410);
    }
  });

  test("getDetails recusa token revogado ou já aceito com 410", async () => {
    const prismaRevoked = {
      organizationInvite: {
        findUnique: async () => ({
          id: "inv-1",
          email: "medico@exemplo.com",
          role: "PROFESSIONAL",
          expiresAt: future,
          revokedAt: new Date(),
          acceptedAt: null,
          organization: { name: "Clínica", slug: "clinica" },
        }),
      },
    } as unknown as PrismaClient;

    const serviceRevoked = new InviteService({
      prisma: prismaRevoked,
      mailer: {} as any,
      webAppUrl: "http://localhost:3000",
    });

    try {
      await serviceRevoked.getDetails(token);
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe("INVITE_EXPIRED");
    }

    const prismaAccepted = {
      organizationInvite: {
        findUnique: async () => ({
          id: "inv-1",
          email: "medico@exemplo.com",
          role: "PROFESSIONAL",
          expiresAt: future,
          revokedAt: null,
          acceptedAt: new Date(),
          organization: { name: "Clínica", slug: "clinica" },
        }),
      },
    } as unknown as PrismaClient;

    const serviceAccepted = new InviteService({
      prisma: prismaAccepted,
      mailer: {} as any,
      webAppUrl: "http://localhost:3000",
    });

    try {
      await serviceAccepted.getDetails(token);
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe("INVITE_EXPIRED");
    }
  });

  test("accept recusa aceite quando e-mail do usuário logado é diferente (403)", async () => {
    const prisma = {
      user: {
        findUnique: async () => ({ email: "outro@exemplo.com" }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<string>) =>
        fn({
          organizationInvite: {
            findUnique: async () => ({
              id: "inv-1",
              email: "medico@exemplo.com",
              role: "PROFESSIONAL",
              expiresAt: future,
              revokedAt: null,
              acceptedAt: null,
              organization: { slug: "clinica-vida" },
            }),
          },
        }),
    } as unknown as PrismaClient;

    const service = new InviteService({
      prisma,
      mailer: {} as never,
      webAppUrl: "http://localhost:3000",
    });

    try {
      await service.accept("user-1", token);
      expect.unreachable();
    } catch (err: unknown) {
      const error = err as {
        code: string;
        httpStatus: number;
        message: string;
      };
      expect(error.code).toBe("FORBIDDEN");
      expect(error.httpStatus).toBe(403);
      expect(error.message).toBe("Este convite pertence a outro e-mail.");
    }
  });

  test("accept vincula o usuário à clínica com o papel exato e registra trilha de auditoria", async () => {
    let acceptedAtSet: Date | null = null;
    let upsertedRole = "";
    let upsertedStatus = "";
    let auditRecorded = false;
    let onboardingUpdated = false;

    const prisma = {
      user: {
        findUnique: async () => ({ email: "Medico@Exemplo.com" }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<string>) =>
        fn({
          organizationInvite: {
            findUnique: async () => ({
              id: "inv-1",
              organizationId: "org-1",
              email: "medico@exemplo.com",
              role: "PROFESSIONAL",
              expiresAt: future,
              revokedAt: null,
              acceptedAt: null,
              organization: { slug: "clinica-vida" },
            }),
            update: async ({ data }: { data: { acceptedAt: Date } }) => {
              acceptedAtSet = data.acceptedAt;
            },
          },
          membership: {
            upsert: async ({
              create,
            }: {
              create: { role: string; status: string };
              update: { role: string; status: string };
            }) => {
              upsertedRole = create.role;
              upsertedStatus = create.status;
              return { id: "mem-1" };
            },
          },
          onboardingProgress: {
            updateMany: async () => {
              onboardingUpdated = true;
              return { count: 1 };
            },
          },
          auditLog: {
            create: async ({
              data,
            }: {
              data: {
                organizationId: string;
                actorUserId: string;
                action: string;
                targetType: string;
                targetId: string;
                metadata: { email: string; role: string; status: string };
              };
            }) => {
              auditRecorded = true;
              expect(data.action).toBe("TEAM_INVITE_ACCEPTED");
              expect(data.organizationId).toBe("org-1");
              expect(data.actorUserId).toBe("user-1");
              expect(data.targetType).toBe("ORGANIZATION_INVITE");
              expect(data.targetId).toBe("inv-1");
              expect(data.metadata.email).toBe("medico@exemplo.com");
              expect(data.metadata.role).toBe("PROFESSIONAL");
              expect(data.metadata.status).toBe("ACTIVE");
              return { id: "audit-1" };
            },
          },
        }),
    } as unknown as PrismaClient;

    const service = new InviteService({
      prisma,
      mailer: {} as never,
      webAppUrl: "http://localhost:3000",
    });

    const res = await service.accept("user-1", token);
    expect(res.organizationSlug).toBe("clinica-vida");
    expect(acceptedAtSet).toBeTruthy();
    expect(upsertedRole).toBe("PROFESSIONAL");
    expect(upsertedStatus).toBe("ACTIVE");
    expect(auditRecorded).toBe(true);
    expect(onboardingUpdated).toBe(true);
  });

  test("accept repetido pelo mesmo usuário retorna organizationSlug de forma idempotente sem duplicar vínculo ou auditoria", async () => {
    let upsertCalled = false;
    let auditLogCalled = false;
    let inviteUpdateCalled = false;

    const prisma = {
      user: {
        findUnique: async () => ({ email: "Medico@Exemplo.com" }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<string>) =>
        fn({
          organizationInvite: {
            findUnique: async () => ({
              id: "inv-1",
              organizationId: "org-1",
              email: "medico@exemplo.com",
              role: "PROFESSIONAL",
              expiresAt: past,
              revokedAt: null,
              acceptedAt: past,
              organization: { slug: "clinica-vida" },
            }),
            update: async () => {
              inviteUpdateCalled = true;
            },
          },
          membership: {
            upsert: async () => {
              upsertCalled = true;
              return { id: "mem-1" };
            },
          },
          auditLog: {
            create: async () => {
              auditLogCalled = true;
            },
          },
        }),
    } as unknown as PrismaClient;

    const service = new InviteService({
      prisma,
      mailer: {} as never,
      webAppUrl: "http://localhost:3000",
    });

    const res = await service.accept("user-1", token);
    expect(res.organizationSlug).toBe("clinica-vida");
    expect(upsertCalled).toBe(false);
    expect(auditLogCalled).toBe(false);
    expect(inviteUpdateCalled).toBe(false);
  });

  test("accept recusa aceite com 410 quando token está expirado", async () => {
    const prisma = {
      user: {
        findUnique: async () => ({ email: "medico@exemplo.com" }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<string>) =>
        fn({
          organizationInvite: {
            findUnique: async () => ({
              id: "inv-1",
              organizationId: "org-1",
              email: "medico@exemplo.com",
              role: "PROFESSIONAL",
              expiresAt: past,
              revokedAt: null,
              acceptedAt: null,
              organization: { slug: "clinica-vida" },
            }),
          },
        }),
    } as unknown as PrismaClient;

    const service = new InviteService({
      prisma,
      mailer: {} as never,
      webAppUrl: "http://localhost:3000",
    });

    await expect(service.accept("user-1", token)).rejects.toMatchObject({
      code: "INVITE_EXPIRED",
      httpStatus: 410,
    });
  });

  test("accept recusa aceite com 410 quando token foi revogado", async () => {
    const prisma = {
      user: {
        findUnique: async () => ({ email: "medico@exemplo.com" }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<string>) =>
        fn({
          organizationInvite: {
            findUnique: async () => ({
              id: "inv-1",
              organizationId: "org-1",
              email: "medico@exemplo.com",
              role: "PROFESSIONAL",
              expiresAt: future,
              revokedAt: new Date(),
              acceptedAt: null,
              organization: { slug: "clinica-vida" },
            }),
          },
        }),
    } as unknown as PrismaClient;

    const service = new InviteService({
      prisma,
      mailer: {} as never,
      webAppUrl: "http://localhost:3000",
    });

    await expect(service.accept("user-1", token)).rejects.toMatchObject({
      code: "INVITE_EXPIRED",
      httpStatus: 410,
    });
  });

  test("accept recusa com 410 quando token já aceito é invocado por outro usuário", async () => {
    const prisma = {
      user: {
        findUnique: async () => ({ email: "outro@exemplo.com" }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<string>) =>
        fn({
          organizationInvite: {
            findUnique: async () => ({
              id: "inv-1",
              organizationId: "org-1",
              email: "medico@exemplo.com",
              role: "PROFESSIONAL",
              expiresAt: future,
              revokedAt: null,
              acceptedAt: new Date(),
              organization: { slug: "clinica-vida" },
            }),
          },
        }),
    } as unknown as PrismaClient;

    const service = new InviteService({
      prisma,
      mailer: {} as never,
      webAppUrl: "http://localhost:3000",
    });

    await expect(service.accept("user-2", token)).rejects.toMatchObject({
      code: "INVITE_EXPIRED",
      httpStatus: 410,
    });
  });
});

describe("Rotas HTTP de aceite de convite (Elysia)", () => {
  const secret = "test-jwt-secret-route-invites";
  const env: Env = {
    port: 0,
    nodeEnv: "test",
    version: "test",
    jwtSecret: secret,
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

  test("POST /api/invites/:token/accept aceita convite com sucesso via HTTP", async () => {
    const sessionToken = signSessionToken(
      { sid: "sess-1", sub: "user-1" },
      secret,
      3600,
    );
    const prisma = {
      session: {
        findFirst: async () => ({ id: "sess-1", lastActiveAt: new Date() }),
      },
      user: {
        findUnique: async () => ({ email: "medico@exemplo.com" }),
      },
      $transaction: async (fn: (tx: unknown) => Promise<string>) =>
        fn({
          organizationInvite: {
            findUnique: async () => ({
              id: "inv-1",
              organizationId: "org-1",
              email: "medico@exemplo.com",
              role: "PROFESSIONAL",
              expiresAt: future,
              revokedAt: null,
              acceptedAt: null,
              organization: { slug: "clinica-vida" },
            }),
            update: async () => {},
          },
          membership: {
            upsert: async () => ({ id: "mem-1" }),
          },
          onboardingProgress: {
            updateMany: async () => ({ count: 1 }),
          },
          auditLog: {
            create: async () => ({ id: "audit-1" }),
          },
        }),
    } as unknown as PrismaClient;

    const app = createApp(env, {
      prisma,
      mailer: { send: async () => {} } as never,
    });
    const res = await app.handle(
      new Request(`http://localhost/api/invites/${token}/accept`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { organizationSlug: string };
    expect(body.organizationSlug).toBe("clinica-vida");
  });

  test("POST /api/invites/:token/accept recusa token curto via validação de schema", async () => {
    const sessionToken = signSessionToken(
      { sid: "sess-1", sub: "user-1" },
      secret,
      3600,
    );
    const prisma = {
      session: {
        findFirst: async () => ({ id: "sess-1", lastActiveAt: new Date() }),
      },
    } as unknown as PrismaClient;

    const app = createApp(env, {
      prisma,
      mailer: { send: async () => {} } as never,
    });
    const res = await app.handle(
      new Request("http://localhost/api/invites/curto/accept", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("POST /api/invites/:token/accept recusa requisição não autenticada com 401", async () => {
    const prisma = {} as unknown as PrismaClient;
    const app = createApp(env, {
      prisma,
      mailer: { send: async () => {} } as never,
    });
    const res = await app.handle(
      new Request(`http://localhost/api/invites/${token}/accept`, {
        method: "POST",
      }),
    );
    expect(res.status).toBe(401);
  });
});
