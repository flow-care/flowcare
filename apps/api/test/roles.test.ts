import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type {
  MembershipRole,
  MembershipStatus,
  PrismaClient,
} from "../src/generated/prisma/client";
import type {
  CreateRoleResponse,
  ListCapabilitiesResponse,
  ListRolesResponse,
  UpdateRoleResponse,
} from "../src/modules/roles/model";
import { signSessionToken } from "../src/services/session-token";

const env: Env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "roles-test-secret-1234567890",
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

interface OrgRecord {
  id: string;
  name: string;
  slug: string;
}

interface MembershipRecord {
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
  status: MembershipStatus;
}

interface CustomRoleRecord {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  capabilities: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface AuditRecord {
  id?: string;
  organizationId: string | null;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt?: Date;
}

function setup() {
  const organizations = new Map<string, OrgRecord>([
    ["org-a", { id: "org-a", name: "Clínica Vida", slug: "clinica-vida" }],
    ["org-b", { id: "org-b", name: "Clínica Sul", slug: "clinica-sul" }],
  ]);

  const memberships: MembershipRecord[] = [
    {
      id: "mem-admin",
      userId: "user-admin",
      organizationId: "org-a",
      role: "ADMIN",
      status: "ACTIVE",
    },
    {
      id: "mem-admin-prof",
      userId: "user-admin-prof",
      organizationId: "org-a",
      role: "ADMIN_PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-prof",
      userId: "user-prof",
      organizationId: "org-a",
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-recep",
      userId: "user-recep",
      organizationId: "org-a",
      role: "RECEPTIONIST",
      status: "ACTIVE",
    },
    {
      id: "mem-suspended",
      userId: "user-suspended",
      organizationId: "org-a",
      role: "ADMIN",
      status: "SUSPENDED",
    },
    {
      id: "mem-other-admin",
      userId: "user-other-admin",
      organizationId: "org-b",
      role: "ADMIN",
      status: "ACTIVE",
    },
  ];

  const customRoles: CustomRoleRecord[] = [];
  const auditLogs: AuditRecord[] = [];

  const findMembership = (where: Record<string, any>) => {
    return (
      memberships.find((m) => {
        if (where.userId && m.userId !== where.userId) return false;
        if (where.organizationId && m.organizationId !== where.organizationId)
          return false;
        if (typeof where.status === "string" && m.status !== where.status)
          return false;
        const org = organizations.get(m.organizationId);
        if (!org) return false;
        if (where.organization?.slug && org.slug !== where.organization.slug)
          return false;
        return true;
      }) ?? null
    );
  };

  const prisma = {
    session: {
      findFirst: async () => ({ id: "session-1", lastActiveAt: new Date() }),
    },
    membership: {
      findFirst: async ({ where }: { where: Record<string, any> }) => {
        const found = findMembership(where);
        if (!found) return null;
        const org = organizations.get(found.organizationId)!;
        return {
          ...found,
          organization: { ...org },
        };
      },
      groupBy: async ({
        where,
      }: {
        where: { organizationId: string; status: string };
      }) => {
        const counts = new Map<MembershipRole, number>();
        for (const m of memberships) {
          if (
            m.organizationId === where.organizationId &&
            m.status === where.status
          ) {
            counts.set(m.role, (counts.get(m.role) ?? 0) + 1);
          }
        }
        return Array.from(counts.entries()).map(([role, count]) => ({
          role,
          _count: { id: count },
        }));
      },
    },
    organizationRole: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return customRoles.find((r) => r.id === where.id) ?? null;
      },
      findFirst: async ({ where }: { where: Record<string, any> }) => {
        return (
          customRoles.find((r) => {
            if (
              where.organizationId &&
              r.organizationId !== where.organizationId
            )
              return false;
            if (where.id && typeof where.id === "string" && r.id !== where.id)
              return false;
            if (where.id?.not && r.id === where.id.not) return false;
            if (where.name?.equals) {
              const matches =
                where.name.mode === "insensitive"
                  ? r.name.toLowerCase() === where.name.equals.toLowerCase()
                  : r.name === where.name.equals;
              if (!matches) return false;
            }
            return true;
          }) ?? null
        );
      },
      findMany: async ({
        where,
      }: {
        where: { organizationId: string };
        orderBy?: { createdAt: string };
      }) => {
        return customRoles
          .filter((r) => r.organizationId === where.organizationId)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      },
      create: async ({ data }: { data: Record<string, any> }) => {
        const record: CustomRoleRecord = {
          id: `role-${customRoles.length + 1}`,
          organizationId: data.organizationId,
          name: data.name,
          description: data.description ?? null,
          capabilities: [...data.capabilities],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        customRoles.push(record);
        return record;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, any>;
      }) => {
        const index = customRoles.findIndex((r) => r.id === where.id);
        if (index === -1) throw new Error("Role not found");
        const existing = customRoles[index]!;
        const updated: CustomRoleRecord = {
          ...existing,
          name: data.name ?? existing.name,
          description:
            data.description !== undefined
              ? data.description
              : existing.description,
          capabilities: data.capabilities
            ? [...data.capabilities]
            : existing.capabilities,
          updatedAt: new Date(),
        };
        customRoles[index] = updated;
        return updated;
      },
    },
    auditLog: {
      create: async ({ data }: { data: AuditRecord }) => {
        const record = { id: `audit-${auditLogs.length + 1}`, ...data };
        auditLogs.push(record);
        return record;
      },
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const txPrisma = {
        organizationRole: {
          create: async ({ data }: { data: Record<string, any> }) => {
            const record: CustomRoleRecord = {
              id: `role-${customRoles.length + 1}`,
              organizationId: data.organizationId,
              name: data.name,
              description: data.description ?? null,
              capabilities: [...data.capabilities],
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            customRoles.push(record);
            return record;
          },
          update: async ({
            where,
            data,
          }: {
            where: { id: string };
            data: Record<string, any>;
          }) => {
            const index = customRoles.findIndex((r) => r.id === where.id);
            if (index === -1) throw new Error("Role not found");
            const existing = customRoles[index]!;
            const updated: CustomRoleRecord = {
              ...existing,
              name: data.name ?? existing.name,
              description:
                data.description !== undefined
                  ? data.description
                  : existing.description,
              capabilities: data.capabilities
                ? [...data.capabilities]
                : existing.capabilities,
              updatedAt: new Date(),
            };
            customRoles[index] = updated;
            return updated;
          },
        },
        auditLog: {
          create: async ({ data }: { data: AuditRecord }) => {
            const record = { id: `audit-${auditLogs.length + 1}`, ...data };
            auditLogs.push(record);
            return record;
          },
        },
      };
      return fn(txPrisma);
    },
  } as unknown as PrismaClient;

  const app = createApp(env, {
    prisma,
    mailer: { send: async () => {} },
  });

  const tokenFor = (userId: string) =>
    signSessionToken({ sid: "session-1", sub: userId }, env.jwtSecret, 3600);

  const request = (
    path: string,
    init: RequestInit & { userId?: string | null } = {},
  ) => {
    const { userId = "user-admin", headers, ...rest } = init;
    const mergedHeaders = new Headers(headers);
    if (userId) {
      mergedHeaders.set("authorization", `Bearer ${tokenFor(userId)}`);
    }
    return app.handle(
      new Request(`http://localhost/api${path}`, {
        ...rest,
        headers: mergedHeaders,
      }),
    );
  };

  return {
    request,
    customRoles,
    auditLogs,
    memberships,
    organizations,
  };
}

describe("Task #316: Custom Organization Roles", () => {
  test("GET /roles/capabilities returns the approved capabilities catalog", async () => {
    const { request } = setup();

    const res = await request("/organizations/clinica-vida/roles/capabilities");
    expect(res.status).toBe(200);

    const body = (await res.json()) as ListCapabilitiesResponse;
    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(body.capabilities.length).toBeGreaterThanOrEqual(25);

    const names = body.capabilities.map((c) => c.name);
    expect(names).toContain("patients:read");
    expect(names).toContain("patients:write");
    expect(names).toContain("appointments:read");
    expect(names).toContain("appointments:write");
    expect(names).toContain("consultations:read");
    expect(names).toContain("documents:read");
    expect(names).toContain("team:read");
    expect(names).toContain("settings:read");

    const sample = body.capabilities.find((c) => c.name === "patients:read");
    expect(sample).toBeDefined();
    expect(sample?.group).toBe("common");
    expect(typeof sample?.description).toBe("string");
  });

  test("creates a valid custom role with approved capabilities and writes AuditLog", async () => {
    const { request, customRoles, auditLogs } = setup();

    const payload = {
      name: "Coordenador de Atendimento",
      description: "Supervisão da recepção e agendamentos",
      capabilities: [
        "patients:read",
        "patients:write",
        "appointments:read",
        "appointments:write",
        "reception:read",
        "reception:write",
      ],
    };

    const res = await request("/organizations/clinica-vida/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as CreateRoleResponse;

    expect(body.name).toBe("Coordenador de Atendimento");
    expect(body.description).toBe("Supervisão da recepção e agendamentos");
    expect(body.capabilities).toEqual(payload.capabilities);
    expect(body.organizationId).toBe("org-a");
    expect(body.isSystem).toBe(false);
    expect(typeof body.createdAt).toBe("string");
    expect(typeof body.updatedAt).toBe("string");

    // Check persistence
    expect(customRoles).toHaveLength(1);
    expect(customRoles[0]?.name).toBe("Coordenador de Atendimento");
    expect(customRoles[0]?.organizationId).toBe("org-a");

    // Check AuditLog creation
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      organizationId: "org-a",
      actorUserId: "user-admin",
      action: "ROLE_CREATED",
      targetType: "ORGANIZATION_ROLE",
      targetId: body.id,
      metadata: {
        name: "Coordenador de Atendimento",
        capabilities: payload.capabilities,
      },
    });
  });

  test("rejects unknown or disallowed capabilities with HTTP 400 and structured details", async () => {
    const { request, customRoles, auditLogs } = setup();

    const payload = {
      name: "Papel Inválido",
      capabilities: [
        "patients:read",
        "invalid_capability_foo",
        "super_admin_all",
      ],
    };

    const res = await request("/organizations/clinica-vida/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details?: { invalidCapabilities?: string[] } };
    };

    expect(body.error.code).toBe("INVALID_CAPABILITY");
    expect(body.error.details?.invalidCapabilities).toContain(
      "invalid_capability_foo",
    );
    expect(body.error.details?.invalidCapabilities).toContain(
      "super_admin_all",
    );

    // No custom role or audit log created
    expect(customRoles).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);
  });

  test("rejects empty capabilities array with HTTP 400", async () => {
    const { request } = setup();

    const res = await request("/organizations/clinica-vida/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Sem Permissões",
        capabilities: [],
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects custom role name collision within the same clinic with HTTP 409", async () => {
    const { request, customRoles } = setup();

    // First creation succeeds
    const firstRes = await request("/organizations/clinica-vida/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Líder de Enfermagem",
        capabilities: ["patients:read", "appointments:read"],
      }),
    });
    expect(firstRes.status).toBe(201);
    expect(customRoles).toHaveLength(1);

    // Second creation with same name (case-insensitive & trimmed) fails with 409
    const secondRes = await request("/organizations/clinica-vida/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "  líder de enfermagem  ",
        capabilities: ["patients:read", "consultations:read"],
      }),
    });
    expect(secondRes.status).toBe(409);
    const body = (await secondRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ALREADY_EXISTS");

    // Still only 1 custom role
    expect(customRoles).toHaveLength(1);
  });

  test("rejects reserved system role names (ADMIN, PROFESSIONAL, etc.) with HTTP 409", async () => {
    const { request, customRoles } = setup();

    const reserved = [
      "ADMIN",
      "admin",
      "Admin",
      "ADMIN_PROFESSIONAL",
      "admin_professional",
      "PROFESSIONAL",
      "professional",
      "RECEPTIONIST",
      "receptionist",
    ];

    for (const name of reserved) {
      const res = await request("/organizations/clinica-vida/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          capabilities: ["patients:read"],
        }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("ROLE_NAME_CONFLICT");
    }

    expect(customRoles).toHaveLength(0);
  });

  test("rejects invalid role name length (<2 or >50 chars) with HTTP 400", async () => {
    const { request } = setup();

    // Too short
    const shortRes = await request("/organizations/clinica-vida/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "A",
        capabilities: ["patients:read"],
      }),
    });
    expect(shortRes.status).toBe(400);

    // Whitespace only
    const whitespaceRes = await request("/organizations/clinica-vida/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "   ",
        capabilities: ["patients:read"],
      }),
    });
    expect(whitespaceRes.status).toBe(400);

    // Too long (51 characters)
    const longRes = await request("/organizations/clinica-vida/roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "A".repeat(51),
        capabilities: ["patients:read"],
      }),
    });
    expect(longRes.status).toBe(400);
  });

  test("lists system roles with member count and custom roles isolated per tenant", async () => {
    const { request, customRoles } = setup();

    // Add custom role to Clinic A
    customRoles.push({
      id: "role-a-1",
      organizationId: "org-a",
      name: "Auditor Interno",
      description: "Acesso a relatórios e logs",
      capabilities: ["audit:read", "usage:read"],
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
      updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    });

    // Add custom role to Clinic B with same name (allowed across tenants)
    customRoles.push({
      id: "role-b-1",
      organizationId: "org-b",
      name: "Auditor Interno",
      description: "Auditor da filial Sul",
      capabilities: ["audit:read"],
      createdAt: new Date("2026-10-02T10:00:00.000Z"),
      updatedAt: new Date("2026-10-02T10:00:00.000Z"),
    });

    // Request for Clinic A
    const resA = await request("/organizations/clinica-vida/roles");
    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as ListRolesResponse;

    // Verify system roles in Clinic A
    // Três predefinições: Admin, Profissional e Recepção (ADMIN_PROFESSIONAL
    // deixou de existir como preset).
    expect(bodyA.systemRoles).toHaveLength(3);
    expect(bodyA.systemRoles.map((r) => r.role).sort()).toEqual([
      "ADMIN",
      "PROFESSIONAL",
      "RECEPTIONIST",
    ]);
    const adminRole = bodyA.systemRoles.find((r) => r.role === "ADMIN");
    expect(adminRole?.memberCount).toBe(1); // user-admin is ACTIVE ADMIN
    expect(adminRole?.isSystem).toBe(true);

    const profRole = bodyA.systemRoles.find((r) => r.role === "PROFESSIONAL");
    expect(profRole?.memberCount).toBe(1);

    // Verify Clinic A custom roles
    expect(bodyA.customRoles).toHaveLength(1);
    expect(bodyA.customRoles[0]?.id).toBe("role-a-1");
    expect(bodyA.customRoles[0]?.name).toBe("Auditor Interno");
    expect(bodyA.customRoles[0]?.description).toBe(
      "Acesso a relatórios e logs",
    );

    // Request for Clinic B with user-other-admin
    const resB = await request("/organizations/clinica-sul/roles", {
      userId: "user-other-admin",
    });
    expect(resB.status).toBe(200);
    const bodyB = (await resB.json()) as ListRolesResponse;

    // Strict multi-tenant isolation: Clinic B sees role-b-1, NEVER role-a-1!
    expect(bodyB.customRoles).toHaveLength(1);
    expect(bodyB.customRoles[0]?.id).toBe("role-b-1");
    expect(bodyB.customRoles[0]?.description).toBe("Auditor da filial Sul");
  });

  test("enforces RBAC and multi-tenant isolation for roles endpoints", async () => {
    const { request } = setup();

    // ADMIN_PROFESSIONAL can list and create
    const adminProfGet = await request(
      "/organizations/clinica-vida/roles/capabilities",
      { userId: "user-admin-prof" },
    );
    expect(adminProfGet.status).toBe(200);

    const adminProfPost = await request("/organizations/clinica-vida/roles", {
      userId: "user-admin-prof",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Supervisor Geral",
        capabilities: ["patients:read", "appointments:read"],
      }),
    });
    expect(adminProfPost.status).toBe(201);

    // Non-admin roles (PROFESSIONAL, RECEPTIONIST) are denied with 403 PERMISSION_DENIED
    for (const userId of ["user-prof", "user-recep"]) {
      const getRes = await request("/organizations/clinica-vida/roles", {
        userId,
      });
      expect(getRes.status).toBe(403);
      expect(await getRes.json()).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });

      const postRes = await request("/organizations/clinica-vida/roles", {
        userId,
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Tentativa Bloqueada",
          capabilities: ["patients:read"],
        }),
      });
      expect(postRes.status).toBe(403);
      expect(await postRes.json()).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });
    }

    // Suspended member is denied with 403 MEMBERSHIP_INACTIVE
    const suspendedRes = await request("/organizations/clinica-vida/roles", {
      userId: "user-suspended",
    });
    expect(suspendedRes.status).toBe(403);
    expect(await suspendedRes.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });

    // Unauthenticated request is denied with 401 UNAUTHENTICATED
    const unauthRes = await request("/organizations/clinica-vida/roles", {
      userId: null,
    });
    expect(unauthRes.status).toBe(401);

    // Non-member (or user from another clinic) receives 404 NOT_FOUND
    const foreignGet = await request("/organizations/clinica-vida/roles", {
      userId: "user-other-admin",
    });
    expect(foreignGet.status).toBe(404);

    const foreignPost = await request("/organizations/clinica-vida/roles", {
      userId: "user-other-admin",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Papel Alien",
        capabilities: ["patients:read"],
      }),
    });
    expect(foreignPost.status).toBe(404);
  });
});

describe("Task #319: Update Custom Organization Roles", () => {
  test("updates custom role name, description, and capabilities with immediate persistence and AuditLog diff", async () => {
    const { request, customRoles, auditLogs } = setup();

    customRoles.push({
      id: "role-1",
      organizationId: "org-a",
      name: "Coordenador de Atendimento",
      description: "Supervisão da recepção",
      capabilities: ["patients:read", "appointments:read"],
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
      updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    });

    const payload = {
      name: "Coordenador Geral",
      description: "Supervisão completa da clínica",
      capabilities: [
        "patients:read",
        "appointments:read",
        "consultations:read",
      ],
    };

    const res = await request("/organizations/clinica-vida/roles/role-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as UpdateRoleResponse;

    expect(body.id).toBe("role-1");
    expect(body.name).toBe("Coordenador Geral");
    expect(body.description).toBe("Supervisão completa da clínica");
    expect(body.capabilities).toEqual([
      "patients:read",
      "appointments:read",
      "consultations:read",
    ]);
    expect(body.isSystem).toBe(false);
    expect(body.role.name).toBe("Coordenador Geral");

    // Immediate persistence
    expect(customRoles[0]?.name).toBe("Coordenador Geral");
    expect(customRoles[0]?.description).toBe("Supervisão completa da clínica");
    expect(customRoles[0]?.capabilities).toEqual([
      "patients:read",
      "appointments:read",
      "consultations:read",
    ]);

    // AuditLog verification
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      organizationId: "org-a",
      actorUserId: "user-admin",
      action: "ROLE_UPDATED",
      targetType: "ORGANIZATION_ROLE",
      targetId: "role-1",
      metadata: {
        previousName: "Coordenador de Atendimento",
        newName: "Coordenador Geral",
        previousCapabilities: ["patients:read", "appointments:read"],
        newCapabilities: [
          "patients:read",
          "appointments:read",
          "consultations:read",
        ],
        diff: {
          name: {
            from: "Coordenador de Atendimento",
            to: "Coordenador Geral",
          },
          description: {
            from: "Supervisão da recepção",
            to: "Supervisão completa da clínica",
          },
          addedCapabilities: ["consultations:read"],
          removedCapabilities: [],
        },
      },
    });
  });

  test("supports partial update of only capabilities, calculating added and removed diff", async () => {
    const { request, customRoles, auditLogs } = setup();

    customRoles.push({
      id: "role-1",
      organizationId: "org-a",
      name: "Enfermeiro Chefe",
      description: "Coordenação de enfermagem",
      capabilities: ["patients:read", "patients:write", "appointments:read"],
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
      updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    });

    const res = await request("/organizations/clinica-vida/roles/role-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilities: ["patients:read", "documents:read"],
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as UpdateRoleResponse;

    expect(body.name).toBe("Enfermeiro Chefe");
    expect(body.description).toBe("Coordenação de enfermagem");
    expect(body.capabilities).toEqual(["patients:read", "documents:read"]);

    expect(auditLogs).toHaveLength(1);
    const meta = auditLogs[0]?.metadata as {
      diff: {
        addedCapabilities: string[];
        removedCapabilities: string[];
        name?: unknown;
      };
    };
    expect(meta.diff.addedCapabilities).toEqual(["documents:read"]);
    expect(meta.diff.removedCapabilities).toContain("patients:write");
    expect(meta.diff.removedCapabilities).toContain("appointments:read");
    expect(meta.diff.name).toBeUndefined();
  });

  test("rejects unknown or disallowed capabilities with HTTP 400 INVALID_CAPABILITY and structured details", async () => {
    const { request, customRoles, auditLogs } = setup();

    customRoles.push({
      id: "role-1",
      organizationId: "org-a",
      name: "Papel Válido",
      description: "Descrição",
      capabilities: ["patients:read"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request("/organizations/clinica-vida/roles/role-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilities: [
          "patients:read",
          "unauthorized_root_access",
          "system_destroy",
        ],
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; details?: { invalidCapabilities?: string[] } };
    };

    expect(body.error.code).toBe("INVALID_CAPABILITY");
    expect(body.error.details?.invalidCapabilities).toContain(
      "unauthorized_root_access",
    );
    expect(body.error.details?.invalidCapabilities).toContain("system_destroy");

    // State not modified, no AuditLog created
    expect(customRoles[0]?.capabilities).toEqual(["patients:read"]);
    expect(auditLogs).toHaveLength(0);
  });

  test("rejects empty capabilities array with HTTP 400 VALIDATION_ERROR", async () => {
    const { request, customRoles } = setup();

    customRoles.push({
      id: "role-1",
      organizationId: "org-a",
      name: "Papel Válido",
      description: "Descrição",
      capabilities: ["patients:read"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request("/organizations/clinica-vida/roles/role-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilities: [],
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects attempts to edit reserved system roles with HTTP 400 RESERVED_ROLE_IMMUTABLE", async () => {
    const { request } = setup();

    const reservedRoles = [
      "ADMIN",
      "admin",
      "ADMIN_PROFESSIONAL",
      "admin_professional",
      "PROFESSIONAL",
      "professional",
      "RECEPTIONIST",
      "receptionist",
    ];

    for (const reserved of reservedRoles) {
      const res = await request(
        `/organizations/clinica-vida/roles/${reserved}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Novo Nome Qualquer",
            capabilities: ["patients:read"],
          }),
        },
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("RESERVED_ROLE_IMMUTABLE");
    }
  });

  test("rejects duplicate name collision with another custom role in the same clinic with HTTP 409", async () => {
    const { request, customRoles } = setup();

    customRoles.push({
      id: "role-1",
      organizationId: "org-a",
      name: "Atendente Júnior",
      description: null,
      capabilities: ["patients:read"],
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
      updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    });

    customRoles.push({
      id: "role-2",
      organizationId: "org-a",
      name: "Supervisor Geral",
      description: null,
      capabilities: ["patients:read", "appointments:read"],
      createdAt: new Date("2026-10-02T10:00:00.000Z"),
      updatedAt: new Date("2026-10-02T10:00:00.000Z"),
    });

    // Trying to rename role-1 to colliding name fails with 409
    const collisionRes = await request(
      "/organizations/clinica-vida/roles/role-1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "  supervisor geral  ",
        }),
      },
    );

    expect(collisionRes.status).toBe(409);
    const body = (await collisionRes.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ALREADY_EXISTS");

    // Updating role-1 while keeping its own name succeeds
    const sameNameRes = await request(
      "/organizations/clinica-vida/roles/role-1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Atendente Júnior",
          description: "Nova descrição atualizada",
        }),
      },
    );

    expect(sameNameRes.status).toBe(200);
  });

  test("rejects renaming custom role to a reserved system role name with HTTP 409 ROLE_NAME_CONFLICT", async () => {
    const { request, customRoles } = setup();

    customRoles.push({
      id: "role-1",
      organizationId: "org-a",
      name: "Papel Customizado",
      description: null,
      capabilities: ["patients:read"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const reserved = ["ADMIN", "admin", "PROFESSIONAL", "RECEPTIONIST"];
    for (const name of reserved) {
      const res = await request("/organizations/clinica-vida/roles/role-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
        }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("ROLE_NAME_CONFLICT");
    }
  });

  test("rejects invalid role name length (<2 or >50 chars) with HTTP 400 VALIDATION_ERROR", async () => {
    const { request, customRoles } = setup();

    customRoles.push({
      id: "role-1",
      organizationId: "org-a",
      name: "Papel Customizado",
      description: null,
      capabilities: ["patients:read"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Too short
    const shortRes = await request("/organizations/clinica-vida/roles/role-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "A",
      }),
    });
    expect(shortRes.status).toBe(400);

    // Whitespace only
    const whitespaceRes = await request(
      "/organizations/clinica-vida/roles/role-1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "   ",
        }),
      },
    );
    expect(whitespaceRes.status).toBe(400);

    // Too long (51 chars)
    const longRes = await request("/organizations/clinica-vida/roles/role-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "A".repeat(51),
      }),
    });
    expect(longRes.status).toBe(400);
  });

  test("enforces multi-tenant isolation and 404 for non-existent roles", async () => {
    const { request, customRoles } = setup();

    // Role belongs to Clinic B (org-b)
    customRoles.push({
      id: "role-b-1",
      organizationId: "org-b",
      name: "Auditor Sul",
      description: null,
      capabilities: ["audit:read"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Admin of Clinic A attempts to edit Clinic B's role
    const foreignRes = await request(
      "/organizations/clinica-vida/roles/role-b-1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Hack Sul",
        }),
      },
    );
    expect(foreignRes.status).toBe(404);
    expect(await foreignRes.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });

    // Non-existent role ID
    const notFoundRes = await request(
      "/organizations/clinica-vida/roles/role-inexistente",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Novo Nome",
        }),
      },
    );
    expect(notFoundRes.status).toBe(404);
  });

  test("enforces RBAC permissions on role update", async () => {
    const { request, customRoles } = setup();

    customRoles.push({
      id: "role-1",
      organizationId: "org-a",
      name: "Papel Teste",
      description: null,
      capabilities: ["patients:read"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Non-admin roles (PROFESSIONAL, RECEPTIONIST) are denied with 403 PERMISSION_DENIED
    for (const userId of ["user-prof", "user-recep"]) {
      const res = await request("/organizations/clinica-vida/roles/role-1", {
        userId,
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Tentativa Bloqueada",
        }),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });
    }

    // Suspended admin is denied with 403 MEMBERSHIP_INACTIVE
    const suspendedRes = await request(
      "/organizations/clinica-vida/roles/role-1",
      {
        userId: "user-suspended",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Bloqueado",
        }),
      },
    );
    expect(suspendedRes.status).toBe(403);
    expect(await suspendedRes.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });

    // Unauthenticated request is denied with 401 UNAUTHENTICATED
    const unauthRes = await request(
      "/organizations/clinica-vida/roles/role-1",
      {
        userId: null,
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Sem Auth",
        }),
      },
    );
    expect(unauthRes.status).toBe(401);
  });

  test("supports route aliases: PUT and settings routes", async () => {
    const { request, customRoles } = setup();

    customRoles.push({
      id: "role-1",
      organizationId: "org-a",
      name: "Papel Original",
      description: "Desc",
      capabilities: ["patients:read"],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Alias 1: PUT /organizations/:orgSlug/roles/:roleId
    const putRes = await request("/organizations/clinica-vida/roles/role-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Papel Atualizado PUT",
      }),
    });
    expect(putRes.status).toBe(200);
    expect(customRoles[0]?.name).toBe("Papel Atualizado PUT");

    // Alias 2: PATCH /organizations/:orgSlug/settings/roles/:id
    const settingsOrgRes = await request(
      "/organizations/clinica-vida/settings/roles/role-1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Papel Settings Org",
        }),
      },
    );
    expect(settingsOrgRes.status).toBe(200);
    expect(customRoles[0]?.name).toBe("Papel Settings Org");

    // Alias 3: PATCH /settings/roles/:id
    const globalSettingsRes = await request("/settings/roles/role-1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Papel Global Settings",
      }),
    });
    expect(globalSettingsRes.status).toBe(200);
    expect(customRoles[0]?.name).toBe("Papel Global Settings");
  });
});
