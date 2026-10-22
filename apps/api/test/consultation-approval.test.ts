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
} from "../src/generated/prisma/client";
import { signSessionToken } from "../src/services/session-token";

const secret = "consultation-approval-secret-32-chars!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const profAId = "33333333-3333-4333-8333-333333333331";
const profOtherId = "33333333-3333-4333-8333-333333333332";
const adminProfId = "33333333-3333-4333-8333-333333333333";
const receptionistId = "33333333-3333-4333-8333-333333333334";
const plainAdminId = "33333333-3333-4333-8333-333333333335";

const patient1Id = "44444444-4444-4444-8444-444444444441";
const patient2Id = "44444444-4444-4444-8444-444444444442";

const consultationAId = "55555555-5555-4555-8555-555555555551";
const consultationBId = "55555555-5555-4555-8555-555555555552";
const consultationApprovedId = "55555555-5555-4555-8555-555555555553";
const consultationCancelledId = "55555555-5555-4555-8555-555555555555";
const consultationWithReqTopicsId = "55555555-5555-4555-8555-555555555556";

const revisionWithRequiredId = "66666666-6666-4666-8666-666666666661";

interface StoredConsultation {
  id: string;
  organizationId: string;
  appointmentId: string | null;
  patientId: string;
  professionalId: string;
  scheduledAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  status: ConsultationStatus;
  anamnesisStatus: AnamnesisStatus;
  anamnesisTopicRevisionId?: string | null;
  chiefComplaint?: string | null;
  clinicalNotes?: string | null;
  anamnesisDraft?: Prisma.JsonValue | null;
  draftSavedAt?: Date | null;
  draftSavedById?: string | null;
  approvedAt?: Date | null;
  approvedById?: string | null;
  signedBy?: string | null;
  anamnesisSnapshot?: Prisma.JsonValue | null;
  snapshotHash?: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  patient?: {
    id: string;
    fullName: string;
  };
  professional?: {
    id: string;
    fullName: string;
    professionalTitle: string | null;
    registrationNumber: string | null;
  };
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

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: {
      currentVersion?: number;
      submittedVersion?: number;
      missingTopics?: string[];
      [key: string]: unknown;
    };
  };
}

interface ApproveResponse {
  status: "APPROVED";
  signedBy: string;
  approvedAt: string;
  consultationId: string;
  version: number;
  snapshotHash: string;
  snapshot: {
    patient: { id: string; fullName: string };
    professional: { id: string; fullName: string };
    signedBy: string;
    chiefComplaint: string | null;
    clinicalNotes: string | null;
    topics: Record<string, string | null>;
  };
}

function createFixture() {
  let role: MembershipRole = "PROFESSIONAL";
  let membershipStatus: MembershipStatus = "ACTIVE";
  let currentUserId: string = profAId;
  const sessionActive = true;

  const consultations: StoredConsultation[] = [
    {
      id: consultationAId,
      organizationId: clinicAId,
      appointmentId: null,
      patientId: patient1Id,
      professionalId: profAId,
      scheduledAt: new Date("2026-10-14T10:00:00.000Z"),
      startedAt: new Date("2026-10-14T10:05:00.000Z"),
      completedAt: null,
      status: "IN_PROGRESS",
      anamnesisStatus: "DRAFT",
      chiefComplaint: "Dor torácica aos esforços",
      clinicalNotes: "Paciente hipertenso em uso de losartana",
      anamnesisDraft: {
        chiefComplaint: "Dor torácica aos esforços",
        clinicalNotes: "Paciente hipertenso em uso de losartana",
        topics: {
          hda: "Início há 3 dias",
          antecedentes: "HAS",
        },
      },
      draftSavedAt: new Date("2026-10-14T10:10:00.000Z"),
      draftSavedById: profAId,
      approvedAt: null,
      approvedById: null,
      signedBy: null,
      anamnesisSnapshot: null,
      snapshotHash: null,
      version: 2,
      createdAt: new Date("2026-10-14T09:00:00.000Z"),
      updatedAt: new Date("2026-10-14T10:10:00.000Z"),
      patient: {
        id: patient1Id,
        fullName: "João Carlos Oliveira",
      },
      professional: {
        id: profAId,
        fullName: "Dra. Ana Costa",
        professionalTitle: "Médica Cardiologista",
        registrationNumber: "CRM/SP 123456",
      },
    },
    {
      id: consultationBId,
      organizationId: clinicBId,
      appointmentId: null,
      patientId: patient2Id,
      professionalId: profAId,
      scheduledAt: new Date("2026-10-14T11:00:00.000Z"),
      startedAt: new Date("2026-10-14T11:05:00.000Z"),
      completedAt: null,
      status: "IN_PROGRESS",
      anamnesisStatus: "DRAFT",
      chiefComplaint: "Checkup de rotina",
      clinicalNotes: null,
      anamnesisDraft: {},
      draftSavedAt: null,
      draftSavedById: null,
      approvedAt: null,
      approvedById: null,
      signedBy: null,
      anamnesisSnapshot: null,
      snapshotHash: null,
      version: 1,
      createdAt: new Date("2026-10-14T09:00:00.000Z"),
      updatedAt: new Date("2026-10-14T11:05:00.000Z"),
      patient: {
        id: patient2Id,
        fullName: "Maria Clara Santos",
      },
      professional: {
        id: profAId,
        fullName: "Dra. Ana Costa",
        professionalTitle: "Médica Cardiologista",
        registrationNumber: "CRM/SP 123456",
      },
    },
    {
      id: consultationApprovedId,
      organizationId: clinicAId,
      appointmentId: null,
      patientId: patient1Id,
      professionalId: profAId,
      scheduledAt: new Date("2026-10-14T08:00:00.000Z"),
      startedAt: new Date("2026-10-14T08:05:00.000Z"),
      completedAt: new Date("2026-10-14T08:30:00.000Z"),
      status: "COMPLETED",
      anamnesisStatus: "APPROVED",
      chiefComplaint: "Cefaleia já aprovada",
      clinicalNotes: "Exame normal",
      anamnesisDraft: {},
      draftSavedAt: new Date("2026-10-14T08:25:00.000Z"),
      draftSavedById: profAId,
      approvedAt: new Date("2026-10-14T08:30:00.000Z"),
      approvedById: profAId,
      signedBy: "CRM/SP 123456",
      anamnesisSnapshot: {
        chiefComplaint: "Cefaleia já aprovada",
      },
      snapshotHash: "sha256_mockhash123",
      version: 5,
      createdAt: new Date("2026-10-14T08:00:00.000Z"),
      updatedAt: new Date("2026-10-14T08:30:00.000Z"),
      patient: {
        id: patient1Id,
        fullName: "João Carlos Oliveira",
      },
      professional: {
        id: profAId,
        fullName: "Dra. Ana Costa",
        professionalTitle: "Médica Cardiologista",
        registrationNumber: "CRM/SP 123456",
      },
    },
    {
      id: consultationCancelledId,
      organizationId: clinicAId,
      appointmentId: null,
      patientId: patient1Id,
      professionalId: profAId,
      scheduledAt: new Date("2026-10-14T07:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      status: "CANCELLED",
      anamnesisStatus: "PENDING",
      chiefComplaint: null,
      clinicalNotes: null,
      anamnesisDraft: {},
      draftSavedAt: null,
      draftSavedById: null,
      approvedAt: null,
      approvedById: null,
      signedBy: null,
      anamnesisSnapshot: null,
      snapshotHash: null,
      version: 0,
      createdAt: new Date("2026-10-14T07:00:00.000Z"),
      updatedAt: new Date("2026-10-14T07:00:00.000Z"),
      patient: {
        id: patient1Id,
        fullName: "João Carlos Oliveira",
      },
      professional: {
        id: profAId,
        fullName: "Dra. Ana Costa",
        professionalTitle: "Médica Cardiologista",
        registrationNumber: "CRM/SP 123456",
      },
    },
    {
      id: consultationWithReqTopicsId,
      organizationId: clinicAId,
      appointmentId: null,
      patientId: patient1Id,
      professionalId: profAId,
      scheduledAt: new Date("2026-10-14T14:00:00.000Z"),
      startedAt: new Date("2026-10-14T14:05:00.000Z"),
      completedAt: null,
      status: "IN_PROGRESS",
      anamnesisStatus: "DRAFT",
      anamnesisTopicRevisionId: revisionWithRequiredId,
      chiefComplaint: null,
      clinicalNotes: null,
      anamnesisDraft: {
        topics: {
          history: "Histórico geral preenchido",
        },
      },
      draftSavedAt: new Date("2026-10-14T14:10:00.000Z"),
      draftSavedById: profAId,
      approvedAt: null,
      approvedById: null,
      signedBy: null,
      anamnesisSnapshot: null,
      snapshotHash: null,
      version: 1,
      createdAt: new Date("2026-10-14T14:00:00.000Z"),
      updatedAt: new Date("2026-10-14T14:10:00.000Z"),
      patient: {
        id: patient1Id,
        fullName: "João Carlos Oliveira",
      },
      professional: {
        id: profAId,
        fullName: "Dra. Ana Costa",
        professionalTitle: "Médica Cardiologista",
        registrationNumber: "CRM/SP 123456",
      },
    },
  ];

  const auditLogs: StoredAuditLog[] = [];

  const users = [
    {
      id: profAId,
      email: "ana.costa@flowcare.com",
      fullName: "Dra. Ana Costa",
      professionalTitle: "Médica Cardiologista",
      registrationNumber: "CRM/SP 123456",
    },
    {
      id: profOtherId,
      email: "outro.medico@flowcare.com",
      fullName: "Dr. Roberto Silva",
      professionalTitle: "Médico Geral",
      registrationNumber: "CRM/SP 654321",
    },
    {
      id: adminProfId,
      email: "admin.prof@flowcare.com",
      fullName: "Dra. Diretora Médica",
      professionalTitle: "Diretora Clínica",
      registrationNumber: "CRM/SP 999999",
    },
    {
      id: receptionistId,
      email: "recepcao@flowcare.com",
      fullName: "Carlos Recepção",
      professionalTitle: null,
      registrationNumber: null,
    },
    {
      id: plainAdminId,
      email: "admin.puro@flowcare.com",
      fullName: "Admin Gestor",
      professionalTitle: null,
      registrationNumber: null,
    },
  ];

  const topicRevisions = [
    {
      id: revisionWithRequiredId,
      configId: "config-uuid-1",
      version: 1,
      topics: [
        {
          key: "chief_complaint",
          label: "Queixa Principal",
          active: true,
          required: true,
          order: 0,
        },
        {
          key: "history",
          label: "Histórico da Moléstia",
          active: true,
          required: false,
          order: 1,
        },
      ],
    },
  ];

  const prisma = {
    organization: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; slug?: string };
      }) => {
        if (where.slug === "clinica-a" || where.id === clinicAId) {
          return {
            id: clinicAId,
            name: "Clínica A",
            slug: "clinica-a",
            timezone: "America/Sao_Paulo",
          };
        }
        if (where.slug === "clinica-b" || where.id === clinicBId) {
          return {
            id: clinicBId,
            name: "Clínica B",
            slug: "clinica-b",
            timezone: "America/Sao_Paulo",
          };
        }
        return null;
      },
      findFirst: async ({
        where,
      }: {
        where: { slug?: string; id?: string };
      }) => {
        if (where.slug === "clinica-a" || where.id === clinicAId) {
          return {
            id: clinicAId,
            name: "Clínica A",
            slug: "clinica-a",
            timezone: "America/Sao_Paulo",
          };
        }
        if (where.slug === "clinica-b" || where.id === clinicBId) {
          return {
            id: clinicBId,
            name: "Clínica B",
            slug: "clinica-b",
            timezone: "America/Sao_Paulo",
          };
        }
        return null;
      },
    },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: {
          userId?: string;
          organizationId?: string;
          organization?: { slug?: string };
        };
      }) => {
        const orgMatches =
          where.organizationId === clinicAId ||
          where.organization?.slug === "clinica-a";
        if (!orgMatches) return null;

        const effectiveUserId = where.userId ?? currentUserId;
        return {
          id: `membership-${effectiveUserId}`,
          userId: effectiveUserId,
          organizationId: clinicAId,
          role,
          status: membershipStatus,
        };
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return users.find((u) => u.id === where.id) ?? null;
      },
    },
    session: {
      findFirst: async ({
        where,
      }: {
        where?: { id?: string; userId?: string };
      } = {}) => {
        if (!sessionActive) return null;
        const targetUserId = where?.userId ?? currentUserId;
        const u = users.find((x) => x.id === targetUserId);
        return {
          id: where?.id ?? "session-1",
          userId: targetUserId,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          lastActiveAt: new Date(),
          user: {
            id: targetUserId,
            activeOrganizationId: clinicAId,
            email: u?.email ?? "prof@example.com",
            fullName: u?.fullName ?? "Dra. Ana Costa",
            professionalTitle: u?.professionalTitle ?? null,
            registrationNumber: u?.registrationNumber ?? null,
            memberships: [
              {
                organizationId: clinicAId,
                role,
                status: membershipStatus,
              },
            ],
          },
        };
      },
    },
    consultation: {
      findFirst: async ({
        where,
        include,
      }: {
        where: { id: string; organizationId?: string };
        include?: Record<string, unknown>;
      }) => {
        const item = consultations.find(
          (c) =>
            c.id === where.id &&
            (where.organizationId === undefined ||
              c.organizationId === where.organizationId),
        );
        if (!item) return null;
        return {
          ...item,
          patient: include?.patient
            ? (item.patient ?? { id: item.patientId, fullName: "Paciente" })
            : undefined,
          professional: include?.professional
            ? (item.professional ?? {
                id: item.professionalId,
                fullName: "Profissional",
                professionalTitle: null,
                registrationNumber: null,
              })
            : undefined,
        };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; organizationId?: string; version?: number };
        data: Record<string, unknown>;
      }) => {
        const item = consultations.find(
          (c) =>
            c.id === where.id &&
            (where.organizationId === undefined ||
              c.organizationId === where.organizationId) &&
            (where.version === undefined || c.version === where.version),
        );
        if (!item) return { count: 0 };

        Object.assign(item, data);
        if (typeof data.version === "number") {
          item.version = data.version;
        }
        item.updatedAt = new Date();
        return { count: 1 };
      },
    },
    anamnesisTopicRevision: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        return topicRevisions.find((r) => r.id === where.id) ?? null;
      },
    },
    anamnesisTopicConfig: {
      findUnique: async () => null,
    },
    appointment: {
      updateMany: async () => ({ count: 0 }),
    },
    auditLog: {
      create: async ({
        data,
      }: {
        data: Omit<StoredAuditLog, "id" | "createdAt">;
      }) => {
        const record: StoredAuditLog = {
          id: `audit-${auditLogs.length + 1}`,
          ...data,
          createdAt: new Date(),
        };
        auditLogs.push(record);
        return record;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  };

  const env = {
    jwtSecret: secret,
    corsOrigin: "http://localhost:3000",
    wahaBaseUrl: "http://127.0.0.1:1",
    version: "test",
    webAppUrl: "http://localhost:3000",
  } as Env;

  const app = createApp(env, {
    prisma: prisma as unknown as PrismaClient,
    mailer: {} as never,
  });

  const generateToken = (userId: string = currentUserId) =>
    signSessionToken({ sid: "session-1", sub: userId }, secret, 3600);

  const request = (
    method: "GET" | "POST" | "PATCH" | "PUT",
    path: string,
    options: {
      headers?: Record<string, string>;
      body?: unknown;
      token?: string | null;
    } = {},
  ) => {
    const { headers = {}, body } = options;
    const reqHeaders: Record<string, string> = { ...headers };
    if (options.token !== null) {
      const activeToken = options.token ?? generateToken();
      if (activeToken) {
        reqHeaders.authorization = `Bearer ${activeToken}`;
      }
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
    app,
    request,
    consultations,
    auditLogs,
    generateToken,
    setRole: (r: MembershipRole) => {
      role = r;
    },
    setMembershipStatus: (s: MembershipStatus) => {
      membershipStatus = s;
    },
    setCurrentUserId: (id: string) => {
      currentUserId = id;
    },
  };
}

describe("POST /organizations/:orgSlug/consultations/:consultationId/approve", () => {
  test("401 when unauthenticated", async () => {
    const fixture = createFixture();
    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationAId}/approve`,
      {
        body: { version: 2 },
        token: null,
      },
    );
    expect(res.status).toBe(401);
  });

  test("403 when user is RECEPTIONIST", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(receptionistId);
    fixture.setRole("RECEPTIONIST");

    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationAId}/approve`,
      {
        body: { version: 2 },
        token: fixture.generateToken(receptionistId),
      },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("PERMISSION_DENIED");
  });

  test("200 OK when ADMIN (clinic owner) approves the anamnesis", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(plainAdminId);
    fixture.setRole("ADMIN");

    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationAId}/approve`,
      {
        body: { version: 2 },
        token: fixture.generateToken(plainAdminId),
      },
    );
    expect(res.status).toBe(200);
  });

  test("403 when user is an unassigned PROFESSIONAL (different doctor)", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(profOtherId);
    fixture.setRole("PROFESSIONAL");

    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationAId}/approve`,
      {
        body: { version: 2 },
        token: fixture.generateToken(profOtherId),
      },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("PERMISSION_DENIED");
    expect(body.error.message).toContain("não autorizado");
  });

  test("404 when consultation belongs to another clinic (multi-tenant isolation)", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(profAId);
    fixture.setRole("PROFESSIONAL");

    // consultationBId belongs to clinicBId, not clinica-a
    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationBId}/approve`,
      {
        body: { version: 1 },
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("409 DOCUMENT_STATE_CONFLICT when consultation is already approved", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(profAId);
    fixture.setRole("PROFESSIONAL");

    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationApprovedId}/approve`,
      {
        body: { version: 5 },
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("DOCUMENT_STATE_CONFLICT");
    expect(body.error.message).toContain("já foi aprovada");
  });

  test("409 DOCUMENT_STATE_CONFLICT when consultation is cancelled", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(profAId);
    fixture.setRole("PROFESSIONAL");

    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationCancelledId}/approve`,
      {
        body: { version: 0 },
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("DOCUMENT_STATE_CONFLICT");
    expect(body.error.message).toContain("cancelado");
  });

  test("409 VERSION_CONFLICT on stale version", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(profAId);
    fixture.setRole("PROFESSIONAL");

    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationAId}/approve`,
      {
        body: { version: 99 },
      },
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("VERSION_CONFLICT");
    expect(body.error.details?.currentVersion).toBe(2);
    expect(body.error.details?.submittedVersion).toBe(99);
  });

  test("400 VALIDATION_ERROR when required topics are blank", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(profAId);
    fixture.setRole("PROFESSIONAL");

    // consultationWithReqTopicsId requires "chief_complaint" which is null
    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationWithReqTopicsId}/approve`,
      {
        body: { version: 1 },
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorResponse;
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("Tópicos obrigatórios");
    expect(body.error.details?.missingTopics).toContain("Queixa Principal");
  });

  test("200 OK: successful approval by assigned professional with snapshot, CRM and audit trail", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(profAId);
    fixture.setRole("PROFESSIONAL");

    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationAId}/approve`,
      {
        body: { version: 2 },
      },
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as ApproveResponse;

    // Verify response schema
    expect(data.status).toBe("APPROVED");
    expect(data.signedBy).toBe("CRM/SP 123456");
    expect(typeof data.approvedAt).toBe("string");
    expect(data.consultationId).toBe(consultationAId);
    expect(data.version).toBe(3);
    expect(data.snapshotHash).toMatch(/^sha256_[0-9a-f]{64}$/);

    // Verify snapshot content
    expect(data.snapshot).toBeDefined();
    expect(data.snapshot.patient.id).toBe(patient1Id);
    expect(data.snapshot.patient.fullName).toBe("João Carlos Oliveira");
    expect(data.snapshot.professional.id).toBe(profAId);
    expect(data.snapshot.signedBy).toBe("CRM/SP 123456");
    expect(data.snapshot.chiefComplaint).toBe("Dor torácica aos esforços");
    expect(data.snapshot.clinicalNotes).toBe(
      "Paciente hipertenso em uso de losartana",
    );
    expect(data.snapshot.topics.hda).toBe("Início há 3 dias");

    // Verify consultation in DB
    const stored = fixture.consultations.find((c) => c.id === consultationAId);
    expect(stored).toBeDefined();
    expect(stored?.anamnesisStatus).toBe("APPROVED");
    expect(stored?.status).toBe("COMPLETED");
    expect(stored?.version).toBe(3);
    expect(stored?.signedBy).toBe("CRM/SP 123456");
    expect(stored?.approvedById).toBe(profAId);
    expect(stored?.approvedAt).toBeInstanceOf(Date);
    expect(stored?.snapshotHash).toBe(data.snapshotHash);

    // Verify audit log
    const audit = fixture.auditLogs.find(
      (a) => a.action === "CONSULTATION_ANAMNESIS_APPROVED",
    );
    expect(audit).toBeDefined();
    expect(audit?.targetId).toBe(consultationAId);
    expect(audit?.actorUserId).toBe(profAId);
    expect((audit?.metadata as Record<string, unknown>).signedBy).toBe(
      "CRM/SP 123456",
    );
    expect((audit?.metadata as Record<string, unknown>).snapshotHash).toBe(
      data.snapshotHash,
    );

    // Verify subsequent modifications via draft endpoint are blocked with 409 DOCUMENT_STATE_CONFLICT
    const draftRes = await fixture.request(
      "PATCH",
      `/organizations/clinica-a/consultations/${consultationAId}/draft`,
      {
        body: {
          version: 3,
          chiefComplaint: "Tentativa de alteração pós-aprovação",
        },
      },
    );
    expect(draftRes.status).toBe(409);
    const draftBody = (await draftRes.json()) as ErrorResponse;
    expect(draftBody.error.code).toBe("DOCUMENT_STATE_CONFLICT");
    expect(draftBody.error.message).toContain("não pode ser editada");

    // Verify subsequent approve call also returns 409
    const secondApproveRes = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationAId}/approve`,
      {
        body: { version: 3 },
      },
    );
    expect(secondApproveRes.status).toBe(409);
    const secondApproveBody = (await secondApproveRes.json()) as ErrorResponse;
    expect(secondApproveBody.error.code).toBe("DOCUMENT_STATE_CONFLICT");
  });

  test("200 OK: approval by ADMIN_PROFESSIONAL who is not the primary assigned doctor", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(adminProfId);
    fixture.setRole("ADMIN_PROFESSIONAL");

    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationAId}/approve`,
      {
        body: { version: 2 },
        token: fixture.generateToken(adminProfId),
      },
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as ApproveResponse;
    expect(data.status).toBe("APPROVED");
    expect(data.signedBy).toBe("CRM/SP 999999");
    expect(data.snapshot.professional.id).toBe(adminProfId);
  });

  test("200 OK: approval with required topics fulfilled during request", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(profAId);
    fixture.setRole("PROFESSIONAL");

    // Provide the missing required topic "chief_complaint" in the request body
    const res = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationWithReqTopicsId}/approve`,
      {
        body: {
          version: 1,
          chiefComplaint: "Dor no peito aguda",
        },
      },
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as ApproveResponse;
    expect(data.status).toBe("APPROVED");
    expect(data.snapshot.chiefComplaint).toBe("Dor no peito aguda");
  });

  test("200 OK: route aliases (POST/PUT anamnesis/approve and PUT approve)", async () => {
    const fixture = createFixture();
    fixture.setCurrentUserId(profAId);
    fixture.setRole("PROFESSIONAL");

    // Alias 1: POST /anamnesis/approve
    const res1 = await fixture.request(
      "POST",
      `/organizations/clinica-a/consultations/${consultationAId}/anamnesis/approve`,
      {
        body: { version: 2 },
      },
    );
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as ApproveResponse;
    expect(body1.status).toBe("APPROVED");
    expect(body1.signedBy).toBe("CRM/SP 123456");
  });
});
