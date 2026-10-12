import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { hashToken } from "../src/lib/tokens";
import { InviteService } from "../src/modules/invites/service";

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

  test("accept recusa aceite quando e-mail do usuário logado é diferente", async () => {
    const prisma = {
      user: {
        findUnique: async () => ({ email: "outro@exemplo.com" }),
      },
      $transaction: async (fn: any) =>
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
      mailer: {} as any,
      webAppUrl: "http://localhost:3000",
    });

    try {
      await service.accept("user-1", token);
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe("FORBIDDEN");
      expect(err.httpStatus).toBe(403);
    }
  });

  test("accept vincula o usuário à clínica e aceitação repetida não duplica vínculo", async () => {
    let acceptedAtSet: Date | null = null;
    let upsertedRole: any = null;

    const prisma = {
      user: {
        findUnique: async () => ({ email: "medico@exemplo.com" }),
      },
      $transaction: async (fn: any) =>
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
            update: async ({ data }: any) => {
              acceptedAtSet = data.acceptedAt;
            },
          },
          membership: {
            upsert: async ({ create, update }: any) => {
              upsertedRole = create.role || update.role;
              return { id: "mem-1" };
            },
          },
        }),
    } as unknown as PrismaClient;

    const service = new InviteService({
      prisma,
      mailer: {} as any,
      webAppUrl: "http://localhost:3000",
    });

    const res = await service.accept("user-1", token);
    expect(res.organizationSlug).toBe("clinica-vida");
    expect(acceptedAtSet).toBeTruthy();
    expect(upsertedRole).toBe("PROFESSIONAL");
  });
});
