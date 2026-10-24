import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type {
  MembershipRole,
  PrismaClient,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import {
  ALL_PERMISSIONS,
  type Permission,
  PRESET_PERMISSIONS,
} from "../src/lib/permissions";
import { TeamService } from "../src/modules/team/service";
import { authPlugin } from "../src/plugins/auth";
import { organizationAccessPlugin } from "../src/plugins/organization-access";
import { signSessionToken } from "../src/services/session-token";

const secret = "permissions-test-secret";
const slug = "clinica-solo";
const organizationId = "22222222-2222-4222-8222-222222222222";
const ownerId = "user-owner";
const memberId = "user-member";
const membershipOwnerId = "membership-owner";
const membershipMemberId = "membership-member";

type Member = {
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
  permissions: string[];
  status: "ACTIVE" | "SUSPENDED" | "INVITED";
  version: number;
  createdAt: Date;
  updatedAt: Date;
  user: { id: string; fullName: string; email: string };
};

type AuditEntry = { action: string; metadata: Record<string, unknown> };

function fixture(roles: MembershipRole[] = ["ADMIN", "PROFESSIONAL"]) {
  const members: Member[] = roles.map((role, index) => ({
    id: index === 0 ? membershipOwnerId : membershipMemberId,
    userId: index === 0 ? ownerId : memberId,
    organizationId,
    role,
    permissions: [],
    status: "ACTIVE",
    version: 1,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    user: {
      id: index === 0 ? ownerId : memberId,
      fullName: index === 0 ? "Dra. Ana" : "Dr. Bruno",
      email: index === 0 ? "ana@clinica.test" : "bruno@clinica.test",
    },
  }));
  const auditLogs: AuditEntry[] = [];

  const prisma = {
    session: {
      findFirst: async () => ({ id: "session-1", lastActiveAt: new Date() }),
    },
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        slug,
        timezone: "America/Sao_Paulo",
      }),
    },
    membership: {
      findMany: async () =>
        members
          .filter((m) => m.status === "ACTIVE")
          .map((m) => structuredClone(m)),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const found = members.find((m) => {
          if (where.id && m.id !== where.id) return false;
          if (where.userId && m.userId !== where.userId) return false;
          return true;
        });
        return found ? structuredClone(found) : null;
      },
      count: async ({ where }: { where: Record<string, unknown> }) =>
        members.filter(
          (m) =>
            m.status === "ACTIVE" &&
            m.organizationId === where.organizationId &&
            (!where.role || true),
        ).length,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const target = members.find(
          (m) => m.id === where.id && m.version === where.version,
        );
        if (!target) return { count: 0 };
        if (data.role) target.role = data.role as MembershipRole;
        if (data.permissions) target.permissions = data.permissions as string[];
        target.version += 1;
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: AuditEntry }) => {
        auditLogs.push({ action: data.action, metadata: data.metadata });
        return data;
      },
    },
  } as unknown as PrismaClient;

  const app = new Elysia()
    .onError(({ error, status }) => {
      if (error instanceof ApiError)
        return status(error.httpStatus, {
          error: { code: error.code, details: error.details },
        });
      return status(500, { error: { code: "INTERNAL" } });
    })
    .use(authPlugin({ prisma, jwtSecret: secret }))
    .use(organizationAccessPlugin({ prisma, jwtSecret: secret }))
    .get(
      "/organizations/:orgSlug/members",
      ({ organizationAccess }) =>
        service.listMembers(organizationAccess.organizationId),
      { organizationAccess: "team:read" },
    )
    .patch(
      "/organizations/:orgSlug/members/:memberId/permissions",
      ({ organizationAccess, auth, params, body }) =>
        service.updateMemberPermissions({
          organizationId: organizationAccess.organizationId,
          actorUserId: auth!.userId,
          memberId: params.memberId,
          body: body as never,
        }),
      { organizationAccess: "team:manage" },
    );

  const service = new TeamService(prisma);
  const token = signSessionToken(
    { sid: "session-1", sub: ownerId },
    secret,
    60,
  );
  const request = (init: {
    method: "GET" | "PATCH";
    path: string;
    body?: unknown;
    userId?: string;
  }) => {
    const actor = init.userId
      ? signSessionToken({ sid: "session-1", sub: init.userId }, secret, 60)
      : token;
    return app.handle(
      new Request(`http://localhost${init.path}`, {
        method: init.method,
        headers: {
          authorization: `Bearer ${actor}`,
          "content-type": "application/json",
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      }),
    );
  };

  return { prisma, members, auditLogs, request };
}

describe("permissões por membro", () => {
  test("lista membros com preset, permissões efetivas e presets disponíveis", async () => {
    const f = fixture();
    const response = await f.request({
      method: "GET",
      path: `/organizations/${slug}/members`,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: Array<{
        preset: string;
        permissions: string[];
        isCustomized: boolean;
      }>;
      isSoloClinic: boolean;
      presetPermissions: Record<string, string[]>;
    };
    expect(body.isSoloClinic).toBe(false);
    expect(body.data).toHaveLength(2);
    const [admin, professional] = body.data;
    expect(admin?.preset).toBe("ADMIN");
    expect(admin?.isCustomized).toBe(false);
    expect(admin?.permissions).toHaveLength(PRESET_PERMISSIONS.ADMIN.size);
    // Admin não vê o prontuário de outro profissional por padrão.
    expect(admin?.permissions).not.toContain("clinical:read_all");
    expect(professional?.preset).toBe("PROFESSIONAL");
    expect(professional?.permissions).toContain("consultations:write");
    expect(professional?.permissions).not.toContain("settings:write");
    expect(body.presetPermissions.RECEPTIONIST).toContain("patients:write");
  });

  test("personaliza a lista sem trocar o papel e registra auditoria", async () => {
    const f = fixture();
    const response = await f.request({
      method: "PATCH",
      path: `/organizations/${slug}/members/${membershipMemberId}/permissions`,
      body: {
        permissions: [
          "patients:read",
          "appointments:read",
          "consultations:read",
          "clinical:read_all",
        ],
        version: 1,
      },
    });
    expect(response.status).toBe(200);

    const member = f.members.find((m) => m.id === membershipMemberId);
    expect(member?.role).toBe("PROFESSIONAL");
    expect(member?.permissions).toEqual([
      "patients:read",
      "appointments:read",
      "consultations:read",
      "clinical:read_all",
    ]);
    expect(f.auditLogs.map((entry) => entry.action)).toEqual([
      "MEMBER_PERMISSIONS_CHANGED",
      "CLINICAL_SCOPE_GRANTED",
    ]);

    const listing = await f.request({
      method: "GET",
      path: `/organizations/${slug}/members`,
    });
    const body = (await listing.json()) as {
      data: Array<{ isCustomized: boolean; permissions: string[] }>;
    };
    expect(body.data[1]?.isCustomized).toBe(true);
    expect(body.data[1]?.permissions).toContain("clinical:read_all");
  });

  test("aplicar um preset restaura a predefinição e limpa a personalização", async () => {
    const f = fixture();
    f.members[1]!.permissions = ["patients:read"];
    f.members[1]!.version = 3;

    const response = await f.request({
      method: "PATCH",
      path: `/organizations/${slug}/members/${membershipMemberId}/permissions`,
      body: { preset: "RECEPTIONIST", version: 3 },
    });
    expect(response.status).toBe(200);

    const member = f.members.find((m) => m.id === membershipMemberId);
    expect(member?.role).toBe("RECEPTIONIST");
    expect(member?.permissions).toEqual([]);

    const listing = await f.request({
      method: "GET",
      path: `/organizations/${slug}/members`,
    });
    const body = (await listing.json()) as {
      data: Array<{ preset: string; permissions: string[] }>;
    };
    expect(body.data[1]?.preset).toBe("RECEPTIONIST");
    expect(body.data[1]?.permissions).toEqual([
      ...PRESET_PERMISSIONS.RECEPTIONIST,
    ]);
  });

  test("recusa permissão desconhecida sem gravar nada", async () => {
    const f = fixture();
    const response = await f.request({
      method: "PATCH",
      path: `/organizations/${slug}/members/${membershipMemberId}/permissions`,
      body: { permissions: ["patients:read", "financeiro:saque"], version: 1 },
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; details?: { permission?: string } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details?.permission).toBe("financeiro:saque");
    expect(f.members[1]?.permissions).toEqual([]);
    expect(f.auditLogs).toHaveLength(0);
  });

  test("ninguém edita as próprias permissões", async () => {
    const f = fixture();
    const response = await f.request({
      method: "PATCH",
      path: `/organizations/${slug}/members/${membershipOwnerId}/permissions`,
      body: { permissions: [...ALL_PERMISSIONS] as Permission[], version: 1 },
    });
    expect(response.status).toBe(403);
    expect(f.members[0]?.permissions).toEqual([]);
  });

  test("versão desatualizada devolve 409", async () => {
    const f = fixture();
    const response = await f.request({
      method: "PATCH",
      path: `/organizations/${slug}/members/${membershipMemberId}/permissions`,
      body: { permissions: ["patients:read"], version: 9 },
    });
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VERSION_CONFLICT");
  });

  test("clínica solo: o único membro ativo recebe todas as permissões", async () => {
    const f = fixture(["RECEPTIONIST"]);
    const response = await f.request({
      method: "GET",
      path: `/organizations/${slug}/members`,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      isSoloClinic: boolean;
      data: Array<{ permissions: string[] }>;
    };
    expect(body.isSoloClinic).toBe(true);
    expect(body.data[0]?.permissions).toEqual([...ALL_PERMISSIONS]);
  });
});
