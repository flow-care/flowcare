import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { ListAuditLogsResponse } from "../src/modules/audit/model";
import { signSessionToken } from "../src/services/session-token";

const env: Env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "audit-logs-test-secret-key-328",
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

describe("Clinic Audit Logs API - Task #328", () => {
  const users = {
    "admin-1": {
      id: "admin-1",
      fullName: "Dr. Carlos Administrador",
      email: "carlos@clinica-alfa.com",
    },
    "admin-prof-1": {
      id: "admin-prof-1",
      fullName: "Dra. Renata Diretora Clinica",
      email: "renata@clinica-alfa.com",
    },
    "prof-1": {
      id: "prof-1",
      fullName: "Dr. Lucas Medico",
      email: "lucas@clinica-alfa.com",
    },
    "rec-1": {
      id: "rec-1",
      fullName: "Mariana Recepcionista",
      email: "mariana@clinica-alfa.com",
    },
    "suspended-1": {
      id: "suspended-1",
      fullName: "Ex Membro Suspenso",
      email: "suspenso@clinica-alfa.com",
    },
    "beta-admin-1": {
      id: "beta-admin-1",
      fullName: "Administrador Clinica Beta",
      email: "admin@clinica-beta.com",
    },
  };

  const auditEvents = [
    {
      id: "log-alfa-01",
      organizationId: "org-alfa",
      actorUserId: "admin-1",
      action: "PATIENT_CREATED",
      targetType: "PATIENT",
      targetId: "pat-101",
      metadata: {
        cpf: "123.456.789-00",
        fullTaxId: "123.456.789-00",
        taxId: "11.222.333/0001-81",
        creditCard: "4111111111111234",
        cardNumber: "5500000000000004",
        cvv: "999",
        password: "SuperSecretPassword123!",
        token: "bearer-auth-token-xyz",
        apiKey: "flowcare-api-key-999",
        safeCategory: "PEDIATRICS",
        ip: "200.180.10.5",
      },
      createdAt: new Date("2026-10-10T14:30:00.000Z"),
    },
    {
      id: "log-alfa-02",
      organizationId: "org-alfa",
      actorUserId: "admin-1",
      action: "APPOINTMENT_CREATED",
      targetType: "APPOINTMENT",
      targetId: "apt-201",
      metadata: {
        scheduledAt: "2026-10-15T09:00:00Z",
        slotDurationMinutes: 30,
      },
      createdAt: new Date("2026-10-09T10:00:00.000Z"),
    },
    {
      id: "log-alfa-03",
      organizationId: "org-alfa",
      actorUserId: "admin-prof-1",
      action: "APPOINTMENT_UPDATED",
      targetType: "APPOINTMENT",
      targetId: "apt-201",
      metadata: {
        previousStatus: "RESERVED",
        newStatus: "CONFIRMED",
      },
      createdAt: new Date("2026-10-08T16:00:00.000Z"),
    },
    {
      id: "log-alfa-04",
      organizationId: "org-alfa",
      actorUserId: "admin-1",
      action: "WEEKLY_SCHEDULE_UPDATED",
      targetType: "ORGANIZATION",
      targetId: "org-alfa",
      metadata: {
        timezone: "America/Sao_Paulo",
        ruleCount: 5,
      },
      createdAt: new Date("2026-10-05T08:00:00.000Z"),
    },
    {
      id: "log-alfa-05",
      organizationId: "org-alfa",
      actorUserId: "admin-prof-1",
      action: "DOCUMENT_ISSUED",
      targetType: "DOCUMENT",
      targetId: "doc-301",
      metadata: {
        documentType: "PRESCRIPTION",
        version: 1,
      },
      createdAt: new Date("2026-10-01T11:15:00.000Z"),
    },
    // Foreign organization events (Clinica Beta)
    {
      id: "log-beta-01",
      organizationId: "org-beta",
      actorUserId: "beta-admin-1",
      action: "PATIENT_CREATED",
      targetType: "PATIENT",
      targetId: "pat-999",
      metadata: {
        patientName: "Paciente Beta",
      },
      createdAt: new Date("2026-10-10T15:00:00.000Z"),
    },
    // Global event without organization
    {
      id: "log-global-01",
      organizationId: null,
      actorUserId: "admin-1",
      action: "AUTH_LOGIN_SUCCEEDED",
      targetType: "SESSION",
      targetId: "sess-1",
      metadata: { ip: "127.0.0.1" },
      createdAt: new Date("2026-10-10T12:00:00.000Z"),
    },
  ];

  function createMockPrisma() {
    return {
      session: {
        findFirst: async () => ({
          id: "sess-active",
          lastActiveAt: new Date(),
        }),
      },
      user: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
          return where.id.in
            .map((id) => users[id as keyof typeof users])
            .filter(Boolean);
        },
      },
      membership: {
        findFirst: async ({
          where,
        }: {
          where: { userId: string; organization: { slug: string } };
        }) => {
          if (where.organization.slug === "clinica-alfa") {
            if (where.userId === "admin-1") {
              return {
                id: "mem-alfa-admin",
                organizationId: "org-alfa",
                role: "ADMIN",
                status: "ACTIVE",
              };
            }
            if (where.userId === "admin-prof-1") {
              return {
                id: "mem-alfa-admin-prof",
                organizationId: "org-alfa",
                role: "ADMIN_PROFESSIONAL",
                status: "ACTIVE",
              };
            }
            if (where.userId === "prof-1") {
              return {
                id: "mem-alfa-prof",
                organizationId: "org-alfa",
                role: "PROFESSIONAL",
                status: "ACTIVE",
              };
            }
            if (where.userId === "rec-1") {
              return {
                id: "mem-alfa-rec",
                organizationId: "org-alfa",
                role: "RECEPTIONIST",
                status: "ACTIVE",
              };
            }
            if (where.userId === "suspended-1") {
              return {
                id: "mem-alfa-suspended",
                organizationId: "org-alfa",
                role: "ADMIN",
                status: "SUSPENDED",
              };
            }
          }
          if (where.organization.slug === "clinica-beta") {
            if (where.userId === "beta-admin-1") {
              return {
                id: "mem-beta-admin",
                organizationId: "org-beta",
                role: "ADMIN",
                status: "ACTIVE",
              };
            }
          }
          return null;
        },
      },
      auditLog: {
        findMany: async ({
          where,
          _orderBy,
          skip,
          take,
        }: {
          where: {
            organizationId: string;
            action?: string;
            targetType?: string;
            targetId?: string;
            actorUserId?: string;
            createdAt?: { gte?: Date; lte?: Date };
          };
          _orderBy?: Array<{ createdAt?: "asc" | "desc"; id?: "asc" | "desc" }>;
          skip?: number;
          take?: number;
        }) => {
          const filtered = auditEvents.filter((item) => {
            if (item.organizationId !== where.organizationId) return false;
            if (where.action && item.action !== where.action) return false;
            if (where.targetType && item.targetType !== where.targetType)
              return false;
            if (where.targetId && item.targetId !== where.targetId)
              return false;
            if (where.actorUserId && item.actorUserId !== where.actorUserId)
              return false;
            if (where.createdAt) {
              if (where.createdAt.gte && item.createdAt < where.createdAt.gte)
                return false;
              if (where.createdAt.lte && item.createdAt > where.createdAt.lte)
                return false;
            }
            return true;
          });

          // Sort by createdAt desc, id desc by default
          filtered.sort((a, b) => {
            const timeDiff = b.createdAt.getTime() - a.createdAt.getTime();
            if (timeDiff !== 0) return timeDiff;
            return b.id.localeCompare(a.id);
          });

          const startIndex = skip ?? 0;
          const limit = take ?? 20;
          return filtered.slice(startIndex, startIndex + limit);
        },
        count: async ({
          where,
        }: {
          where: {
            organizationId: string;
            action?: string;
            targetType?: string;
            targetId?: string;
            actorUserId?: string;
            createdAt?: { gte?: Date; lte?: Date };
          };
        }) => {
          return auditEvents.filter((item) => {
            if (item.organizationId !== where.organizationId) return false;
            if (where.action && item.action !== where.action) return false;
            if (where.targetType && item.targetType !== where.targetType)
              return false;
            if (where.targetId && item.targetId !== where.targetId)
              return false;
            if (where.actorUserId && item.actorUserId !== where.actorUserId)
              return false;
            if (where.createdAt) {
              if (where.createdAt.gte && item.createdAt < where.createdAt.gte)
                return false;
              if (where.createdAt.lte && item.createdAt > where.createdAt.lte)
                return false;
            }
            return true;
          }).length;
        },
      },
    } as unknown as PrismaClient;
  }

  const app = createApp(env, {
    prisma: createMockPrisma(),
    mailer: { send: async () => {} },
  });

  const adminToken = signSessionToken(
    { sid: "sess-1", sub: "admin-1" },
    env.jwtSecret,
    3600,
  );
  const adminProfToken = signSessionToken(
    { sid: "sess-2", sub: "admin-prof-1" },
    env.jwtSecret,
    3600,
  );
  const profToken = signSessionToken(
    { sid: "sess-3", sub: "prof-1" },
    env.jwtSecret,
    3600,
  );
  const recToken = signSessionToken(
    { sid: "sess-4", sub: "rec-1" },
    env.jwtSecret,
    3600,
  );
  const suspendedToken = signSessionToken(
    { sid: "sess-5", sub: "suspended-1" },
    env.jwtSecret,
    3600,
  );
  const betaAdminToken = signSessionToken(
    { sid: "sess-6", sub: "beta-admin-1" },
    env.jwtSecret,
    3600,
  );

  describe("RBAC and Permissions enforcement", () => {
    test("ADMIN role can list audit logs (200 OK)", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as ListAuditLogsResponse;
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBe(5);
      expect(body.pagination).toBeDefined();
      expect(body.pagination?.totalCount).toBe(5);
    });

    test("ADMIN_PROFESSIONAL role can list audit logs (200 OK)", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs",
          {
            headers: { Authorization: `Bearer ${adminProfToken}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as ListAuditLogsResponse;
      expect(body.data.length).toBe(5);
    });

    test("PROFESSIONAL role is denied (403 PERMISSION_DENIED)", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs",
          {
            headers: { Authorization: `Bearer ${profToken}` },
          },
        ),
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PERMISSION_DENIED");
    });

    test("RECEPTIONIST role is denied (403 PERMISSION_DENIED)", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs",
          {
            headers: { Authorization: `Bearer ${recToken}` },
          },
        ),
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PERMISSION_DENIED");
    });

    test("SUSPENDED membership receives 403 MEMBERSHIP_INACTIVE", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs",
          {
            headers: { Authorization: `Bearer ${suspendedToken}` },
          },
        ),
      );
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("MEMBERSHIP_INACTIVE");
    });

    test("Unauthenticated request receives 401 UNAUTHENTICATED", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs",
        ),
      );
      expect(res.status).toBe(401);
    });

    test("Accessing non-existent clinic or foreign clinic without membership returns 404 NOT_FOUND", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-inexistente/audit-logs",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("Multi-tenant Isolation", () => {
    test("strictly filters by active clinic and never leaks events from another clinic or global logs", async () => {
      // Clinica Alfa query
      const alfaRes = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(alfaRes.status).toBe(200);
      const alfaBody = (await alfaRes.json()) as {
        data: Array<{ id: string; organizationId: string }>;
      };
      expect(alfaBody.data.length).toBe(5);
      expect(
        alfaBody.data.every((item) => item.organizationId === "org-alfa"),
      ).toBe(true);
      expect(alfaBody.data.some((item) => item.id === "log-beta-01")).toBe(
        false,
      );
      expect(alfaBody.data.some((item) => item.id === "log-global-01")).toBe(
        false,
      );

      // Clinica Beta query
      const betaRes = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-beta/audit-logs",
          {
            headers: { Authorization: `Bearer ${betaAdminToken}` },
          },
        ),
      );
      expect(betaRes.status).toBe(200);
      const betaBody = (await betaRes.json()) as {
        data: Array<{ id: string; organizationId: string }>;
      };
      expect(betaBody.data.length).toBe(1);
      expect(betaBody.data[0]?.id).toBe("log-beta-01");
      expect(betaBody.data[0]?.organizationId).toBe("org-beta");
    });
  });

  describe("Query filtering by Action, Actor, and Target", () => {
    test("filters by action", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?action=APPOINTMENT_CREATED",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{ action: string; id: string }>;
      };
      expect(body.data.length).toBe(1);
      expect(body.data[0]?.id).toBe("log-alfa-02");
      expect(body.data[0]?.action).toBe("APPOINTMENT_CREATED");
    });

    test("filters by actorUserId and resolves actor details", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?actorUserId=admin-prof-1",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{
          actorUserId: string;
          actorName: string;
          actorUser: { id: string; fullName: string; email: string };
        }>;
      };
      expect(body.data.length).toBe(2);
      expect(body.data[0]?.actorUserId).toBe("admin-prof-1");
      expect(body.data[0]?.actorName).toBe("Dra. Renata Diretora Clinica");
      expect(body.data[0]?.actorUser.email).toBe("renata@clinica-alfa.com");
    });

    test("filters by targetType and targetId", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?targetType=APPOINTMENT&targetId=apt-201",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{ targetType: string; targetId: string }>;
      };
      expect(body.data.length).toBe(2);
      expect(
        body.data.every(
          (item) =>
            item.targetType === "APPOINTMENT" && item.targetId === "apt-201",
        ),
      ).toBe(true);
    });
  });

  describe("Date range filtering and bounds validation", () => {
    test("filters events within a valid date range (YYYY-MM-DD)", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?startDate=2026-10-06&endDate=2026-10-10",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      // Oct 10, Oct 09, and Oct 08 are in [Oct 06, Oct 10]
      expect(body.data.length).toBe(3);
      expect(body.data.map((d) => d.id)).toEqual([
        "log-alfa-01",
        "log-alfa-02",
        "log-alfa-03",
      ]);
    });

    test("filters events for a single day (inclusive)", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?startDate=2026-10-05&endDate=2026-10-05",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      expect(body.data.length).toBe(1);
      expect(body.data[0]?.id).toBe("log-alfa-04");
    });

    test("filters with ISO 8601 timestamps", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?startDate=2026-10-01T00:00:00.000Z&endDate=2026-10-05T23:59:59.999Z",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      expect(body.data.length).toBe(2);
      expect(body.data.map((d) => d.id)).toEqual([
        "log-alfa-04",
        "log-alfa-05",
      ]);
    });

    test("rejects date range exceeding 90 days with 400 VALIDATION_ERROR", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?startDate=2026-01-01&endDate=2026-06-01",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("90 dias");
    });

    test("rejects startDate posterior to endDate with 400 VALIDATION_ERROR", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?startDate=2026-10-15&endDate=2026-10-05",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("startDate");
    });

    test("rejects invalid date format with 400 VALIDATION_ERROR", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?startDate=data-invalida",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Pagination and Stable Ordering", () => {
    test("supports page and limit pagination with totalCount and pageInfo", async () => {
      // Page 1, limit 2
      const page1Res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?page=1&limit=2",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(page1Res.status).toBe(200);
      const page1 = (await page1Res.json()) as {
        data: Array<{ id: string }>;
        pagination: {
          page: number;
          limit: number;
          totalCount: number;
          totalPages: number;
          hasNextPage: boolean;
          hasPreviousPage: boolean;
        };
      };
      expect(page1.data.length).toBe(2);
      expect(page1.data[0]?.id).toBe("log-alfa-01");
      expect(page1.data[1]?.id).toBe("log-alfa-02");
      expect(page1.pagination.page).toBe(1);
      expect(page1.pagination.limit).toBe(2);
      expect(page1.pagination.totalCount).toBe(5);
      expect(page1.pagination.totalPages).toBe(3);
      expect(page1.pagination.hasNextPage).toBe(true);
      expect(page1.pagination.hasPreviousPage).toBe(false);

      // Page 2, limit 2
      const page2Res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?page=2&limit=2",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(page2Res.status).toBe(200);
      const page2 = (await page2Res.json()) as ListAuditLogsResponse;
      expect(page2.data.length).toBe(2);
      expect(page2.data[0]?.id).toBe("log-alfa-03");
      expect(page2.data[1]?.id).toBe("log-alfa-04");
      expect(page2.pagination?.page).toBe(2);
      expect(page2.pagination?.hasNextPage).toBe(true);
      expect(page2.pagination?.hasPreviousPage).toBe(true);

      // Page 3, limit 2
      const page3Res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?page=3&limit=2",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(page3Res.status).toBe(200);
      const page3 = (await page3Res.json()) as ListAuditLogsResponse;
      expect(page3.data.length).toBe(1);
      expect(page3.data[0]?.id).toBe("log-alfa-05");
      expect(page3.pagination?.hasNextPage).toBe(false);
      expect(page3.pagination?.hasPreviousPage).toBe(true);
    });

    test("verifies stable ordering (createdAt DESC, id DESC)", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?limit=5",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{ id: string; createdAt: string }>;
      };
      expect(body.data.length).toBe(5);
      const expectedOrder = [
        "log-alfa-01",
        "log-alfa-02",
        "log-alfa-03",
        "log-alfa-04",
        "log-alfa-05",
      ];
      expect(body.data.map((d) => d.id)).toEqual(expectedOrder);
    });

    test("rejects limit > 100 or limit < 1 with 400 VALIDATION_ERROR", async () => {
      const overLimitRes = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?limit=101",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(overLimitRes.status).toBe(400);

      const zeroLimitRes = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?limit=0",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(zeroLimitRes.status).toBe(400);
    });
  });

  describe("Sanitization and Masking of sensitive fields in metadata", () => {
    test("masks full tax IDs and CPF, and strips passwords, credit cards, CVV, and secrets", async () => {
      const res = await app.handle(
        new Request(
          "http://localhost/api/organizations/clinica-alfa/audit-logs?action=PATIENT_CREATED",
          {
            headers: { Authorization: `Bearer ${adminToken}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: Array<{ id: string; metadata: Record<string, unknown> }>;
      };
      expect(body.data.length).toBe(1);
      const metadata = body.data[0]?.metadata as Record<string, unknown>;

      // Sensitive fields stripped
      expect(metadata.password).toBeUndefined();
      expect(metadata.token).toBeUndefined();
      expect(metadata.apiKey).toBeUndefined();
      expect(metadata.creditCard).toBeUndefined();
      expect(metadata.cardNumber).toBeUndefined();
      expect(metadata.cvv).toBeUndefined();
      expect(metadata.fullTaxId).toBeUndefined();

      // Masked tax identifiers
      expect(metadata.cpf).toBe("***.***.789-**");
      expect(metadata.taxId).toBe("**.***.***/0001-**");

      // Non-sensitive fields preserved
      expect(metadata.safeCategory).toBe("PEDIATRICS");
      expect(metadata.ip).toBe("200.180.10.5");
    });
  });

  describe("Route Aliases", () => {
    test("GET /organizations/:orgSlug/audit route alias works identically", async () => {
      const res = await app.handle(
        new Request("http://localhost/api/organizations/clinica-alfa/audit", {
          headers: { Authorization: `Bearer ${adminToken}` },
        }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as ListAuditLogsResponse;
      expect(body.data.length).toBe(5);
    });
  });
});
