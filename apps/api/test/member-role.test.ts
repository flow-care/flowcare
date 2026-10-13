import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type {
  MembershipRole,
  MembershipStatus,
} from "../src/generated/prisma/client";
import { signSessionToken } from "../src/services/session-token";

const env: Env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "member-role-test-secret-1234567890",
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

interface UserRecord {
  id: string;
  email: string;
  fullName: string;
  professionalRole: string | null;
  professionalTitle: string | null;
  registrationNumber: string | null;
}

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
  version: number;
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
  const users = new Map<string, UserRecord>([
    [
      "user-admin-1",
      {
        id: "user-admin-1",
        email: "admin1@alpha.com",
        fullName: "Admin Um",
        professionalRole: null,
        professionalTitle: null,
        registrationNumber: null,
      },
    ],
    [
      "user-admin-2",
      {
        id: "user-admin-2",
        email: "admin2@alpha.com",
        fullName: "Admin Dois",
        professionalRole: "CLINICAL",
        professionalTitle: "Médico Clínico",
        registrationNumber: "CRM/SP 111111",
      },
    ],
    [
      "user-prof",
      {
        id: "user-prof",
        email: "prof@alpha.com",
        fullName: "Dr. Profissional",
        professionalRole: "CLINICAL",
        professionalTitle: "Médico Cardiologista",
        registrationNumber: "CRM/SP 222222",
      },
    ],
    [
      "user-recep-no-cred",
      {
        id: "user-recep-no-cred",
        email: "recep@alpha.com",
        fullName: "Maria Recepcionista",
        professionalRole: "RECEPTION",
        professionalTitle: null,
        registrationNumber: null,
      },
    ],
    [
      "user-other-org",
      {
        id: "user-other-org",
        email: "admin@beta.com",
        fullName: "Admin Beta",
        professionalRole: null,
        professionalTitle: null,
        registrationNumber: null,
      },
    ],
    [
      "user-suspended",
      {
        id: "user-suspended",
        email: "suspenso@alpha.com",
        fullName: "Admin Suspenso",
        professionalRole: null,
        professionalTitle: null,
        registrationNumber: null,
      },
    ],
  ]);

  const organizations = new Map<string, OrgRecord>([
    ["org-a", { id: "org-a", name: "Clínica Alpha", slug: "clinica-alpha" }],
    ["org-b", { id: "org-b", name: "Clínica Beta", slug: "clinica-beta" }],
  ]);

  const memberships: MembershipRecord[] = [
    {
      id: "mem-admin-1",
      userId: "user-admin-1",
      organizationId: "org-a",
      role: "ADMIN",
      status: "ACTIVE",
      version: 1,
      createdAt: new Date("2026-01-01T10:00:00Z"),
      updatedAt: new Date("2026-01-01T10:00:00Z"),
    },
    {
      id: "mem-admin-2",
      userId: "user-admin-2",
      organizationId: "org-a",
      role: "ADMIN",
      status: "ACTIVE",
      version: 1,
      createdAt: new Date("2026-01-02T10:00:00Z"),
      updatedAt: new Date("2026-01-02T10:00:00Z"),
    },
    {
      id: "mem-prof",
      userId: "user-prof",
      organizationId: "org-a",
      role: "PROFESSIONAL",
      status: "ACTIVE",
      version: 1,
      createdAt: new Date("2026-01-03T10:00:00Z"),
      updatedAt: new Date("2026-01-03T10:00:00Z"),
    },
    {
      id: "mem-recep-no-cred",
      userId: "user-recep-no-cred",
      organizationId: "org-a",
      role: "RECEPTIONIST",
      status: "ACTIVE",
      version: 1,
      createdAt: new Date("2026-01-04T10:00:00Z"),
      updatedAt: new Date("2026-01-04T10:00:00Z"),
    },
    {
      id: "mem-suspended",
      userId: "user-suspended",
      organizationId: "org-a",
      role: "ADMIN",
      status: "SUSPENDED",
      version: 1,
      createdAt: new Date("2026-01-05T10:00:00Z"),
      updatedAt: new Date("2026-01-05T10:00:00Z"),
    },
    {
      id: "mem-other-org",
      userId: "user-other-org",
      organizationId: "org-b",
      role: "ADMIN",
      status: "ACTIVE",
      version: 1,
      createdAt: new Date("2026-01-06T10:00:00Z"),
      updatedAt: new Date("2026-01-06T10:00:00Z"),
    },
  ];

  const auditLogs: AuditRecord[] = [];

  const findMembership = (where: Record<string, any>) => {
    return (
      memberships.find((m) => {
        if (where.id && m.id !== where.id) return false;
        if (where.userId && m.userId !== where.userId) return false;
        if (where.organizationId && m.organizationId !== where.organizationId)
          return false;
        if (typeof where.status === "string" && m.status !== where.status)
          return false;
        if (where.organization?.slug) {
          const org = organizations.get(m.organizationId);
          if (!org || org.slug !== where.organization.slug) return false;
        }
        return true;
      }) ?? null
    );
  };

  const createMembershipResponse = (m: MembershipRecord) => {
    const org = organizations.get(m.organizationId)!;
    const usr = users.get(m.userId)!;
    return {
      ...m,
      organization: { ...org },
      user: { ...usr },
    };
  };

  const prisma: any = {
    session: {
      findFirst: async ({ where }: { where: Record<string, any> }) => {
        return { id: `session-${where.userId}`, lastActiveAt: new Date() };
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return users.get(where.id) ?? null;
      },
      findFirst: async ({ where }: { where: Record<string, any> }) => {
        if (where.id) return users.get(where.id) ?? null;
        return null;
      },
    },
    membership: {
      findFirst: async ({ where }: { where: Record<string, any> }) => {
        const found = findMembership(where);
        if (!found) return null;
        return createMembershipResponse(found);
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const found = memberships.find((m) => m.id === where.id);
        if (!found) return null;
        return createMembershipResponse(found);
      },
      count: async ({ where }: { where: Record<string, any> }) => {
        let count = 0;
        for (const m of memberships) {
          if (where.organizationId && m.organizationId !== where.organizationId)
            continue;
          if (where.status && m.status !== where.status) continue;
          if (where.role?.in && !where.role.in.includes(m.role)) continue;
          if (typeof where.role === "string" && m.role !== where.role) continue;
          count++;
        }
        return count;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, any>;
        data: Record<string, any>;
      }) => {
        const found = memberships.find((m) => {
          if (where.id && m.id !== where.id) return false;
          if (where.organizationId && m.organizationId !== where.organizationId)
            return false;
          if (where.version !== undefined && m.version !== where.version)
            return false;
          return true;
        });
        if (!found) return { count: 0 };
        if (data.role) found.role = data.role;
        if (data.version?.increment) {
          found.version += data.version.increment;
        } else if (typeof data.version === "number") {
          found.version = data.version;
        }
        found.updatedAt = new Date();
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, any> }) => {
        const record = {
          id: `audit-${auditLogs.length + 1}`,
          ...data,
        } as AuditRecord;
        auditLogs.push(record);
        return record;
      },
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      return fn(prisma);
    },
  };

  const app = createApp(env, {
    prisma,
    mailer: { send: async () => {} },
  });

  const tokenFor = (userId: string) =>
    signSessionToken(
      { sid: `session-${userId}`, sub: userId },
      env.jwtSecret,
      3600,
    );

  const request = (
    path: string,
    init: RequestInit & { userId?: string | null } = {},
  ) => {
    const { userId = "user-admin-1", headers, ...rest } = init;
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
    prisma,
    users,
    memberships,
    organizations,
    auditLogs,
  };
}

describe("Task #317: Member Role Update with Last Administrator Protection and Optimistic Locking", () => {
  test("valid role change promotes receptionist to admin with version increment and audit log", async () => {
    const { request, auditLogs, memberships } = setup();

    const res = await request(
      "/organizations/clinica-alpha/members/mem-recep-no-cred/role",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "ADMIN",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toBe("mem-recep-no-cred");
    expect(body.role).toBe("ADMIN");
    expect(body.version).toBe(2);
    expect(body.member.role).toBe("ADMIN");
    expect(body.member.version).toBe(2);

    // Verify in-memory state updated
    const updatedMem = memberships.find((m) => m.id === "mem-recep-no-cred");
    expect(updatedMem?.role).toBe("ADMIN");
    expect(updatedMem?.version).toBe(2);

    // Verify AuditLog was recorded
    expect(auditLogs.length).toBe(1);
    const log = auditLogs[0]!;
    expect(log.action).toBe("MEMBER_ROLE_CHANGED");
    expect(log.targetType).toBe("MEMBERSHIP");
    expect(log.targetId).toBe("mem-recep-no-cred");
    expect(log.organizationId).toBe("org-a");
    expect(log.actorUserId).toBe("user-admin-1");
    expect(log.metadata.targetUserId).toBe("user-recep-no-cred");
    expect(log.metadata.previousRole).toBe("RECEPTIONIST");
    expect(log.metadata.newRole).toBe("ADMIN");
    expect(log.metadata.version).toBe(2);
  });

  test("rejects self-role change with 403 FORBIDDEN", async () => {
    const { request, auditLogs, memberships } = setup();

    // user-admin-1 attempts to alter their own membership (mem-admin-1)
    const res = await request(
      "/organizations/clinica-alpha/members/mem-admin-1/role",
      {
        method: "PATCH",
        userId: "user-admin-1",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "PROFESSIONAL",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe(
      "Não é permitido alterar o próprio papel por esta rota.",
    );

    // Verify state was not modified
    const mem = memberships.find((m) => m.id === "mem-admin-1");
    expect(mem?.role).toBe("ADMIN");
    expect(mem?.version).toBe(1);
    expect(auditLogs.length).toBe(0);
  });

  test("allows admin demotion when another active admin remains in the organization", async () => {
    const { request, auditLogs, memberships } = setup();

    // user-admin-1 alters user-admin-2 (who has clinical credentials) from ADMIN to PROFESSIONAL
    const res = await request(
      "/organizations/clinica-alpha/members/mem-admin-2/role",
      {
        method: "PATCH",
        userId: "user-admin-1",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "PROFESSIONAL",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.role).toBe("PROFESSIONAL");
    expect(body.version).toBe(2);

    const mem = memberships.find((m) => m.id === "mem-admin-2");
    expect(mem?.role).toBe("PROFESSIONAL");
    expect(mem?.version).toBe(2);

    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0]!.metadata.previousRole).toBe("ADMIN");
    expect(auditLogs[0]!.metadata.newRole).toBe("PROFESSIONAL");
  });

  test("rejects demotion of the last active administrator with 409 LAST_ADMIN_REQUIRED", async () => {
    const { prisma, memberships } = setup();

    // In org-a, mem-admin-1 is suspended, leaving mem-admin-2 as the ONLY active admin
    const mem1 = memberships.find((m) => m.id === "mem-admin-1")!;
    mem1.status = "SUSPENDED";

    const mem2 = memberships.find((m) => m.id === "mem-admin-2")!;
    expect(mem2.role).toBe("ADMIN");
    expect(mem2.status).toBe("ACTIVE");

    const { TeamService } = await import("../src/modules/team/service");
    const service = new TeamService(prisma);

    // Attempting to demote the sole active admin mem-admin-2 to RECEPTIONIST
    await expect(
      service.updateMemberRole({
        organizationId: "org-a",
        actorUserId: "user-admin-1",
        memberId: "mem-admin-2",
        role: "RECEPTIONIST",
        version: mem2.version,
      }),
    ).rejects.toThrow("A clínica deve manter ao menos um administrador ativo.");

    // Verify exact ApiError properties
    try {
      await service.updateMemberRole({
        organizationId: "org-a",
        actorUserId: "user-admin-1",
        memberId: "mem-admin-2",
        role: "PROFESSIONAL",
        version: mem2.version,
      });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err.code).toBe("LAST_ADMIN_REQUIRED");
      expect(err.httpStatus).toBe(409);
      expect(err.message).toBe(
        "A clínica deve manter ao menos um administrador ativo.",
      );
    }

    // Membership remained unchanged
    expect(mem2.role).toBe("ADMIN");
    expect(mem2.version).toBe(1);
  });

  test("rejects assignment of clinical role when user lacks professional credentials with 422 CLINICAL_QUALIFICATION_REQUIRED", async () => {
    const { request, auditLogs, memberships } = setup();

    // user-recep-no-cred has no registrationNumber or professionalTitle
    const res = await request(
      "/organizations/clinica-alpha/members/mem-recep-no-cred/role",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "PROFESSIONAL",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("CLINICAL_QUALIFICATION_REQUIRED");
    expect(body.error.message).toBe(
      "Dados profissionais exigidos para atribuição de papel clínico.",
    );

    // Also test assigning ADMIN_PROFESSIONAL to user without clinical credentials
    const resAdminProf = await request(
      "/organizations/clinica-alpha/members/mem-recep-no-cred/role",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "ADMIN_PROFESSIONAL",
          version: 1,
        }),
      },
    );

    expect(resAdminProf.status).toBe(422);
    const bodyAdminProf = (await resAdminProf.json()) as any;
    expect(bodyAdminProf.error.code).toBe("CLINICAL_QUALIFICATION_REQUIRED");

    // State not modified
    const mem = memberships.find((m) => m.id === "mem-recep-no-cred");
    expect(mem?.role).toBe("RECEPTIONIST");
    expect(mem?.version).toBe(1);
    expect(auditLogs.length).toBe(0);
  });

  test("allows assigning clinical role when user has valid professional credentials", async () => {
    const { request, auditLogs, memberships } = setup();

    // user-admin-2 has CRM/SP 111111 and "Médico Clínico", currently ADMIN
    // Promoted to ADMIN_PROFESSIONAL
    const res = await request(
      "/organizations/clinica-alpha/members/mem-admin-2/role",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "ADMIN_PROFESSIONAL",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.role).toBe("ADMIN_PROFESSIONAL");
    expect(body.version).toBe(2);

    const mem = memberships.find((m) => m.id === "mem-admin-2");
    expect(mem?.role).toBe("ADMIN_PROFESSIONAL");
    expect(mem?.version).toBe(2);
    expect(auditLogs.length).toBe(1);
  });

  test("rejects stale version with 409 VERSION_CONFLICT under concurrent edits", async () => {
    const { request, auditLogs } = setup();

    // First update succeeds (version 1 -> 2)
    const res1 = await request(
      "/organizations/clinica-alpha/members/mem-recep-no-cred/role",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "ADMIN",
          version: 1,
        }),
      },
    );
    expect(res1.status).toBe(200);
    expect(auditLogs.length).toBe(1);

    // Concurrent/stale update attempts to update using outdated version 1
    const res2 = await request(
      "/organizations/clinica-alpha/members/mem-recep-no-cred/role",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "RECEPTIONIST",
          version: 1, // stale! current is 2
        }),
      },
    );

    expect(res2.status).toBe(409);
    const body2 = (await res2.json()) as any;
    expect(body2.error.code).toBe("VERSION_CONFLICT");
    expect(body2.error.message).toContain("modificado por outro usuário");
    expect(auditLogs.length).toBe(1); // no new audit log recorded
  });

  test("enforces cross-clinic isolation returning 404 NOT_FOUND for member belonging to another organization", async () => {
    const { request, auditLogs } = setup();

    // mem-other-org belongs to clinica-beta, not clinica-alpha
    const res = await request(
      "/organizations/clinica-alpha/members/mem-other-org/role",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "RECEPTIONIST",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("NOT_FOUND");
    expect(auditLogs.length).toBe(0);
  });

  test("returns 404 NOT_FOUND for non-existent member ID", async () => {
    const { request } = setup();

    const res = await request(
      "/organizations/clinica-alpha/members/non-existent-id/role",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "ADMIN",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("rejects non-admin role with 403 PERMISSION_DENIED under RBAC rules", async () => {
    const { request } = setup();

    // user-prof has PROFESSIONAL role, not team:manage
    const res = await request(
      "/organizations/clinica-alpha/members/mem-recep-no-cred/role",
      {
        method: "PATCH",
        userId: "user-prof",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "ADMIN",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("PERMISSION_DENIED");
    expect(body.error.details?.requiredPermission).toBe("team:manage");
  });

  test("rejects RECEPTIONIST role with 403 PERMISSION_DENIED", async () => {
    const { request } = setup();

    const res = await request(
      "/organizations/clinica-alpha/members/mem-prof/role",
      {
        method: "PATCH",
        userId: "user-recep-no-cred",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "ADMIN",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("PERMISSION_DENIED");
  });

  test("rejects suspended caller with 403 MEMBERSHIP_INACTIVE", async () => {
    const { request } = setup();

    const res = await request(
      "/organizations/clinica-alpha/members/mem-prof/role",
      {
        method: "PATCH",
        userId: "user-suspended",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "ADMIN",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("MEMBERSHIP_INACTIVE");
  });

  test("rejects modifying suspended target member with 403 MEMBERSHIP_INACTIVE", async () => {
    const { request } = setup();

    const res = await request(
      "/organizations/clinica-alpha/members/mem-suspended/role",
      {
        method: "PATCH",
        userId: "user-admin-1",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "RECEPTIONIST",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("MEMBERSHIP_INACTIVE");
  });

  test("rejects unauthenticated request with 401 UNAUTHENTICATED", async () => {
    const { request } = setup();

    const res = await request(
      "/organizations/clinica-alpha/members/mem-prof/role",
      {
        method: "PATCH",
        userId: null, // no authorization header
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "ADMIN",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  test("rejects invalid role with 400 VALIDATION_ERROR", async () => {
    const { request } = setup();

    const res = await request(
      "/organizations/clinica-alpha/members/mem-prof/role",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "SUPER_ADMIN",
          version: 1,
        }),
      },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects missing version with 400 VALIDATION_ERROR", async () => {
    const { request } = setup();

    const res = await request(
      "/organizations/clinica-alpha/members/mem-prof/role",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "ADMIN",
        }),
      },
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("updated role takes effect immediately on the next request", async () => {
    const { request, memberships } = setup();

    // Promoted recep to ADMIN
    const updateRes = await request(
      "/organizations/clinica-alpha/members/mem-recep-no-cred/role",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "ADMIN",
          version: 1,
        }),
      },
    );
    expect(updateRes.status).toBe(200);

    // Verify user-recep-no-cred now has team:manage capability on the subsequent request
    const subsequentRes = await request(
      "/organizations/clinica-alpha/members/mem-prof/role",
      {
        method: "PATCH",
        userId: "user-recep-no-cred",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "RECEPTIONIST",
          version: 1,
        }),
      },
    );

    // Should succeed because user-recep-no-cred is now an ADMIN!
    expect(subsequentRes.status).toBe(200);
    const body = (await subsequentRes.json()) as any;
    expect(body.role).toBe("RECEPTIONIST");
    expect(body.version).toBe(2);

    const memProf = memberships.find((m) => m.id === "mem-prof");
    expect(memProf?.role).toBe("RECEPTIONIST");
    expect(memProf?.version).toBe(2);
  });
});
