import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type {
  MembershipRole,
  MembershipStatus,
  PrismaClient,
  TranscriptionJobStatus,
} from "../src/generated/prisma/client";
import type { Mailer } from "../src/services/mailer";
import { signSessionToken } from "../src/services/session-token";

const secret = "transcription-usage-test-secret-32-chars!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const prof1Id = "33333333-3333-4333-8333-333333333331";
const prof2Id = "33333333-3333-4333-8333-333333333332";

interface StoredMembership {
  id: string;
  userId: string;
  organizationId: string;
  orgSlug: string;
  role: MembershipRole;
  status: MembershipStatus;
}

interface StoredUser {
  id: string;
  fullName: string;
  email: string;
}

interface StoredConsultation {
  id: string;
  organizationId: string;
  professionalId: string | null;
  patientId: string;
}

interface StoredTranscriptionJob {
  id: string;
  organizationId: string;
  consultationId: string;
  audioId: string | null;
  idempotencyKey: string;
  status: TranscriptionJobStatus;
  durationSeconds: number;
  finishedAt: Date | null;
  createdAt: Date;
}

function createFixture() {
  const organizations = [
    { id: clinicAId, slug: "clinica-a", timezone: "America/Sao_Paulo" },
    { id: clinicBId, slug: "clinica-b", timezone: "America/Manaus" },
  ];

  const users: StoredUser[] = [
    { id: "usr-admin", fullName: "Admin Silva", email: "admin@clinica.com" },
    {
      id: "usr-admin-prof",
      fullName: "Dra. Admin",
      email: "adminprof@clinica.com",
    },
    { id: prof1Id, fullName: "Dra. Ana Paula", email: "ana@clinica.com" },
    { id: prof2Id, fullName: "Dr. Bruno Costa", email: "bruno@clinica.com" },
    {
      id: "usr-recep",
      fullName: "Carla Recepcionista",
      email: "carla@clinica.com",
    },
    {
      id: "usr-suspended",
      fullName: "Membro Suspenso",
      email: "suspenso@clinica.com",
    },
  ];

  const memberships: StoredMembership[] = [
    {
      id: "mem-admin",
      userId: "usr-admin",
      organizationId: clinicAId,
      orgSlug: "clinica-a",
      role: "ADMIN",
      status: "ACTIVE",
    },
    {
      id: "mem-admin-prof",
      userId: "usr-admin-prof",
      organizationId: clinicAId,
      orgSlug: "clinica-a",
      role: "ADMIN_PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-prof",
      userId: prof1Id,
      organizationId: clinicAId,
      orgSlug: "clinica-a",
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-recep",
      userId: "usr-recep",
      organizationId: clinicAId,
      orgSlug: "clinica-a",
      role: "RECEPTIONIST",
      status: "ACTIVE",
    },
    {
      id: "mem-suspended",
      userId: "usr-suspended",
      organizationId: clinicAId,
      orgSlug: "clinica-a",
      role: "ADMIN",
      status: "SUSPENDED",
    },
    {
      id: "mem-admin-b",
      userId: "usr-admin",
      organizationId: clinicBId,
      orgSlug: "clinica-b",
      role: "ADMIN",
      status: "ACTIVE",
    },
  ];

  const consultations: StoredConsultation[] = [
    {
      id: "c-1",
      organizationId: clinicAId,
      professionalId: prof1Id,
      patientId: "pat-1",
    },
    {
      id: "c-2",
      organizationId: clinicAId,
      professionalId: prof2Id,
      patientId: "pat-2",
    },
    {
      id: "c-3",
      organizationId: clinicAId,
      professionalId: prof1Id,
      patientId: "pat-3",
    },
    {
      id: "c-unassigned",
      organizationId: clinicAId,
      professionalId: null,
      patientId: "pat-4",
    },
    {
      id: "c-b1",
      organizationId: clinicBId,
      professionalId: null,
      patientId: "pat-b1",
    },
  ];

  const jobs: StoredTranscriptionJob[] = [];

  const prisma = {
    $queryRaw: async () => [{ 1: 1 }],
    session: {
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        lastActiveAt: new Date(),
      }),
    },
    organization: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; slug?: string };
      }) => {
        if (where.id)
          return organizations.find((o) => o.id === where.id) ?? null;
        if (where.slug)
          return organizations.find((o) => o.slug === where.slug) ?? null;
        return null;
      },
    },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: {
          userId: string;
          organization?: { slug: string };
          organizationId?: string;
        };
      }) => {
        if (where.organization?.slug) {
          return (
            memberships.find(
              (m) =>
                m.userId === where.userId &&
                m.orgSlug === where.organization?.slug,
            ) ?? null
          );
        }
        if (where.organizationId) {
          return (
            memberships.find(
              (m) =>
                m.userId === where.userId &&
                m.organizationId === where.organizationId,
            ) ?? null
          );
        }
        return null;
      },
    },
    transcriptionJob: {
      findMany: async ({
        where,
      }: {
        where: {
          organizationId: string;
          finishedAt?: { gte: Date; lt: Date };
          status?: { in: TranscriptionJobStatus[] };
        };
      }) => {
        return jobs
          .filter((j) => {
            if (j.organizationId !== where.organizationId) return false;
            if (where.status?.in && !where.status.in.includes(j.status))
              return false;
            if (where.finishedAt && j.finishedAt) {
              if (j.finishedAt < where.finishedAt.gte) return false;
              if (j.finishedAt >= where.finishedAt.lt) return false;
            }
            return true;
          })
          .map((j) => {
            const cons = consultations.find((c) => c.id === j.consultationId);
            const prof = cons?.professionalId
              ? users.find((u) => u.id === cons.professionalId)
              : null;
            return {
              id: j.id,
              audioId: j.audioId,
              consultationId: j.consultationId,
              status: j.status,
              durationSeconds: j.durationSeconds,
              finishedAt: j.finishedAt,
              consultation: cons
                ? {
                    id: cons.id,
                    professionalId: cons.professionalId,
                    professional: prof
                      ? { id: prof.id, fullName: prof.fullName }
                      : null,
                  }
                : null,
            };
          });
      },
    },
  };

  const mailer: Mailer = {
    send: async () => {},
  };

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

  const app = createApp(env, {
    prisma: prisma as unknown as PrismaClient,
    mailer,
  });

  const tokenForUser = (userId: string) =>
    signSessionToken({ sid: `sess-${userId}`, sub: userId }, secret, 3600);

  const request = (
    path: string,
    options?: { token?: string; method?: string },
  ) => {
    const headers: Record<string, string> = {};
    if (options?.token) {
      headers.authorization = `Bearer ${options.token}`;
    }
    return app.handle(
      new Request(`http://localhost/api${path}`, {
        method: options?.method ?? "GET",
        headers,
      }),
    );
  };

  return {
    app,
    jobs,
    tokenForUser,
    request,
  };
}

describe("Transcription Usage - Task #306", () => {
  test("calculates exact metrics for METRICS_MVP example (65s + 55s successful = 120s / 2.00 min; 40s failed = 0s billable, 1 failed audio)", async () => {
    const { jobs, tokenForUser, request } = createFixture();

    // In America/Sao_Paulo (UTC-3), October 2026 local is 2026-10-01T03:00:00Z to 2026-11-01T03:00:00Z
    jobs.push(
      {
        id: "job-1",
        organizationId: clinicAId,
        consultationId: "c-1",
        audioId: "audio-1",
        idempotencyKey: "k-1",
        status: "COMPLETED",
        durationSeconds: 65,
        finishedAt: new Date("2026-10-05T14:00:00.000Z"),
        createdAt: new Date("2026-10-05T13:59:00.000Z"),
      },
      {
        id: "job-2",
        organizationId: clinicAId,
        consultationId: "c-2",
        audioId: "audio-2",
        idempotencyKey: "k-2",
        status: "COMPLETED",
        durationSeconds: 55,
        finishedAt: new Date("2026-10-10T15:00:00.000Z"),
        createdAt: new Date("2026-10-10T14:59:00.000Z"),
      },
      {
        id: "job-3",
        organizationId: clinicAId,
        consultationId: "c-3",
        audioId: "audio-3",
        idempotencyKey: "k-3",
        status: "FAILED",
        durationSeconds: 0,
        finishedAt: new Date("2026-10-12T16:00:00.000Z"),
        createdAt: new Date("2026-10-12T15:59:00.000Z"),
      },
    );

    const token = tokenForUser("usr-admin");
    const res = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.month).toBe("2026-10");
    expect(body.timeZone).toBe("America/Sao_Paulo");
    expect(body.periodStart).toBe("2026-10-01T03:00:00.000Z");
    expect(body.periodEnd).toBe("2026-11-01T03:00:00.000Z");
    expect(body.processedSeconds).toBe(120);
    expect(body.processedMinutes).toBe(2);
    expect(body.successfulAudioCount).toBe(2);
    expect(body.transcribedConsultations).toBe(2);
    expect(body.failedAudioCount).toBe(1);

    // byProfessional
    const byProf = body.byProfessional as Array<{
      professionalId: string;
      professionalName: string;
      processedSeconds: number;
      processedMinutes: number;
      successfulAudioCount: number;
    }>;
    expect(byProf.length).toBe(2);

    // Sum of byProfessional processedSeconds must equal clinic total
    const totalByProf = byProf.reduce((sum, p) => sum + p.processedSeconds, 0);
    expect(totalByProf).toBe(120);

    const ana = byProf.find((p) => p.professionalId === prof1Id);
    expect(ana).toBeDefined();
    expect(ana?.professionalName).toBe("Dra. Ana Paula");
    expect(ana?.processedSeconds).toBe(65);
    expect(ana?.processedMinutes).toBe(1.08);
    expect(ana?.successfulAudioCount).toBe(1);

    const bruno = byProf.find((p) => p.professionalId === prof2Id);
    expect(bruno).toBeDefined();
    expect(bruno?.professionalName).toBe("Dr. Bruno Costa");
    expect(bruno?.processedSeconds).toBe(55);
    expect(bruno?.processedMinutes).toBe(0.92);
    expect(bruno?.successfulAudioCount).toBe(1);
  });

  test("retries and reprocessing of the same audio do not count twice", async () => {
    const { jobs, tokenForUser, request } = createFixture();

    jobs.push(
      // Audio 1: completed, then reprocessed successfully. Duration must count ONCE.
      {
        id: "job-1a",
        organizationId: clinicAId,
        consultationId: "c-1",
        audioId: "audio-1",
        idempotencyKey: "k-1a",
        status: "COMPLETED",
        durationSeconds: 65,
        finishedAt: new Date("2026-10-05T14:00:00.000Z"),
        createdAt: new Date("2026-10-05T13:59:00.000Z"),
      },
      {
        id: "job-1b",
        organizationId: clinicAId,
        consultationId: "c-1",
        audioId: "audio-1",
        idempotencyKey: "k-1b",
        status: "COMPLETED",
        durationSeconds: 65,
        finishedAt: new Date("2026-10-06T14:00:00.000Z"),
        createdAt: new Date("2026-10-06T13:59:00.000Z"),
      },
      // Audio 2: failed first, then retried and succeeded.
      // Final state is SUCCESS, duration counts once, not counted in failedAudioCount.
      {
        id: "job-2a",
        organizationId: clinicAId,
        consultationId: "c-2",
        audioId: "audio-2",
        idempotencyKey: "k-2a",
        status: "FAILED",
        durationSeconds: 0,
        finishedAt: new Date("2026-10-10T10:00:00.000Z"),
        createdAt: new Date("2026-10-10T09:59:00.000Z"),
      },
      {
        id: "job-2b",
        organizationId: clinicAId,
        consultationId: "c-2",
        audioId: "audio-2",
        idempotencyKey: "k-2b",
        status: "COMPLETED",
        durationSeconds: 55,
        finishedAt: new Date("2026-10-10T10:05:00.000Z"),
        createdAt: new Date("2026-10-10T10:01:00.000Z"),
      },
      // Audio 3: failed twice. Counted as 1 failed audio, not 2.
      {
        id: "job-3a",
        organizationId: clinicAId,
        consultationId: "c-3",
        audioId: "audio-3",
        idempotencyKey: "k-3a",
        status: "FAILED",
        durationSeconds: 0,
        finishedAt: new Date("2026-10-12T16:00:00.000Z"),
        createdAt: new Date("2026-10-12T15:59:00.000Z"),
      },
      {
        id: "job-3b",
        organizationId: clinicAId,
        consultationId: "c-3",
        audioId: "audio-3",
        idempotencyKey: "k-3b",
        status: "FAILED",
        durationSeconds: 0,
        finishedAt: new Date("2026-10-12T16:10:00.000Z"),
        createdAt: new Date("2026-10-12T16:05:00.000Z"),
      },
    );

    const token = tokenForUser("usr-admin");
    const res = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.processedSeconds).toBe(120);
    expect(body.processedMinutes).toBe(2);
    expect(body.successfulAudioCount).toBe(2);
    expect(body.transcribedConsultations).toBe(2);
    expect(body.failedAudioCount).toBe(1);
  });

  test("unassigned audios appear in 'unassigned' line and sum matches total", async () => {
    const { jobs, tokenForUser, request } = createFixture();

    jobs.push(
      {
        id: "job-unassigned",
        organizationId: clinicAId,
        consultationId: "c-unassigned",
        audioId: "audio-unassigned",
        idempotencyKey: "k-unassigned",
        status: "COMPLETED",
        durationSeconds: 90,
        finishedAt: new Date("2026-10-15T12:00:00.000Z"),
        createdAt: new Date("2026-10-15T11:59:00.000Z"),
      },
      {
        id: "job-prof",
        organizationId: clinicAId,
        consultationId: "c-1",
        audioId: "audio-prof",
        idempotencyKey: "k-prof",
        status: "COMPLETED",
        durationSeconds: 30,
        finishedAt: new Date("2026-10-15T13:00:00.000Z"),
        createdAt: new Date("2026-10-15T12:59:00.000Z"),
      },
    );

    const token = tokenForUser("usr-admin");
    const res = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.processedSeconds).toBe(120);
    expect(body.successfulAudioCount).toBe(2);

    const byProf = body.byProfessional as Array<{
      professionalId: string;
      professionalName: string;
      processedSeconds: number;
      processedMinutes: number;
      successfulAudioCount: number;
    }>;

    expect(byProf.length).toBe(2);
    const unassigned = byProf.find((p) => p.professionalId === "unassigned");
    expect(unassigned).toBeDefined();
    expect(unassigned?.professionalName).toBe("Não atribuído");
    expect(unassigned?.processedSeconds).toBe(90);
    expect(unassigned?.processedMinutes).toBe(1.5);
    expect(unassigned?.successfulAudioCount).toBe(1);

    const totalByProf = byProf.reduce((sum, p) => sum + p.processedSeconds, 0);
    expect(totalByProf).toBe(120);
  });

  test("month filter and timezone boundary conversion tests", async () => {
    const { jobs, tokenForUser, request } = createFixture();

    // In America/Sao_Paulo (UTC-3):
    // 2026-10-01 00:00 local is 2026-10-01T03:00:00.000Z
    // 2026-11-01 00:00 local is 2026-11-01T03:00:00.000Z
    jobs.push(
      // Just before start (2026-09-30 23:59:59 local -> 2026-10-01T02:59:59.000Z): should be EXCLUDED
      {
        id: "job-prev-month",
        organizationId: clinicAId,
        consultationId: "c-1",
        audioId: "audio-prev",
        idempotencyKey: "k-prev",
        status: "COMPLETED",
        durationSeconds: 100,
        finishedAt: new Date("2026-10-01T02:59:59.000Z"),
        createdAt: new Date("2026-10-01T02:58:00.000Z"),
      },
      // Exactly at local midnight start (2026-10-01 00:00:00 local -> 2026-10-01T03:00:00.000Z): INCLUDED
      {
        id: "job-start-boundary",
        organizationId: clinicAId,
        consultationId: "c-1",
        audioId: "audio-start",
        idempotencyKey: "k-start",
        status: "COMPLETED",
        durationSeconds: 50,
        finishedAt: new Date("2026-10-01T03:00:00.000Z"),
        createdAt: new Date("2026-10-01T02:59:00.000Z"),
      },
      // Just before next month (2026-10-31 23:59:59 local -> 2026-11-01T02:59:59.000Z): INCLUDED
      {
        id: "job-end-boundary",
        organizationId: clinicAId,
        consultationId: "c-2",
        audioId: "audio-end",
        idempotencyKey: "k-end",
        status: "COMPLETED",
        durationSeconds: 40,
        finishedAt: new Date("2026-11-01T02:59:59.000Z"),
        createdAt: new Date("2026-11-01T02:58:00.000Z"),
      },
      // Exactly at next month midnight (2026-11-01 00:00:00 local -> 2026-11-01T03:00:00.000Z): EXCLUDED
      {
        id: "job-next-month",
        organizationId: clinicAId,
        consultationId: "c-3",
        audioId: "audio-next",
        idempotencyKey: "k-next",
        status: "COMPLETED",
        durationSeconds: 200,
        finishedAt: new Date("2026-11-01T03:00:00.000Z"),
        createdAt: new Date("2026-11-01T02:59:00.000Z"),
      },
    );

    const token = tokenForUser("usr-admin");
    const res = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // Only job-start-boundary (50) and job-end-boundary (40) are included
    expect(body.processedSeconds).toBe(90);
    expect(body.successfulAudioCount).toBe(2);
  });

  test("different timezone (America/Manaus UTC-4) converts boundaries correctly", async () => {
    const { jobs, tokenForUser, request } = createFixture();

    // clinica-b is America/Manaus (UTC-4)
    // 2026-10-01 00:00 local is 2026-10-01T04:00:00.000Z
    // 2026-11-01 00:00 local is 2026-11-01T04:00:00.000Z
    jobs.push({
      id: "job-manaus",
      organizationId: clinicBId,
      consultationId: "c-b1",
      audioId: "audio-b1",
      idempotencyKey: "k-b1",
      status: "COMPLETED",
      durationSeconds: 85,
      finishedAt: new Date("2026-10-01T04:00:00.000Z"),
      createdAt: new Date("2026-10-01T03:59:00.000Z"),
    });

    const token = tokenForUser("usr-admin");
    const res = await request(
      "/organizations/clinica-b/settings/usage?month=2026-10",
      { token },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.timeZone).toBe("America/Manaus");
    expect(body.periodStart).toBe("2026-10-01T04:00:00.000Z");
    expect(body.periodEnd).toBe("2026-11-01T04:00:00.000Z");
    expect(body.processedSeconds).toBe(85);
  });

  test("omitted month defaults to current month in clinic timezone", async () => {
    const { tokenForUser, request } = createFixture();

    const token = tokenForUser("usr-admin");
    const res = await request("/organizations/clinica-a/settings/usage", {
      token,
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(typeof body.month).toBe("string");
    expect(/^\d{4}-\d{2}$/.test(body.month as string)).toBe(true);
    expect(body.timeZone).toBe("America/Sao_Paulo");
  });

  test("rejects invalid month format with 400 VALIDATION_ERROR", async () => {
    const { tokenForUser, request } = createFixture();

    const token = tokenForUser("usr-admin");

    const res1 = await request(
      "/organizations/clinica-a/settings/usage?month=invalid",
      { token },
    );
    expect(res1.status).toBe(400);

    const res2 = await request(
      "/organizations/clinica-a/settings/usage?month=2026-13",
      { token },
    );
    expect(res2.status).toBe(400);

    const res3 = await request(
      "/organizations/clinica-a/settings/usage?month=2026-00",
      { token },
    );
    expect(res3.status).toBe(400);
  });

  test("strict multi-tenant isolation: other clinic's jobs never leak", async () => {
    const { jobs, tokenForUser, request } = createFixture();

    // Add jobs for Clinic B
    jobs.push(
      {
        id: "job-clinic-b-1",
        organizationId: clinicBId,
        consultationId: "c-b1",
        audioId: "audio-b1",
        idempotencyKey: "k-b1",
        status: "COMPLETED",
        durationSeconds: 500,
        finishedAt: new Date("2026-10-05T14:00:00.000Z"),
        createdAt: new Date("2026-10-05T13:59:00.000Z"),
      },
      {
        id: "job-clinic-b-2",
        organizationId: clinicBId,
        consultationId: "c-b1",
        audioId: "audio-b2",
        idempotencyKey: "k-b2",
        status: "FAILED",
        durationSeconds: 0,
        finishedAt: new Date("2026-10-05T15:00:00.000Z"),
        createdAt: new Date("2026-10-05T14:59:00.000Z"),
      },
    );

    // Query Clinic A (which has 0 jobs)
    const token = tokenForUser("usr-admin");
    const res = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.processedSeconds).toBe(0);
    expect(body.processedMinutes).toBe(0);
    expect(body.successfulAudioCount).toBe(0);
    expect(body.transcribedConsultations).toBe(0);
    expect(body.failedAudioCount).toBe(0);
    expect((body.byProfessional as unknown[]).length).toBe(0);
  });

  test("permission tests: 401 unauthenticated, 403 for RECEPTIONIST and PROFESSIONAL, 200 for ADMIN and ADMIN_PROFESSIONAL", async () => {
    const { tokenForUser, request } = createFixture();

    // 1. Unauthenticated
    const resUnauth = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
    );
    expect(resUnauth.status).toBe(401);

    // 2. RECEPTIONIST -> 403 PERMISSION_DENIED
    const recepToken = tokenForUser("usr-recep");
    const resRecep = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token: recepToken },
    );
    expect(resRecep.status).toBe(403);
    const recepErr = (await resRecep.json()) as { error: { code: string } };
    expect(recepErr.error.code).toBe("PERMISSION_DENIED");

    // 3. PROFESSIONAL -> 403 PERMISSION_DENIED
    const profToken = tokenForUser(prof1Id);
    const resProf = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token: profToken },
    );
    expect(resProf.status).toBe(403);
    const profErr = (await resProf.json()) as { error: { code: string } };
    expect(profErr.error.code).toBe("PERMISSION_DENIED");

    // 4. SUSPENDED membership -> 403 MEMBERSHIP_INACTIVE
    const suspendedToken = tokenForUser("usr-suspended");
    const resSuspended = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token: suspendedToken },
    );
    expect(resSuspended.status).toBe(403);
    const suspErr = (await resSuspended.json()) as { error: { code: string } };
    expect(suspErr.error.code).toBe("MEMBERSHIP_INACTIVE");

    // 5. ADMIN -> 200 OK
    const adminToken = tokenForUser("usr-admin");
    const resAdmin = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token: adminToken },
    );
    expect(resAdmin.status).toBe(200);

    // 6. ADMIN_PROFESSIONAL -> 200 OK
    const adminProfToken = tokenForUser("usr-admin-prof");
    const resAdminProf = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token: adminProfToken },
    );
    expect(resAdminProf.status).toBe(200);
  });

  test("route aliases: /settings/usage and /usage return identical responses", async () => {
    const { jobs, tokenForUser, request } = createFixture();

    jobs.push({
      id: "job-alias",
      organizationId: clinicAId,
      consultationId: "c-1",
      audioId: "audio-alias",
      idempotencyKey: "k-alias",
      status: "COMPLETED",
      durationSeconds: 120,
      finishedAt: new Date("2026-10-10T14:00:00.000Z"),
      createdAt: new Date("2026-10-10T13:59:00.000Z"),
    });

    const token = tokenForUser("usr-admin");

    const res1 = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token },
    );
    const res2 = await request("/organizations/clinica-a/usage?month=2026-10", {
      token,
    });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const body1 = await res1.json();
    const body2 = await res2.json();

    expect(body1).toEqual(body2);
  });

  test("absence of clinical data and pricing/quotas in payload (METRICS_MVP #197)", async () => {
    const { jobs, tokenForUser, request } = createFixture();

    jobs.push({
      id: "job-clinical-check",
      organizationId: clinicAId,
      consultationId: "c-1",
      audioId: "audio-1",
      idempotencyKey: "k-1",
      status: "COMPLETED",
      durationSeconds: 60,
      finishedAt: new Date("2026-10-10T14:00:00.000Z"),
      createdAt: new Date("2026-10-10T13:59:00.000Z"),
    });

    const token = tokenForUser("usr-admin");
    const res = await request(
      "/organizations/clinica-a/settings/usage?month=2026-10",
      { token },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // Forbidden clinical fields:
    expect(body.patientId).toBeUndefined();
    expect(body.patientName).toBeUndefined();
    expect(body.notes).toBeUndefined();
    expect(body.diagnosis).toBeUndefined();
    expect(body.anamnesis).toBeUndefined();
    expect(body.audioUrl).toBeUndefined();
    expect(body.objectKey).toBeUndefined();
    expect(body.transcriptionText).toBeUndefined();

    // Forbidden billing / pricing / quota fields:
    expect(body.cost).toBeUndefined();
    expect(body.costBrl).toBeUndefined();
    expect(body.price).toBeUndefined();
    expect(body.quota).toBeUndefined();
    expect(body.quotaLimit).toBeUndefined();

    // Exact allowed top-level keys only
    const allowedKeys = new Set([
      "month",
      "timeZone",
      "periodStart",
      "periodEnd",
      "processedSeconds",
      "processedMinutes",
      "successfulAudioCount",
      "transcribedConsultations",
      "failedAudioCount",
      "byProfessional",
    ]);

    for (const key of Object.keys(body)) {
      expect(allowedKeys.has(key)).toBe(true);
    }

    // Exact allowed keys on byProfessional items
    const byProf = body.byProfessional as Array<Record<string, unknown>>;
    const allowedProfKeys = new Set([
      "professionalId",
      "professionalName",
      "processedSeconds",
      "processedMinutes",
      "successfulAudioCount",
    ]);
    for (const item of byProf) {
      for (const key of Object.keys(item)) {
        expect(allowedProfKeys.has(key)).toBe(true);
      }
    }
  });
});
