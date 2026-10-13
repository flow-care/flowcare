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
  jwtSecret: "member-removal-test-secret-1234567890",
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
  activeOrganizationId: string | null;
}

interface OrgRecord {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  detailsVersion: number;
  detailsCompletedAt: Date | null;
  legalName?: string | null;
  taxId?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  postalCode?: string | null;
  state?: string | null;
  city?: string | null;
  district?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  addressComplement?: string | null;
  logoContentType?: string | null;
  logoSizeBytes?: number | null;
  logoUpdatedAt?: Date | null;
}

interface MembershipRecord {
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: Date;
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

interface ConsultationRecord {
  id: string;
  organizationId: string;
  patientId: string;
  professionalId: string;
  scheduledAt: Date;
  status: string;
}

interface ClinicalDocumentRecord {
  id: string;
  organizationId: string;
  patientId: string;
  authorId: string;
  title: string;
  content: string;
  status: string;
}

function createFixture() {
  const users = new Map<string, UserRecord>([
    [
      "user-admin",
      {
        id: "user-admin",
        email: "admin@clinica-vida.com",
        fullName: "Dra. Administradora",
        activeOrganizationId: "org-a",
      },
    ],
    [
      "user-admin-2",
      {
        id: "user-admin-2",
        email: "admin2@clinica-vida.com",
        fullName: "Dr. Segundo Admin",
        activeOrganizationId: "org-a",
      },
    ],
    [
      "user-admin-prof",
      {
        id: "user-admin-prof",
        email: "adminprof@clinica-vida.com",
        fullName: "Dr. Admin e Profissional",
        activeOrganizationId: "org-a",
      },
    ],
    [
      "user-doctor",
      {
        id: "user-doctor",
        email: "medico@clinica-vida.com",
        fullName: "Dr. João Médico",
        activeOrganizationId: "org-a",
      },
    ],
    [
      "user-receptionist",
      {
        id: "user-receptionist",
        email: "recepcao@clinica-vida.com",
        fullName: "Maria Recepcionista",
        activeOrganizationId: "org-a",
      },
    ],
    [
      "user-foreign",
      {
        id: "user-foreign",
        email: "outro@clinica-sul.com",
        fullName: "Carlos Outra Clínica",
        activeOrganizationId: "org-b",
      },
    ],
  ]);

  const organizations = new Map<string, OrgRecord>([
    [
      "org-a",
      {
        id: "org-a",
        name: "Clínica Vida",
        slug: "clinica-vida",
        ownerId: "user-admin",
        detailsVersion: 0,
        detailsCompletedAt: new Date(),
        legalName: "Clínica Vida Ltda",
        taxId: "12345678000100",
        contactEmail: "contato@clinica-vida.com",
        contactPhone: "11988887777",
        postalCode: "01310100",
        state: "SP",
        city: "São Paulo",
        district: "Bela Vista",
        street: "Avenida Paulista",
        streetNumber: "1000",
        addressComplement: "Sala 101",
        logoContentType: null,
        logoSizeBytes: null,
        logoUpdatedAt: null,
      },
    ],
    [
      "org-b",
      {
        id: "org-b",
        name: "Clínica Sul",
        slug: "clinica-sul",
        ownerId: "user-foreign",
        detailsVersion: 0,
        detailsCompletedAt: new Date(),
        legalName: "Clínica Sul Ltda",
        taxId: "87654321000199",
        contactEmail: "contato@clinica-sul.com",
        contactPhone: "11977776666",
        postalCode: "04001000",
        state: "SP",
        city: "São Paulo",
        district: "Vila Mariana",
        street: "Rua Domingos de Morais",
        streetNumber: "500",
        addressComplement: "",
        logoContentType: null,
        logoSizeBytes: null,
        logoUpdatedAt: null,
      },
    ],
  ]);

  const memberships: MembershipRecord[] = [
    {
      id: "mem-admin",
      userId: "user-admin",
      organizationId: "org-a",
      role: "ADMIN",
      status: "ACTIVE",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    {
      id: "mem-admin-2",
      userId: "user-admin-2",
      organizationId: "org-a",
      role: "ADMIN",
      status: "ACTIVE",
      createdAt: new Date("2026-01-02T00:00:00Z"),
    },
    {
      id: "mem-admin-prof",
      userId: "user-admin-prof",
      organizationId: "org-a",
      role: "ADMIN_PROFESSIONAL",
      status: "ACTIVE",
      createdAt: new Date("2026-01-03T00:00:00Z"),
    },
    {
      id: "mem-doctor",
      userId: "user-doctor",
      organizationId: "org-a",
      role: "PROFESSIONAL",
      status: "ACTIVE",
      createdAt: new Date("2026-01-04T00:00:00Z"),
    },
    {
      id: "mem-receptionist",
      userId: "user-receptionist",
      organizationId: "org-a",
      role: "RECEPTIONIST",
      status: "ACTIVE",
      createdAt: new Date("2026-01-05T00:00:00Z"),
    },
    {
      id: "mem-doctor-in-org-b",
      userId: "user-doctor",
      organizationId: "org-b",
      role: "PROFESSIONAL",
      status: "ACTIVE",
      createdAt: new Date("2026-01-06T00:00:00Z"),
    },
    {
      id: "mem-foreign-admin",
      userId: "user-foreign",
      organizationId: "org-b",
      role: "ADMIN",
      status: "ACTIVE",
      createdAt: new Date("2026-01-07T00:00:00Z"),
    },
  ];

  const auditLogs: AuditRecord[] = [];

  const consultations: ConsultationRecord[] = [
    {
      id: "consult-1",
      organizationId: "org-a",
      patientId: "patient-1",
      professionalId: "user-doctor",
      scheduledAt: new Date("2026-05-10T10:00:00Z"),
      status: "COMPLETED",
    },
  ];

  const clinicalDocuments: ClinicalDocumentRecord[] = [
    {
      id: "doc-1",
      organizationId: "org-a",
      patientId: "patient-1",
      authorId: "user-doctor",
      title: "Receita de Medicamentos",
      content: "Amoxicilina 500mg",
      status: "ISSUED",
    },
  ];

  const matchMembership = (where: Record<string, any>, m: MembershipRecord) => {
    if (where.id && m.id !== where.id) return false;
    if (where.userId && m.userId !== where.userId) return false;
    if (where.organizationId && m.organizationId !== where.organizationId)
      return false;
    if (typeof where.status === "string" && m.status !== where.status)
      return false;
    if (where.role) {
      if (typeof where.role === "string" && m.role !== where.role) return false;
      if (
        Array.isArray(where.role?.in) &&
        !where.role.in.includes(m.role as any)
      ) {
        return false;
      }
    }
    if (where.organization?.slug) {
      const org = organizations.get(m.organizationId);
      if (!org || org.slug !== where.organization.slug) return false;
    }
    if (Array.isArray(where.OR)) {
      const anyOr = where.OR.some((orClause: Record<string, any>) =>
        matchMembership(orClause, m),
      );
      if (!anyOr) return false;
    }
    return true;
  };

  const prismaMock = {
    session: {
      findFirst: async () => ({ id: "session-1", lastActiveAt: new Date() }),
      updateMany: async () => ({ count: 1 }),
    },
    user: {
      findFirst: async ({ where }: any) => {
        return (
          Array.from(users.values()).find((u) => {
            if (where.id && u.id !== where.id) return false;
            if (where.email && u.email !== where.email) return false;
            return true;
          }) ?? null
        );
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const u of users.values()) {
          if (where.id && u.id !== where.id) continue;
          if (
            where.activeOrganizationId &&
            u.activeOrganizationId !== where.activeOrganizationId
          )
            continue;
          if (data.activeOrganizationId !== undefined) {
            u.activeOrganizationId = data.activeOrganizationId;
          }
          count++;
        }
        return { count };
      },
    },
    organization: {
      findFirst: async ({ where }: any) => {
        return (
          Array.from(organizations.values()).find((o) => {
            if (where.id && o.id !== where.id) return false;
            if (where.slug && o.slug !== where.slug) return false;
            return true;
          }) ?? null
        );
      },
    },
    membership: {
      findFirst: async ({ where }: any) => {
        const found = memberships.find((m) => matchMembership(where, m));
        if (!found) return null;
        const org = organizations.get(found.organizationId);
        const user = users.get(found.userId);
        return {
          ...found,
          organization: org ? { ...org } : undefined,
          user: user
            ? { id: user.id, fullName: user.fullName, email: user.email }
            : undefined,
        };
      },
      findMany: async ({ where }: any) => {
        return memberships
          .filter((m) => (where ? matchMembership(where, m) : true))
          .map((m) => {
            const org = organizations.get(m.organizationId);
            const user = users.get(m.userId);
            return {
              ...m,
              organization: org ? { ...org } : undefined,
              user: user
                ? { id: user.id, fullName: user.fullName, email: user.email }
                : undefined,
            };
          });
      },
      count: async ({ where }: any) => {
        return memberships.filter((m) => matchMembership(where, m)).length;
      },
      update: async ({ where, data }: any) => {
        const target = memberships.find((m) => m.id === where.id);
        if (!target) throw new Error("Membership not found for update");
        if (data.status) target.status = data.status;
        return { ...target };
      },
    },
    auditLog: {
      create: async ({ data }: { data: AuditRecord }) => {
        const record = { id: `audit-${auditLogs.length + 1}`, ...data };
        auditLogs.push(record);
        return record;
      },
      findMany: async ({ where }: any) => {
        return auditLogs.filter((a) => {
          if (where.organizationId && a.organizationId !== where.organizationId)
            return false;
          if (where.action && a.action !== where.action) return false;
          return true;
        });
      },
    },
    consultation: {
      findMany: async ({ where }: any) => {
        return consultations.filter((c) => {
          if (where.organizationId && c.organizationId !== where.organizationId)
            return false;
          if (where.patientId && c.patientId !== where.patientId) return false;
          return true;
        });
      },
    },
    clinicalDocument: {
      findMany: async ({ where }: any) => {
        return clinicalDocuments.filter((d) => {
          if (where.organizationId && d.organizationId !== where.organizationId)
            return false;
          if (where.patientId && d.patientId !== where.patientId) return false;
          return true;
        });
      },
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(prismaMock),
  };

  const mailerMock = {
    send: async () => {},
  };

  const app = createApp(env, {
    prisma: prismaMock as any,
    mailer: mailerMock as any,
  });

  const authHeader = (userId: string) => {
    const token = signSessionToken(
      { sub: userId, sid: "session-1" },
      env.jwtSecret,
      3600,
    );
    return {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };
  };

  return {
    app,
    users,
    organizations,
    memberships,
    auditLogs,
    consultations,
    clinicalDocuments,
    authHeader,
  };
}

describe("Team Member Removal (#318)", () => {
  test("enforces RBAC: non-admin roles (RECEPTIONIST, PROFESSIONAL) are denied with 403 PERMISSION_DENIED", async () => {
    const f = createFixture();

    // 1. Receptionist attempts to remove doctor
    const resRecep = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-doctor",
        {
          method: "DELETE",
          headers: f.authHeader("user-receptionist"),
        },
      ),
    );
    expect(resRecep.status).toBe(403);
    const bodyRecep = await resRecep.json();
    expect(bodyRecep).toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        details: { requiredPermission: "team:manage" },
      },
    });

    // 2. Doctor attempts to remove receptionist
    const resDoc = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-receptionist",
        {
          method: "DELETE",
          headers: f.authHeader("user-doctor"),
        },
      ),
    );
    expect(resDoc.status).toBe(403);
    const bodyDoc = await resDoc.json();
    expect(bodyDoc).toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        details: { requiredPermission: "team:manage" },
      },
    });

    // Ensure neither member was touched
    const docMem = f.memberships.find((m) => m.id === "mem-doctor");
    const recepMem = f.memberships.find((m) => m.id === "mem-receptionist");
    expect(docMem?.status).toBe("ACTIVE");
    expect(recepMem?.status).toBe("ACTIVE");
  });

  test("enforces multi-tenant isolation: member belonging to another clinic returns 404 NOT_FOUND", async () => {
    const f = createFixture();

    // Admin of clinica-vida attempts to remove foreign member from clinica-sul
    const res = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-foreign-admin",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: "NOT_FOUND" },
    });

    // Foreign member remains active in org-b
    const foreignMem = f.memberships.find((m) => m.id === "mem-foreign-admin");
    expect(foreignMem?.status).toBe("ACTIVE");
  });

  test("enforces multi-tenant isolation: non-existent memberId returns 404 NOT_FOUND", async () => {
    const f = createFixture();

    const res = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/non-existent-member",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  test("protects the last remaining administrator: blocked with 409 LAST_ADMIN_REQUIRED", async () => {
    const f = createFixture();

    // Leave only one active admin in clinica-vida by suspending the other admins
    const admin2 = f.memberships.find((m) => m.id === "mem-admin-2")!;
    admin2.status = "SUSPENDED";
    const adminProf = f.memberships.find((m) => m.id === "mem-admin-prof")!;
    adminProf.status = "SUSPENDED";

    // Now user-admin is the ONLY active admin in clinica-vida
    const res = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-admin",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({
      error: {
        code: "LAST_ADMIN_REQUIRED",
        message:
          "Não é possível remover o único administrador remanescente da organização.",
      },
    });

    // Membership remains ACTIVE
    const adminMem = f.memberships.find((m) => m.id === "mem-admin")!;
    expect(adminMem.status).toBe("ACTIVE");
  });

  test("allows removing an admin when another active admin remains, and blocks the last one", async () => {
    const f = createFixture();

    // Currently org-a has mem-admin, mem-admin-2, mem-admin-prof (3 active admins)
    // Suspend mem-admin-prof to have exactly 2 active admins
    f.memberships.find((m) => m.id === "mem-admin-prof")!.status = "SUSPENDED";

    // 1. Admin 1 removes Admin 2 -> Succeeds because Admin 1 remains
    const res1 = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-admin-2",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1).toMatchObject({
      success: true,
      memberId: "mem-admin-2",
    });

    const admin2Mem = f.memberships.find((m) => m.id === "mem-admin-2")!;
    expect(admin2Mem.status).toBe("SUSPENDED");

    // 2. Now only Admin 1 is active. Attempting to remove Admin 1 must fail
    const res2 = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-admin",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(res2.status).toBe(409);
    const body2 = await res2.json();
    expect(body2).toMatchObject({
      error: { code: "LAST_ADMIN_REQUIRED" },
    });
    expect(f.memberships.find((m) => m.id === "mem-admin")!.status).toBe(
      "ACTIVE",
    );
  });

  test("considers ADMIN_PROFESSIONAL as an active admin for last administrator check", async () => {
    const f = createFixture();

    // Keep exactly 1 ADMIN and 1 ADMIN_PROFESSIONAL
    f.memberships.find((m) => m.id === "mem-admin-2")!.status = "SUSPENDED";

    // 1. Removing ADMIN leaves ADMIN_PROFESSIONAL active -> Allowed
    const res1 = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-admin",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin-prof"),
        },
      ),
    );
    expect(res1.status).toBe(200);
    expect(f.memberships.find((m) => m.id === "mem-admin")!.status).toBe(
      "SUSPENDED",
    );

    // 2. Now only ADMIN_PROFESSIONAL is active admin. Removing it is blocked
    const res2 = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-admin-prof",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin-prof"),
        },
      ),
    );
    expect(res2.status).toBe(409);
    const body2 = await res2.json();
    expect(body2).toMatchObject({
      error: { code: "LAST_ADMIN_REQUIRED" },
    });
  });

  test("removing a receptionist or doctor deactivates membership and immediately blocks clinic access (403 MEMBERSHIP_INACTIVE)", async () => {
    const f = createFixture();

    // 1. Admin removes receptionist
    const resRemove = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-receptionist",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(resRemove.status).toBe(200);
    const bodyRemove = await resRemove.json();
    expect(bodyRemove).toMatchObject({
      success: true,
      memberId: "mem-receptionist",
    });

    const recepMem = f.memberships.find((m) => m.id === "mem-receptionist")!;
    expect(recepMem.status).toBe("SUSPENDED");

    // 2. Receptionist attempts to access clinic settings -> 403 MEMBERSHIP_INACTIVE
    const resAccess = await f.app.handle(
      new Request("http://localhost/api/organizations/clinica-vida/settings", {
        method: "GET",
        headers: f.authHeader("user-receptionist"),
      }),
    );
    expect(resAccess.status).toBe(403);
    const bodyAccess = await resAccess.json();
    expect(bodyAccess).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });

    // 3. User's activeOrganizationId preference for this clinic was cleared
    const userRecep = f.users.get("user-receptionist")!;
    expect(userRecep.activeOrganizationId).toBeNull();
  });

  test("historical clinical records created by removed professional remain intact and readable", async () => {
    const f = createFixture();

    // 1. Doctor has a consultation and clinical document in clinica-vida
    expect(f.consultations.length).toBe(1);
    expect(f.consultations[0]!.professionalId).toBe("user-doctor");
    expect(f.clinicalDocuments.length).toBe(1);
    expect(f.clinicalDocuments[0]!.authorId).toBe("user-doctor");

    // 2. Admin removes doctor
    const res = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-doctor",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(res.status).toBe(200);

    const doctorMem = f.memberships.find((m) => m.id === "mem-doctor")!;
    expect(doctorMem.status).toBe("SUSPENDED");

    // 3. Historical consultations and clinical documents remain intact
    expect(f.consultations.length).toBe(1);
    expect(f.consultations[0]!.professionalId).toBe("user-doctor");
    expect(f.clinicalDocuments.length).toBe(1);
    expect(f.clinicalDocuments[0]!.authorId).toBe("user-doctor");

    // 4. Removed doctor trying to access clinic is immediately blocked
    const resDoctorAccess = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/consultations",
        {
          method: "GET",
          headers: f.authHeader("user-doctor"),
        },
      ),
    );
    expect(resDoctorAccess.status).toBe(403);
    const bodyAccess = await resDoctorAccess.json();
    expect(bodyAccess).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });
  });

  test("removed user retains active membership and access to other clinics", async () => {
    const f = createFixture();

    // user-doctor belongs to org-a (clinica-vida) AND org-b (clinica-sul)
    const memOrgA = f.memberships.find(
      (m) => m.userId === "user-doctor" && m.organizationId === "org-a",
    )!;
    const memOrgB = f.memberships.find(
      (m) => m.userId === "user-doctor" && m.organizationId === "org-b",
    )!;
    expect(memOrgA.status).toBe("ACTIVE");
    expect(memOrgB.status).toBe("ACTIVE");

    // 1. Admin of clinica-vida removes user-doctor from clinica-vida
    const res = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-doctor",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(res.status).toBe(200);

    // Membership in org-a is SUSPENDED
    expect(memOrgA.status).toBe("SUSPENDED");

    // Membership in org-b remains ACTIVE
    expect(memOrgB.status).toBe("ACTIVE");

    // Global user record is intact
    const userDoc = f.users.get("user-doctor");
    expect(userDoc).toBeDefined();
    expect(userDoc?.email).toBe("medico@clinica-vida.com");

    // user-doctor can still access clinica-sul
    const resOrgBAccess = await f.app.handle(
      new Request("http://localhost/api/organizations/clinica-sul", {
        method: "GET",
        headers: f.authHeader("user-doctor"),
      }),
    );
    expect(resOrgBAccess.status).toBe(200);
  });

  test("records MEMBER_REMOVED in AuditLog in the same transaction", async () => {
    const f = createFixture();

    const res = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-receptionist",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(res.status).toBe(200);

    // Verify audit log entry
    const auditEntry = f.auditLogs.find((a) => a.action === "MEMBER_REMOVED");
    expect(auditEntry).toBeDefined();
    expect(auditEntry).toMatchObject({
      organizationId: "org-a",
      actorUserId: "user-admin",
      action: "MEMBER_REMOVED",
      targetType: "MEMBERSHIP",
      targetId: "mem-receptionist",
      metadata: {
        removedUserId: "user-receptionist",
        role: "RECEPTIONIST",
      },
    });
  });

  test("supports route aliases: /organizations/:orgSlug/settings/team/:memberId and /settings/team/:memberId", async () => {
    const f = createFixture();

    // 1. Alias: /organizations/:orgSlug/settings/team/:memberId
    const resAlias1 = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/settings/team/mem-receptionist",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(resAlias1.status).toBe(200);
    expect(f.memberships.find((m) => m.id === "mem-receptionist")!.status).toBe(
      "SUSPENDED",
    );

    // 2. Alias: /settings/team/:memberId
    const resAlias2 = await f.app.handle(
      new Request("http://localhost/api/settings/team/mem-doctor", {
        method: "DELETE",
        headers: f.authHeader("user-admin"),
      }),
    );
    expect(resAlias2.status).toBe(200);
    expect(f.memberships.find((m) => m.id === "mem-doctor")!.status).toBe(
      "SUSPENDED",
    );
  });

  test("accepts userId as memberId parameter seamlessly", async () => {
    const f = createFixture();

    // Pass user-receptionist instead of mem-receptionist
    const res = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/user-receptionist",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(res.status).toBe(200);
    expect(f.memberships.find((m) => m.id === "mem-receptionist")!.status).toBe(
      "SUSPENDED",
    );
  });

  test("is idempotent: removing an already suspended member returns confirmation without duplicate audit", async () => {
    const f = createFixture();

    // First removal
    const res1 = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-receptionist",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(res1.status).toBe(200);
    const auditsCountAfterFirst = f.auditLogs.filter(
      (a) => a.action === "MEMBER_REMOVED",
    ).length;
    expect(auditsCountAfterFirst).toBe(1);

    // Second removal
    const res2 = await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-receptionist",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );
    expect(res2.status).toBe(200);
    const auditsCountAfterSecond = f.auditLogs.filter(
      (a) => a.action === "MEMBER_REMOVED",
    ).length;
    expect(auditsCountAfterSecond).toBe(1);
  });

  test("GET /organizations/:orgSlug/members lists active clinic members", async () => {
    const f = createFixture();

    const res = await f.app.handle(
      new Request("http://localhost/api/organizations/clinica-vida/members", {
        method: "GET",
        headers: f.authHeader("user-admin"),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);

    const ids = body.data.map((m) => m.id);
    expect(ids).toContain("mem-admin");
    expect(ids).toContain("mem-doctor");
    expect(ids).toContain("mem-receptionist");
    // Does NOT contain members from other clinics
    expect(ids).not.toContain("mem-foreign-admin");

    // Remove receptionist and verify they no longer appear in active members
    await f.app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/members/mem-receptionist",
        {
          method: "DELETE",
          headers: f.authHeader("user-admin"),
        },
      ),
    );

    const resAfter = await f.app.handle(
      new Request("http://localhost/api/organizations/clinica-vida/members", {
        method: "GET",
        headers: f.authHeader("user-admin"),
      }),
    );
    const bodyAfter = (await resAfter.json()) as {
      data: Array<{ id: string }>;
    };
    const idsAfter = bodyAfter.data.map((m) => m.id);
    expect(idsAfter).not.toContain("mem-receptionist");
  });
});
