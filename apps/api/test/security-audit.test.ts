import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  AUDIT_RETENTION_DAYS,
  computeAuditRetentionUntil,
  isForbiddenAuditMetadataKey,
  recordAuditEvent,
  sanitizeAuditMetadata,
} from "../src/services/audit-logger";
import { signSessionToken } from "../src/services/session-token";

const env: Env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "audit-test-secret-key-327",
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

describe("Security and domain audit logging (#327)", () => {
  test("sanitizes passwords, tokens, keys, audio, and raw clinical content from metadata", () => {
    expect(isForbiddenAuditMetadataKey("password")).toBe(true);
    expect(isForbiddenAuditMetadataKey("current_password")).toBe(true);
    expect(isForbiddenAuditMetadataKey("token")).toBe(true);
    expect(isForbiddenAuditMetadataKey("inviteToken")).toBe(true);
    expect(isForbiddenAuditMetadataKey("rawAudio")).toBe(true);
    expect(isForbiddenAuditMetadataKey("anamnesisDraft")).toBe(true);
    expect(isForbiddenAuditMetadataKey("rawClinicalContent")).toBe(true);
    expect(isForbiddenAuditMetadataKey("status")).toBe(false);

    const dirtyMetadata = {
      actorIp: "192.168.1.1",
      userAgent: "Flowcare/1.0",
      password: "sample-password",
      passwordHash: "$argon2id$v=19$sample",
      token: "sample-auth-token",
      inviteToken: "sample-invite-token",
      apiKey: "sample-api-key",
      rawAudio: new Uint8Array([1, 2, 3, 4]),
      audioBuffer: "data:audio/mp3;base64,sample-audio",
      anamnesisDraft: "Patient reported acute severe headache...",
      clinicalNotes: "Confidential medical observations",
      prescriptionBody: "Amoxicillin 500mg 8/8h",
      bearerHeader: "Bearer sample-secret-token",
      safeSummary: {
        changedFields: ["fullName", "phone"],
        version: 2,
        nestedPayload: {
          secretKey: "hidden",
          permittedKey: "allowedValue",
        },
      },
    };

    const sanitized = sanitizeAuditMetadata(dirtyMetadata);

    expect(sanitized.actorIp).toBe("192.168.1.1");
    expect(sanitized.userAgent).toBe("Flowcare/1.0");
    expect(sanitized.password).toBeUndefined();
    expect(sanitized.passwordHash).toBeUndefined();
    expect(sanitized.token).toBeUndefined();
    expect(sanitized.inviteToken).toBeUndefined();
    expect(sanitized.apiKey).toBeUndefined();
    expect(sanitized.rawAudio).toBeUndefined();
    expect(sanitized.audioBuffer).toBeUndefined();
    expect(sanitized.anamnesisDraft).toBeUndefined();
    expect(sanitized.clinicalNotes).toBeUndefined();
    expect(sanitized.prescriptionBody).toBeUndefined();
    expect(sanitized.bearerHeader).toBeUndefined();

    const nested = sanitized.safeSummary as {
      changedFields: string[];
      version: number;
      nestedPayload: { secretKey?: string; permittedKey: string };
    };
    expect(nested.changedFields).toEqual(["fullName", "phone"]);
    expect(nested.version).toBe(2);
    expect(nested.nestedPayload.secretKey).toBeUndefined();
    expect(nested.nestedPayload.permittedKey).toBe("allowedValue");
  });

  test("calculates approved 5-year retention period for audit trail", () => {
    expect(AUDIT_RETENTION_DAYS).toBe(1825);
    const now = new Date("2026-10-12T12:00:00.000Z");
    const retentionUntil = computeAuditRetentionUntil(now);
    const diffDays = Math.round(
      (retentionUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(diffDays).toBe(1825);
  });

  test("fail-closed: throws and does not silently ignore when auditLog persistence fails", async () => {
    const failingDb = {
      auditLog: {
        create: async () => {
          throw new Error("Database disk full or constraint violation");
        },
      },
    } as unknown as PrismaClient;

    await expect(
      recordAuditEvent(
        failingDb,
        {
          organizationId: "org-1",
          actorUserId: "user-1",
          action: "PATIENT_CREATED",
          targetType: "PATIENT",
          targetId: "patient-1",
          metadata: { name: "Maria" },
        },
        { requirePersistence: true },
      ),
    ).rejects.toThrow("Database disk full or constraint violation");
  });

  test("forbids modifying or deleting audit events via the public API (immutability)", async () => {
    const fakeAuditLogs = [
      {
        id: "audit-1",
        organizationId: "org-1",
        actorUserId: "admin-1",
        action: "AUTH_LOGIN_SUCCEEDED",
        targetType: "SESSION",
        targetId: "sess-1",
        metadata: { ip: "127.0.0.1" },
        createdAt: new Date("2026-10-12T10:00:00Z"),
      },
    ];

    const prisma = {
      session: {
        findFirst: async () => ({
          id: "sess-admin",
          lastActiveAt: new Date(),
        }),
      },
      membership: {
        findFirst: async ({ where }: { where: { userId: string } }) => {
          if (where.userId === "admin-1") {
            return {
              id: "mem-admin",
              organizationId: "org-1",
              role: "ADMIN",
              status: "ACTIVE",
            };
          }
          return null;
        },
      },
      auditLog: {
        findMany: async () => fakeAuditLogs,
      },
    } as unknown as PrismaClient;

    const app = createApp(env, {
      prisma,
      mailer: { send: async () => {} },
    });

    const adminToken = signSessionToken(
      { sid: "sess-admin", sub: "admin-1" },
      env.jwtSecret,
      3600,
    );

    // Organization-scoped mutation attempts
    const postRes = await app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/audit-logs",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "TAMPER" }),
        },
      ),
    );
    expect(postRes.status).toBe(403);
    const postJson = (await postRes.json()) as { error: { code: string } };
    expect(postJson.error.code).toBe("AUDIT_LOG_IMMUTABLE");

    const patchRes = await app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/audit-logs/audit-1",
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${adminToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ action: "MODIFIED" }),
        },
      ),
    );
    expect(patchRes.status).toBe(403);
    const patchJson = (await patchRes.json()) as { error: { code: string } };
    expect(patchJson.error.code).toBe("AUDIT_LOG_IMMUTABLE");

    const deleteRes = await app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/audit-logs/audit-1",
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${adminToken}` },
        },
      ),
    );
    expect(deleteRes.status).toBe(403);
    const deleteJson = (await deleteRes.json()) as { error: { code: string } };
    expect(deleteJson.error.code).toBe("AUDIT_LOG_IMMUTABLE");

    // Global route mutation attempts
    const globalDeleteRes = await app.handle(
      new Request("http://localhost/api/audit-logs/audit-1", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
    );
    expect(globalDeleteRes.status).toBe(403);
  });

  test("lists organization audit logs with filtering and strictly enforces RBAC & tenant isolation", async () => {
    const auditDatabase = [
      {
        id: "audit-10",
        organizationId: "org-1",
        actorUserId: "admin-1",
        action: "WEEKLY_SCHEDULE_UPDATED",
        targetType: "ORGANIZATION",
        targetId: "org-1",
        metadata: { timezone: "America/Sao_Paulo", ruleCount: 5 },
        createdAt: new Date("2026-10-12T11:00:00Z"),
      },
      {
        id: "audit-9",
        organizationId: "org-1",
        actorUserId: "admin-1",
        action: "TEAM_INVITE_CREATED",
        targetType: "ORGANIZATION_INVITE",
        targetId: "inv-1",
        metadata: { email: "medico@clinica.com", role: "PROFESSIONAL" },
        createdAt: new Date("2026-10-12T10:30:00Z"),
      },
      {
        id: "audit-8",
        organizationId: "org-2", // Different clinic
        actorUserId: "other-user",
        action: "WEEKLY_SCHEDULE_UPDATED",
        targetType: "ORGANIZATION",
        targetId: "org-2",
        metadata: { timezone: "America/Sao_Paulo" },
        createdAt: new Date("2026-10-12T10:00:00Z"),
      },
    ];

    const prisma = {
      session: {
        findFirst: async () => ({
          id: "sess-active",
          lastActiveAt: new Date(),
        }),
      },
      membership: {
        findFirst: async ({
          where,
        }: {
          where: { userId: string; organization: { slug: string } };
        }) => {
          if (where.organization.slug === "clinica-vida") {
            if (where.userId === "admin-1") {
              return {
                id: "mem-admin",
                organizationId: "org-1",
                role: "ADMIN",
                status: "ACTIVE",
              };
            }
            if (where.userId === "admin-prof-1") {
              return {
                id: "mem-admin-prof",
                organizationId: "org-1",
                role: "ADMIN_PROFESSIONAL",
                status: "ACTIVE",
              };
            }
            if (where.userId === "receptionist-1") {
              return {
                id: "mem-rec",
                organizationId: "org-1",
                role: "RECEPTIONIST",
                status: "ACTIVE",
              };
            }
            if (where.userId === "prof-1") {
              return {
                id: "mem-prof",
                organizationId: "org-1",
                role: "PROFESSIONAL",
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
          take,
        }: {
          where: {
            organizationId: string;
            action?: string;
            targetType?: string;
            actorUserId?: string;
          };
          take?: number;
        }) => {
          return auditDatabase
            .filter((item) => {
              if (item.organizationId !== where.organizationId) return false;
              if (where.action && item.action !== where.action) return false;
              if (where.targetType && item.targetType !== where.targetType)
                return false;
              if (where.actorUserId && item.actorUserId !== where.actorUserId)
                return false;
              return true;
            })
            .slice(0, take ?? 50);
        },
      },
    } as unknown as PrismaClient;

    const app = createApp(env, {
      prisma,
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
    const recToken = signSessionToken(
      { sid: "sess-3", sub: "receptionist-1" },
      env.jwtSecret,
      3600,
    );
    const profToken = signSessionToken(
      { sid: "sess-4", sub: "prof-1" },
      env.jwtSecret,
      3600,
    );

    // ADMIN can read audit logs
    const listRes = await app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/audit-logs",
        {
          headers: { Authorization: `Bearer ${adminToken}` },
        },
      ),
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: Array<{ id: string; organizationId: string }>;
    };
    expect(listBody.data).toHaveLength(2);
    expect(listBody.data[0]?.id).toBe("audit-10");
    expect(listBody.data[1]?.id).toBe("audit-9");
    expect(listBody.data.every((item) => item.organizationId === "org-1")).toBe(
      true,
    );

    // ADMIN_PROFESSIONAL can read audit logs
    const adminProfRes = await app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/audit-logs",
        {
          headers: { Authorization: `Bearer ${adminProfToken}` },
        },
      ),
    );
    expect(adminProfRes.status).toBe(200);

    // Filtering by action
    const filteredRes = await app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/audit-logs?action=WEEKLY_SCHEDULE_UPDATED",
        {
          headers: { Authorization: `Bearer ${adminToken}` },
        },
      ),
    );
    expect(filteredRes.status).toBe(200);
    const filteredBody = (await filteredRes.json()) as {
      data: Array<{ action: string }>;
    };
    expect(filteredBody.data).toHaveLength(1);
    expect(filteredBody.data[0]?.action).toBe("WEEKLY_SCHEDULE_UPDATED");

    // RECEPTIONIST is denied (403 PERMISSION_DENIED)
    const recRes = await app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/audit-logs",
        {
          headers: { Authorization: `Bearer ${recToken}` },
        },
      ),
    );
    expect(recRes.status).toBe(403);

    // Non-admin PROFESSIONAL is denied (403 PERMISSION_DENIED)
    const profRes = await app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-vida/audit-logs",
        {
          headers: { Authorization: `Bearer ${profToken}` },
        },
      ),
    );
    expect(profRes.status).toBe(403);

    // Non-member or foreign clinic returns 404 NOT_FOUND
    const foreignRes = await app.handle(
      new Request(
        "http://localhost/api/organizations/clinica-desconhecida/audit-logs",
        {
          headers: { Authorization: `Bearer ${adminToken}` },
        },
      ),
    );
    expect(foreignRes.status).toBe(404);
  });
});
