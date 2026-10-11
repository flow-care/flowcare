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
        findFirst: async () => ({
          organization: { id: "org-1", name: "Clínica" },
        }),
      },
      organizationInvite: {
        findFirst: async () => ({
          id: "inv-1",
          email: "pessoa@exemplo.com",
          expiresAt: future,
        }),
        update: async () => ({
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
