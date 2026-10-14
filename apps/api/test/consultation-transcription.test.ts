import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type {
  AnamnesisStatus,
  ConsultationStatus,
  MembershipRole,
  MembershipStatus,
  Prisma,
  PrismaClient,
  TranscriptionJobStatus,
} from "../src/generated/prisma/client";
import { ConsultationTranscriptionService } from "../src/modules/consultations/transcription-service";
import { signSessionToken } from "../src/services/session-token";
import {
  MockTranscriptionProvider,
  type TranscriptionProvider,
} from "../src/services/transcription-provider";

const secret = "consultation-tx-secret-32-chars!!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const profAId = "33333333-3333-4333-8333-333333333331";
const profOtherId = "33333333-3333-4333-8333-333333333332";

const consultationAId = "44444444-4444-4444-8444-444444444441";
const consultationBId = "44444444-4444-4444-8444-444444444442";
const consultationNoAudioId = "44444444-4444-4444-8444-444444444443";
const consultationPendingAudioId = "44444444-4444-4444-8444-444444444444";
const consultationCancelledId = "44444444-4444-4444-8444-444444444445";

const audioAId = "55555555-5555-4555-8555-555555555551";
const audioPendingId = "55555555-5555-4555-8555-555555555552";

interface StoredConsultation {
  id: string;
  organizationId: string;
  patientId: string;
  professionalId: string;
  scheduledAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  status: ConsultationStatus;
  anamnesisStatus: AnamnesisStatus;
  version: number;
}

interface StoredAudio {
  id: string;
  organizationId: string;
  consultationId: string;
  uploadedById: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  status: "PENDING_UPLOAD" | "UPLOADED";
  consentConfirmedAt: Date | null;
  objectDeletedAt: Date | null;
  createdAt: Date;
}

interface StoredTranscriptionJob {
  id: string;
  organizationId: string;
  consultationId: string;
  audioId: string | null;
  idempotencyKey: string;
  status: TranscriptionJobStatus;
  errorReason: string | null;
  retryCount: number;
  provider: string | null;
  providerJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredAudioProcessing {
  id: string;
  audioId: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  updatedAt: Date;
}

interface StoredAuditLog {
  id: string;
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

function createFixture(customProvider?: TranscriptionProvider | null) {
  let role: MembershipRole = "PROFESSIONAL";
  let membershipStatus: MembershipStatus = "ACTIVE";
  let currentUserId: string = profAId;
  const sessionActive = true;
  const allowedOrgSlugs = new Set<string>(["clinica-a", "clinica-b"]);

  const consultations: StoredConsultation[] = [
    {
      id: consultationAId,
      organizationId: clinicAId,
      patientId: "patient-1",
      professionalId: profAId,
      scheduledAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      status: "IN_PROGRESS",
      anamnesisStatus: "PENDING",
      version: 0,
    },
    {
      id: consultationBId,
      organizationId: clinicBId,
      patientId: "patient-2",
      professionalId: profAId,
      scheduledAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      status: "IN_PROGRESS",
      anamnesisStatus: "PENDING",
      version: 0,
    },
    {
      id: consultationNoAudioId,
      organizationId: clinicAId,
      patientId: "patient-1",
      professionalId: profAId,
      scheduledAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      status: "IN_PROGRESS",
      anamnesisStatus: "PENDING",
      version: 0,
    },
    {
      id: consultationPendingAudioId,
      organizationId: clinicAId,
      patientId: "patient-1",
      professionalId: profAId,
      scheduledAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      status: "IN_PROGRESS",
      anamnesisStatus: "PENDING",
      version: 0,
    },
    {
      id: consultationCancelledId,
      organizationId: clinicAId,
      patientId: "patient-1",
      professionalId: profAId,
      scheduledAt: new Date(),
      startedAt: new Date(),
      completedAt: null,
      status: "CANCELLED",
      anamnesisStatus: "PENDING",
      version: 0,
    },
  ];

  const audios: StoredAudio[] = [
    {
      id: audioAId,
      organizationId: clinicAId,
      consultationId: consultationAId,
      uploadedById: profAId,
      objectKey: `organizations/${clinicAId}/audio/valid.webm`,
      contentType: "audio/webm",
      sizeBytes: 1024,
      status: "UPLOADED",
      consentConfirmedAt: new Date(),
      objectDeletedAt: null,
      createdAt: new Date(),
    },
    {
      id: audioPendingId,
      organizationId: clinicAId,
      consultationId: consultationPendingAudioId,
      uploadedById: profAId,
      objectKey: `organizations/${clinicAId}/audio/pending.webm`,
      contentType: "audio/webm",
      sizeBytes: 1024,
      status: "PENDING_UPLOAD",
      consentConfirmedAt: new Date(),
      objectDeletedAt: null,
      createdAt: new Date(),
    },
  ];

  const transcriptionJobs: StoredTranscriptionJob[] = [];
  const audioProcessings: StoredAudioProcessing[] = [];
  const auditLogs: StoredAuditLog[] = [];

  const prisma = {
    session: {
      findFirst: async () =>
        sessionActive
          ? { id: "session-1", userId: currentUserId, lastActiveAt: new Date() }
          : null,
    },
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        timezone: "America/Fortaleza",
      }),
    },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: {
          userId?: string;
          organization?: { slug: string };
          organizationId?: string;
          status?: MembershipStatus;
          role?: { in: MembershipRole[] };
        };
      }) => {
        if (where.organization?.slug) {
          if (!allowedOrgSlugs.has(where.organization.slug)) return null;
          return {
            id: "membership-1",
            organizationId:
              where.organization.slug === "clinica-b" ? clinicBId : clinicAId,
            role,
            status: membershipStatus,
          };
        }
        return {
          id: "membership-1",
          organizationId: where.organizationId ?? clinicAId,
          role,
          status: membershipStatus,
        };
      },
    },
    consultation: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) => {
        const found = consultations.find(
          (c) => c.id === where.id && c.organizationId === where.organizationId,
        );
        if (!found) return null;
        const relatedAudios = audios.filter(
          (a) =>
            a.consultationId === found.id &&
            a.organizationId === found.organizationId,
        );
        return {
          ...found,
          audios: relatedAudios,
        };
      },
    },
    transcriptionJob: {
      findUnique: async ({
        where,
      }: {
        where: {
          organizationId_idempotencyKey?: {
            organizationId: string;
            idempotencyKey: string;
          };
          id?: string;
        };
      }) => {
        if (where.organizationId_idempotencyKey) {
          const { organizationId, idempotencyKey } =
            where.organizationId_idempotencyKey;
          return (
            transcriptionJobs.find(
              (j) =>
                j.organizationId === organizationId &&
                j.idempotencyKey === idempotencyKey,
            ) ?? null
          );
        }
        if (where.id) {
          return transcriptionJobs.find((j) => j.id === where.id) ?? null;
        }
        return null;
      },
      findFirst: async ({
        where,
      }: {
        where: {
          organizationId: string;
          consultationId: string;
          status?: { in: TranscriptionJobStatus[] } | TranscriptionJobStatus;
        };
      }) => {
        return (
          transcriptionJobs.find((j) => {
            if (j.organizationId !== where.organizationId) return false;
            if (j.consultationId !== where.consultationId) return false;
            if (where.status) {
              if (
                typeof where.status === "object" &&
                "in" in where.status &&
                Array.isArray(where.status.in)
              ) {
                return where.status.in.includes(j.status);
              }
              return j.status === where.status;
            }
            return true;
          }) ?? null
        );
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const existing = transcriptionJobs.find(
          (j) =>
            j.organizationId === data.organizationId &&
            j.idempotencyKey === data.idempotencyKey,
        );
        if (existing) {
          const err = new Error("Unique constraint failed") as Error & {
            code: string;
          };
          err.code = "P2002";
          throw err;
        }
        const record: StoredTranscriptionJob = {
          id: (data.id as string | undefined) ?? crypto.randomUUID(),
          organizationId: data.organizationId as string,
          consultationId: data.consultationId as string,
          audioId: (data.audioId as string | null) ?? null,
          idempotencyKey: data.idempotencyKey as string,
          status: (data.status as TranscriptionJobStatus) ?? "PROCESSING",
          errorReason: (data.errorReason as string | null) ?? null,
          retryCount: (data.retryCount as number | undefined) ?? 0,
          provider: (data.provider as string | null) ?? null,
          providerJobId: (data.providerJobId as string | null) ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        transcriptionJobs.push(record);
        return { ...record };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const job = transcriptionJobs.find((j) => j.id === where.id);
        if (!job) throw new Error("Job not found");
        if (data.status !== undefined) {
          job.status = data.status as TranscriptionJobStatus;
        }
        if (data.errorReason !== undefined) {
          job.errorReason = data.errorReason as string | null;
        }
        if (data.providerJobId !== undefined) {
          job.providerJobId = data.providerJobId as string | null;
        }
        if (data.retryCount && typeof data.retryCount === "object") {
          const inc = (data.retryCount as { increment?: number }).increment;
          if (inc) job.retryCount += inc;
        }
        job.updatedAt = new Date();
        return { ...job };
      },
    },
    audioProcessing: {
      updateMany: async ({
        where,
        data,
      }: {
        where: { audioId: string };
        data: { status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" };
      }) => {
        let count = 0;
        for (const ap of audioProcessings) {
          if (ap.audioId === where.audioId) {
            ap.status = data.status;
            ap.updatedAt = new Date();
            count++;
          }
        }
        return { count };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const record: StoredAuditLog = {
          id: crypto.randomUUID(),
          organizationId: data.organizationId as string,
          actorUserId: data.actorUserId as string,
          action: data.action as string,
          targetType: data.targetType as string,
          targetId: data.targetId as string,
          metadata: (data.metadata as Prisma.JsonValue) ?? {},
          createdAt: new Date(),
        };
        auditLogs.push(record);
        return record;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        fullName: "Dra. Ana Costa",
      }),
    },
    $transaction: async <T>(
      callback: (tx: typeof prisma) => Promise<T>,
    ): Promise<T> => callback(prisma),
  } as unknown as PrismaClient;

  const provider =
    customProvider !== undefined
      ? customProvider
      : new MockTranscriptionProvider({ delayMs: 50 });

  const service = new ConsultationTranscriptionService(prisma, provider);

  const env = {
    jwtSecret: secret,
    corsOrigin: "http://localhost:3000",
    wahaBaseUrl: "http://127.0.0.1:1",
    version: "test",
    webAppUrl: "http://localhost:3000",
  } as Env;

  const app = createApp(env, {
    prisma,
    mailer: {} as never,
    transcriptionProvider: provider,
  });

  const token = signSessionToken(
    { sid: "session-1", sub: profAId },
    secret,
    3600,
  );

  const request = (
    method: "GET" | "POST",
    path: string,
    options: {
      headers?: Record<string, string>;
      body?: unknown;
      token?: string;
    } = {},
  ) => {
    const { headers = {}, body, token: customToken = token } = options;
    const reqHeaders: Record<string, string> = { ...headers };
    if (customToken) {
      reqHeaders.authorization = `Bearer ${customToken}`;
    }
    if (body !== undefined) {
      reqHeaders["content-type"] = "application/json";
    }

    return app.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  };

  return {
    prisma,
    service,
    provider,
    app,
    token,
    request,
    consultations,
    audios,
    transcriptionJobs,
    auditLogs,
    setCurrentUserId: (id: string) => {
      currentUserId = id;
    },
    setRole: (r: MembershipRole) => {
      role = r;
    },
    setMembershipStatus: (s: MembershipStatus) => {
      membershipStatus = s;
    },
  };
}

describe("Task #265: Consultation Transcription Processing with Idempotency", () => {
  describe("Unit: ConsultationTranscriptionService", () => {
    test("successfully requests transcription and records audit log without duplicate audio content", async () => {
      const f = createFixture();
      const res = await f.service.transcribe(
        clinicAId,
        consultationAId,
        profAId,
        "idem-key-1",
      );

      expect(res.status).toBe("PROCESSING");
      expect(res.jobId).toBeDefined();

      expect(f.transcriptionJobs).toHaveLength(1);
      expect(f.transcriptionJobs[0]?.idempotencyKey).toBe("idem-key-1");
      expect(f.transcriptionJobs[0]?.consultationId).toBe(consultationAId);
      expect(f.transcriptionJobs[0]?.audioId).toBe(audioAId);

      // Verify audit log
      const audit = f.auditLogs.find(
        (a) => a.action === "CONSULTATION_TRANSCRIPTION_REQUESTED",
      );
      expect(audit).toBeDefined();
      expect(audit?.targetId).toBe(consultationAId);
      expect(audit?.metadata).toMatchObject({
        consultationId: consultationAId,
        jobId: res.jobId,
        audioId: audioAId,
        idempotencyKey: "idem-key-1",
      });
      // Ensure sensitive raw audio/text is never logged
      expect(
        (audit?.metadata as Record<string, unknown>).audio,
      ).toBeUndefined();
      expect(
        (audit?.metadata as Record<string, unknown>).transcription,
      ).toBeUndefined();
    });

    test("repeated calls with exact same Idempotency-Key return identical job idempotently without duplicating jobs or audit logs", async () => {
      const f = createFixture();
      const first = await f.service.transcribe(
        clinicAId,
        consultationAId,
        profAId,
        "idem-key-dup-test",
      );

      const second = await f.service.transcribe(
        clinicAId,
        consultationAId,
        profAId,
        "idem-key-dup-test",
      );

      expect(second.jobId).toBe(first.jobId);
      expect(second.status).toBe(first.status);

      // Still only 1 job and 1 audit log created
      expect(f.transcriptionJobs).toHaveLength(1);
      const auditCount = f.auditLogs.filter(
        (a) => a.action === "CONSULTATION_TRANSCRIPTION_REQUESTED",
      ).length;
      expect(auditCount).toBe(1);
    });

    test("calling with different key while a job is already PROCESSING returns existing job idempotently", async () => {
      const f = createFixture();
      const first = await f.service.transcribe(
        clinicAId,
        consultationAId,
        profAId,
        "key-first",
      );

      // Request with another key while active job is PROCESSING
      const second = await f.service.transcribe(
        clinicAId,
        consultationAId,
        profAId,
        "key-different-while-active",
      );

      expect(second.jobId).toBe(first.jobId);
      expect(second.status).toBe(first.status);
      expect(f.transcriptionJobs).toHaveLength(1);
    });

    test("missing or empty Idempotency-Key throws 400 VALIDATION_ERROR", async () => {
      const f = createFixture();
      await expect(
        f.service.transcribe(clinicAId, consultationAId, profAId, ""),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        httpStatus: 400,
      });

      await expect(
        f.service.transcribe(clinicAId, consultationAId, profAId, "   "),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        httpStatus: 400,
      });
    });

    test("consultation with no audio throws 422 BUSINESS_RULE_VIOLATION", async () => {
      const f = createFixture();
      await expect(
        f.service.transcribe(
          clinicAId,
          consultationNoAudioId,
          profAId,
          "idem-no-audio",
        ),
      ).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
        httpStatus: 422,
      });
      expect(f.transcriptionJobs).toHaveLength(0);
    });

    test("consultation with pending unfinalized audio throws 422 BUSINESS_RULE_VIOLATION", async () => {
      const f = createFixture();
      await expect(
        f.service.transcribe(
          clinicAId,
          consultationPendingAudioId,
          profAId,
          "idem-pending-audio",
        ),
      ).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
        httpStatus: 422,
      });
      expect(f.transcriptionJobs).toHaveLength(0);
    });

    test("consultation with unconfirmed consent throws 422 BUSINESS_RULE_VIOLATION", async () => {
      const f = createFixture();
      // Remove consent from audio
      const audio = f.audios.find((a) => a.id === audioAId);
      if (audio) audio.consentConfirmedAt = null;

      await expect(
        f.service.transcribe(
          clinicAId,
          consultationAId,
          profAId,
          "idem-no-consent",
        ),
      ).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
        httpStatus: 422,
      });
      expect(f.transcriptionJobs).toHaveLength(0);
    });

    test("multi-tenant isolation: rejects consultation belonging to another clinic with 404 NOT_FOUND", async () => {
      const f = createFixture();
      // Consultation B belongs to clinicBId, calling with clinicAId
      await expect(
        f.service.transcribe(
          clinicAId,
          consultationBId,
          profAId,
          "idem-cross-tenant",
        ),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        httpStatus: 404,
      });
      expect(f.transcriptionJobs).toHaveLength(0);
    });

    test("clinician not assigned to consultation throws 403 PERMISSION_DENIED", async () => {
      const f = createFixture();
      await expect(
        f.service.transcribe(
          clinicAId,
          consultationAId,
          profOtherId,
          "idem-unauthorized-prof",
        ),
      ).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        httpStatus: 403,
      });
      expect(f.transcriptionJobs).toHaveLength(0);
    });

    test("cancelled consultation throws 422 BUSINESS_RULE_VIOLATION", async () => {
      const f = createFixture();
      await expect(
        f.service.transcribe(
          clinicAId,
          consultationCancelledId,
          profAId,
          "idem-cancelled",
        ),
      ).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
        httpStatus: 422,
      });
      expect(f.transcriptionJobs).toHaveLength(0);
    });

    test("safely isolates provider failure and updates job to FAILED with error reason", async () => {
      const failingProvider = new MockTranscriptionProvider({
        fail: true,
        errorMessage: "Upstream provider timed out",
        delayMs: 10,
      });
      const f = createFixture(failingProvider);

      const res = await f.service.transcribe(
        clinicAId,
        consultationAId,
        profAId,
        "idem-failing-provider",
      );

      expect(res.status).toBe("PROCESSING");

      // Wait for async background dispatch to complete
      await new Promise((resolve) => setTimeout(resolve, 30));

      const job = f.transcriptionJobs.find((j) => j.id === res.jobId);
      expect(job?.status).toBe("FAILED");
      expect(job?.errorReason).toBe("Upstream provider timed out");
      expect(job?.retryCount).toBe(1);

      // Verify resumption after failure without losing state (#265 acceptance criteria)
      const retryRes = await f.service.transcribe(
        clinicAId,
        consultationAId,
        profAId,
        "idem-retry-after-failure",
      );
      expect(retryRes.status).toBe("PROCESSING");
      expect(retryRes.jobId).not.toBe(res.jobId);
      expect(f.transcriptionJobs).toHaveLength(2);
      expect(f.transcriptionJobs[0]?.status).toBe("FAILED");
    });
  });

  describe("Integration: POST /organizations/:orgSlug/consultations/:consultationId/transcribe", () => {
    test("returns 202 Accepted with jobId and status for authorized clinician with valid audio", async () => {
      const f = createFixture();
      const res = await f.request(
        "POST",
        `/organizations/clinica-a/consultations/${consultationAId}/transcribe`,
        {
          headers: { "idempotency-key": "http-idem-key-1" },
        },
      );

      expect(res.status).toBe(202);
      const data = (await res.json()) as { jobId: string; status: string };
      expect(data.jobId).toBeDefined();
      expect(data.status).toBe("PROCESSING");

      expect(f.transcriptionJobs).toHaveLength(1);
      expect(f.transcriptionJobs[0]?.idempotencyKey).toBe("http-idem-key-1");
    });

    test("repeated HTTP request with same Idempotency-Key returns 202 and identical payload without duplicating jobs", async () => {
      const f = createFixture();
      const res1 = await f.request(
        "POST",
        `/organizations/clinica-a/consultations/${consultationAId}/transcribe`,
        {
          headers: { "idempotency-key": "repeat-key-123" },
        },
      );
      expect(res1.status).toBe(202);
      const body1 = (await res1.json()) as { jobId: string; status: string };

      const res2 = await f.request(
        "POST",
        `/organizations/clinica-a/consultations/${consultationAId}/transcribe`,
        {
          headers: { "idempotency-key": "repeat-key-123" },
        },
      );
      expect(res2.status).toBe(202);
      const body2 = (await res2.json()) as { jobId: string; status: string };

      expect(body2.jobId).toBe(body1.jobId);
      expect(body2.status).toBe(body1.status);
      expect(f.transcriptionJobs).toHaveLength(1);
    });

    test("missing Idempotency-Key header returns HTTP 400 VALIDATION_ERROR", async () => {
      const f = createFixture();
      const res = await f.request(
        "POST",
        `/organizations/clinica-a/consultations/${consultationAId}/transcribe`,
      );

      expect(res.status).toBe(400);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe("VALIDATION_ERROR");
      expect(f.transcriptionJobs).toHaveLength(0);
    });

    test("empty or whitespace Idempotency-Key header returns HTTP 400 VALIDATION_ERROR", async () => {
      const f = createFixture();
      const res = await f.request(
        "POST",
        `/organizations/clinica-a/consultations/${consultationAId}/transcribe`,
        {
          headers: { "idempotency-key": "   " },
        },
      );

      expect(res.status).toBe(400);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe("VALIDATION_ERROR");
      expect(f.transcriptionJobs).toHaveLength(0);
    });

    test("consultation without audio returns HTTP 422 BUSINESS_RULE_VIOLATION", async () => {
      const f = createFixture();
      const res = await f.request(
        "POST",
        `/organizations/clinica-a/consultations/${consultationNoAudioId}/transcribe`,
        {
          headers: { "idempotency-key": "no-audio-key" },
        },
      );

      expect(res.status).toBe(422);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe("BUSINESS_RULE_VIOLATION");
      expect(f.transcriptionJobs).toHaveLength(0);
    });

    test("enforces multi-tenant isolation: rejects cross-clinic consultation access", async () => {
      const f = createFixture();
      // Consultation B is in clinica-b, trying to access via clinica-a
      const res = await f.request(
        "POST",
        `/organizations/clinica-a/consultations/${consultationBId}/transcribe`,
        {
          headers: { "idempotency-key": "tenant-iso-key" },
        },
      );

      expect(res.status).toBe(404);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe("NOT_FOUND");
      expect(f.transcriptionJobs).toHaveLength(0);
    });

    test("enforces role permissions: receptionist cannot trigger transcription", async () => {
      const f = createFixture();
      f.setRole("RECEPTIONIST");

      const res = await f.request(
        "POST",
        `/organizations/clinica-a/consultations/${consultationAId}/transcribe`,
        {
          headers: { "idempotency-key": "receptionist-key" },
        },
      );

      expect(res.status).toBe(403);
      const err = (await res.json()) as { error: { code: string } };
      expect(err.error.code).toBe("PERMISSION_DENIED");
      expect(f.transcriptionJobs).toHaveLength(0);
    });
  });
});
