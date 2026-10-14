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
import type { ConsultationDetailResponse } from "../src/modules/consultations/model";
import { ConsultationsService } from "../src/modules/consultations/service";
import { signSessionToken } from "../src/services/session-token";

const secret = "consultation-draft-secret-32-chars!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const profAId = "33333333-3333-4333-8333-333333333331";
const profOtherId = "33333333-3333-4333-8333-333333333332";
const adminProfId = "33333333-3333-4333-8333-333333333333";
const receptionistId = "33333333-3333-4333-8333-333333333334";

const patient1Id = "44444444-4444-4444-8444-444444444441";
const patient2Id = "44444444-4444-4444-8444-444444444442";

const consultationAId = "55555555-5555-4555-8555-555555555551";
const consultationBId = "55555555-5555-4555-8555-555555555552";
const consultationApprovedId = "55555555-5555-4555-8555-555555555553";
const consultationCompletedId = "55555555-5555-4555-8555-555555555554";
const consultationCancelledId = "55555555-5555-4555-8555-555555555555";

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
      anamnesisStatus: "PENDING",
      chiefComplaint: null,
      clinicalNotes: null,
      anamnesisDraft: {},
      draftSavedAt: null,
      draftSavedById: null,
      version: 0,
      createdAt: new Date("2026-10-14T09:00:00.000Z"),
      updatedAt: new Date("2026-10-14T10:05:00.000Z"),
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
      anamnesisStatus: "PENDING",
      chiefComplaint: null,
      clinicalNotes: null,
      anamnesisDraft: {},
      draftSavedAt: null,
      draftSavedById: null,
      version: 0,
      createdAt: new Date("2026-10-14T09:00:00.000Z"),
      updatedAt: new Date("2026-10-14T11:05:00.000Z"),
      patient: {
        id: patient2Id,
        fullName: "Maria Fernanda Santos",
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
      scheduledAt: new Date("2026-10-13T10:00:00.000Z"),
      startedAt: new Date("2026-10-13T10:05:00.000Z"),
      completedAt: new Date("2026-10-13T10:45:00.000Z"),
      status: "COMPLETED",
      anamnesisStatus: "APPROVED",
      chiefComplaint: "Queixa original finalizada",
      clinicalNotes: "Notas originais finalizadas",
      anamnesisDraft: { topics: { hda: "Texto finalizado" } },
      draftSavedAt: new Date("2026-10-13T10:30:00.000Z"),
      draftSavedById: profAId,
      version: 3,
      createdAt: new Date("2026-10-13T09:00:00.000Z"),
      updatedAt: new Date("2026-10-13T10:45:00.000Z"),
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
      id: consultationCompletedId,
      organizationId: clinicAId,
      appointmentId: null,
      patientId: patient1Id,
      professionalId: profAId,
      scheduledAt: new Date("2026-10-13T14:00:00.000Z"),
      startedAt: new Date("2026-10-13T14:05:00.000Z"),
      completedAt: new Date("2026-10-13T14:40:00.000Z"),
      status: "COMPLETED",
      anamnesisStatus: "DRAFT",
      chiefComplaint: "Queixa de consulta encerrada",
      clinicalNotes: "Notas",
      anamnesisDraft: {},
      draftSavedAt: null,
      draftSavedById: null,
      version: 1,
      createdAt: new Date("2026-10-13T13:00:00.000Z"),
      updatedAt: new Date("2026-10-13T14:40:00.000Z"),
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
      scheduledAt: new Date("2026-10-13T16:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      status: "CANCELLED",
      anamnesisStatus: "PENDING",
      chiefComplaint: null,
      clinicalNotes: null,
      anamnesisDraft: {},
      draftSavedAt: null,
      draftSavedById: null,
      version: 0,
      createdAt: new Date("2026-10-13T15:00:00.000Z"),
      updatedAt: new Date("2026-10-13T15:30:00.000Z"),
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

  const prisma = {
    organization: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; slug?: string };
      }) => {
        if (where.id === clinicAId || where.slug === "clinica-a") {
          return {
            id: clinicAId,
            slug: "clinica-a",
            timezone: "America/Sao_Paulo",
          };
        }
        if (where.id === clinicBId || where.slug === "clinica-b") {
          return {
            id: clinicBId,
            slug: "clinica-b",
            timezone: "America/Sao_Paulo",
          };
        }
        return null;
      },
    },
    session: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        if (!sessionActive) return null;
        return {
          id: where.id,
          userId: currentUserId,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 3600000),
          user: {
            id: currentUserId,
            activeOrganizationId: clinicAId,
            email: "prof@example.com",
            fullName: "Dra. Ana Costa",
            professionalTitle: "Médica Cardiologista",
            registrationNumber: "CRM/SP 123456",
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
    membership: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; organizationId?: string; role?: unknown };
      }) => {
        if (where.userId !== currentUserId) return null;
        return {
          id: "membership-1",
          userId: currentUserId,
          organizationId: where.organizationId ?? clinicAId,
          role,
          status: membershipStatus,
          organization: {
            id: where.organizationId ?? clinicAId,
            slug:
              where.organizationId === clinicBId ? "clinica-b" : "clinica-a",
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

        if (data.version !== undefined) {
          if (
            typeof data.version === "object" &&
            data.version !== null &&
            "increment" in data.version
          ) {
            item.version += (data.version.increment as number) || 1;
          } else {
            item.version = data.version as number;
          }
        }
        if (data.anamnesisStatus !== undefined) {
          item.anamnesisStatus = data.anamnesisStatus as AnamnesisStatus;
        }
        if (data.status !== undefined) {
          item.status = data.status as ConsultationStatus;
        }
        if (data.startedAt !== undefined) {
          item.startedAt = data.startedAt as Date | null;
        }
        if (data.chiefComplaint !== undefined) {
          item.chiefComplaint = data.chiefComplaint as string | null;
        }
        if (data.clinicalNotes !== undefined) {
          item.clinicalNotes = data.clinicalNotes as string | null;
        }
        if (data.anamnesisDraft !== undefined) {
          item.anamnesisDraft = data.anamnesisDraft as Prisma.JsonValue;
        }
        if (data.draftSavedAt !== undefined) {
          item.draftSavedAt = data.draftSavedAt as Date | null;
        }
        if (data.draftSavedById !== undefined) {
          item.draftSavedById = data.draftSavedById as string | null;
        }
        item.updatedAt = new Date();
        return { count: 1 };
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
    $transaction: async <T>(
      callback: (tx: typeof prisma) => Promise<T>,
    ): Promise<T> => callback(prisma),
  } as unknown as PrismaClient;

  const service = new ConsultationsService(prisma);

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
    prisma,
    service,
    app,
    consultations,
    auditLogs,
    request,
    setRole: (r: MembershipRole) => {
      role = r;
    },
    setUserId: (id: string) => {
      currentUserId = id;
    },
    setMembershipStatus: (s: MembershipStatus) => {
      membershipStatus = s;
    },
  };
}

describe("Consultations Anamnesis Draft (#266)", () => {
  describe("Unit: ConsultationsService.saveDraft", () => {
    test("successfully saves draft with chiefComplaint, clinicalNotes, topics and increments version", async () => {
      const f = createFixture();

      const result = await f.service.saveDraft(
        clinicAId,
        profAId,
        "PROFESSIONAL",
        consultationAId,
        {
          version: 0,
          chiefComplaint: "Cefaleia frontal pulsátil há 3 dias",
          clinicalNotes: "Paciente nega febre ou fotofobia",
          topics: {
            hda: "Início súbito, intensidade 7/10",
            antecedentes: "Hipertensão controlada",
          },
        },
      );

      expect(result.version).toBe(1);
      expect(result.anamnesisStatus).toBe("DRAFT");
      expect(result.chiefComplaint).toBe("Cefaleia frontal pulsátil há 3 dias");
      expect(result.clinicalNotes).toBe("Paciente nega febre ou fotofobia");
      expect(result.draftSavedAt).toBeDefined();
      expect(result.draftSavedById).toBe(profAId);
      expect(result.anamnesisDraft).toEqual({
        chiefComplaint: "Cefaleia frontal pulsátil há 3 dias",
        clinicalNotes: "Paciente nega febre ou fotofobia",
        topics: {
          hda: "Início súbito, intensidade 7/10",
          antecedentes: "Hipertensão controlada",
        },
      });

      // Verify audit log
      const audit = f.auditLogs.find(
        (a) => a.action === "CONSULTATION_DRAFT_UPDATED",
      );
      expect(audit).toBeDefined();
      expect(audit?.targetId).toBe(consultationAId);
      expect(audit?.targetType).toBe("CONSULTATION");
      expect(audit?.actorUserId).toBe(profAId);
      expect(audit?.metadata).toMatchObject({
        consultationId: consultationAId,
        version: 1,
        previousVersion: 0,
      });

      // Saving second draft increments version to 2
      const secondResult = await f.service.saveDraft(
        clinicAId,
        profAId,
        "PROFESSIONAL",
        consultationAId,
        {
          version: 1,
          clinicalNotes: "Paciente relata melhora parcial com analgésico",
        },
      );

      expect(secondResult.version).toBe(2);
      expect(secondResult.clinicalNotes).toBe(
        "Paciente relata melhora parcial com analgésico",
      );
      // Preserved previous chiefComplaint and topics
      expect(secondResult.chiefComplaint).toBe(
        "Cefaleia frontal pulsátil há 3 dias",
      );
    });

    test("supports topics formatted as array of key-value objects", async () => {
      const f = createFixture();

      const result = await f.service.saveDraft(
        clinicAId,
        profAId,
        "PROFESSIONAL",
        consultationAId,
        {
          version: 0,
          topics: [
            { key: "queixa", value: "Dor lombar" },
            { key: "medicamentos", value: "Paracetamol" },
          ],
        },
      );

      expect(result.version).toBe(1);
      expect(result.anamnesisStatus).toBe("DRAFT");
      expect(
        (
          result.anamnesisDraft as {
            topics: Array<{ key: string; value: string }>;
          }
        )?.topics,
      ).toEqual([
        { key: "queixa", value: "Dor lombar" },
        { key: "medicamentos", value: "Paracetamol" },
      ]);
    });

    test("optimistic concurrency conflict: saving with stale version throws 409 VERSION_CONFLICT", async () => {
      const f = createFixture();

      // Consultation has version 0, client submits version 99
      await expect(
        f.service.saveDraft(
          clinicAId,
          profAId,
          "PROFESSIONAL",
          consultationAId,
          {
            version: 99,
            chiefComplaint: "Stale version test",
          },
        ),
      ).rejects.toMatchObject({
        code: "VERSION_CONFLICT",
        httpStatus: 409,
      });

      expect(f.auditLogs).toHaveLength(0);
    });

    test("blocked after approval: saving draft on already approved anamnesis throws 409 DOCUMENT_STATE_CONFLICT", async () => {
      const f = createFixture();

      await expect(
        f.service.saveDraft(
          clinicAId,
          profAId,
          "PROFESSIONAL",
          consultationApprovedId,
          {
            version: 3,
            chiefComplaint: "Tentativa de alteração",
          },
        ),
      ).rejects.toMatchObject({
        code: "DOCUMENT_STATE_CONFLICT",
        httpStatus: 409,
        message: "Anamnese já finalizada/aprovada não pode ser editada.",
      });

      expect(f.auditLogs).toHaveLength(0);
    });

    test("blocked after completion: saving draft on completed consultation throws 409 DOCUMENT_STATE_CONFLICT", async () => {
      const f = createFixture();

      await expect(
        f.service.saveDraft(
          clinicAId,
          profAId,
          "PROFESSIONAL",
          consultationCompletedId,
          {
            version: 1,
            chiefComplaint: "Tentativa em consulta completada",
          },
        ),
      ).rejects.toMatchObject({
        code: "DOCUMENT_STATE_CONFLICT",
        httpStatus: 409,
      });
    });

    test("blocked when cancelled: saving draft on cancelled consultation throws 409 DOCUMENT_STATE_CONFLICT", async () => {
      const f = createFixture();

      await expect(
        f.service.saveDraft(
          clinicAId,
          profAId,
          "PROFESSIONAL",
          consultationCancelledId,
          {
            version: 0,
            chiefComplaint: "Tentativa em consulta cancelada",
          },
        ),
      ).rejects.toMatchObject({
        code: "DOCUMENT_STATE_CONFLICT",
        httpStatus: 409,
      });
    });

    test("cross-tenant isolation: accessing consultation from another clinic throws 404 NOT_FOUND", async () => {
      const f = createFixture();

      // consultationBId belongs to clinicBId, accessed through clinicAId
      await expect(
        f.service.saveDraft(
          clinicAId,
          profAId,
          "PROFESSIONAL",
          consultationBId,
          {
            version: 0,
            chiefComplaint: "Cross-tenant test",
          },
        ),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
        httpStatus: 404,
      });
    });

    test("unassigned professional cannot edit draft of another clinician", async () => {
      const f = createFixture();

      await expect(
        f.service.saveDraft(
          clinicAId,
          profOtherId,
          "PROFESSIONAL",
          consultationAId,
          {
            version: 0,
            chiefComplaint: "Unauthorized clinician test",
          },
        ),
      ).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        httpStatus: 403,
      });
    });

    test("ADMIN_PROFESSIONAL can save draft even if not the assigned clinician", async () => {
      const f = createFixture();

      const result = await f.service.saveDraft(
        clinicAId,
        adminProfId,
        "ADMIN_PROFESSIONAL",
        consultationAId,
        {
          version: 0,
          chiefComplaint: "Editado por admin profissional",
        },
      );

      expect(result.version).toBe(1);
      expect(result.chiefComplaint).toBe("Editado por admin profissional");
      expect(result.draftSavedById).toBe(adminProfId);
    });

    test("getById returns draft fields, version, and anamnesisStatus", async () => {
      const f = createFixture();

      // First save draft
      await f.service.saveDraft(
        clinicAId,
        profAId,
        "PROFESSIONAL",
        consultationAId,
        {
          version: 0,
          chiefComplaint: "Queixa para getById",
          clinicalNotes: "Notas para getById",
        },
      );

      // Now query getById
      const detail = await f.service.getById(clinicAId, consultationAId);
      expect(detail.version).toBe(1);
      expect(detail.anamnesisStatus).toBe("DRAFT");
      expect(detail.chiefComplaint).toBe("Queixa para getById");
      expect(detail.clinicalNotes).toBe("Notas para getById");
      expect(detail.draftSavedAt).toBeDefined();
      expect(detail.draftSavedById).toBe(profAId);
    });
  });

  describe("Integration: PATCH /organizations/:orgSlug/consultations/:consultationId/draft", () => {
    test("HTTP 200 OK: saves draft and returns updated representation with new version", async () => {
      const f = createFixture();

      const res = await f.request(
        "PATCH",
        `/organizations/clinica-a/consultations/${consultationAId}/draft`,
        {
          body: {
            version: 0,
            chiefComplaint: "Dor abdominal em cólica",
            clinicalNotes: "Abdômen doloroso à palpação",
            topics: {
              sintomas: "Dor moderada",
              medicacao: "Buscopan",
            },
          },
        },
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as ConsultationDetailResponse;
      expect(data.version).toBe(1);
      expect(data.anamnesisStatus).toBe("DRAFT");
      expect(data.chiefComplaint).toBe("Dor abdominal em cólica");
      expect(data.clinicalNotes).toBe("Abdômen doloroso à palpação");
      expect(data.draftSavedAt).toBeDefined();
      expect(data.draftSavedById).toBe(profAId);

      // Verify AuditLog was created
      const audit = f.auditLogs.find(
        (a) => a.action === "CONSULTATION_DRAFT_UPDATED",
      );
      expect(audit).toBeDefined();
      expect(audit?.targetId).toBe(consultationAId);
    });

    test("HTTP 200 OK: supports alias PUT /consultations/:consultationId/draft", async () => {
      const f = createFixture();

      const res = await f.request(
        "PUT",
        `/organizations/clinica-a/consultations/${consultationAId}/draft`,
        {
          body: {
            version: 0,
            chiefComplaint: "Teste via PUT draft",
          },
        },
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as ConsultationDetailResponse;
      expect(data.version).toBe(1);
      expect(data.chiefComplaint).toBe("Teste via PUT draft");
    });

    test("HTTP 200 OK: supports alias PUT /consultations/:consultationId/anamnesis/draft", async () => {
      const f = createFixture();

      const res = await f.request(
        "PUT",
        `/organizations/clinica-a/consultations/${consultationAId}/anamnesis/draft`,
        {
          body: {
            version: 0,
            chiefComplaint: "Teste via PUT anamnesis draft",
          },
        },
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as ConsultationDetailResponse;
      expect(data.version).toBe(1);
      expect(data.chiefComplaint).toBe("Teste via PUT anamnesis draft");
    });

    test("HTTP 200 OK: supports alias PATCH /consultations/:consultationId/anamnesis/draft", async () => {
      const f = createFixture();

      const res = await f.request(
        "PATCH",
        `/organizations/clinica-a/consultations/${consultationAId}/anamnesis/draft`,
        {
          body: {
            version: 0,
            chiefComplaint: "Teste via PATCH anamnesis draft",
          },
        },
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as ConsultationDetailResponse;
      expect(data.version).toBe(1);
      expect(data.chiefComplaint).toBe("Teste via PATCH anamnesis draft");
    });

    test("HTTP 409 VERSION_CONFLICT: returns error when version does not match current version", async () => {
      const f = createFixture();

      const res = await f.request(
        "PATCH",
        `/organizations/clinica-a/consultations/${consultationAId}/draft`,
        {
          body: {
            version: 5, // Stale version
            chiefComplaint: "Tentativa concorrente",
          },
        },
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("VERSION_CONFLICT");
    });

    test("HTTP 409 DOCUMENT_STATE_CONFLICT: returns error when anamnesis is already approved", async () => {
      const f = createFixture();

      const res = await f.request(
        "PATCH",
        `/organizations/clinica-a/consultations/${consultationApprovedId}/draft`,
        {
          body: {
            version: 3,
            chiefComplaint: "Não pode editar aprovada",
          },
        },
      );

      expect(res.status).toBe(409);
      const body = (await res.json()) as {
        error: { code: string; message: string };
      };
      expect(body.error.code).toBe("DOCUMENT_STATE_CONFLICT");
    });

    test("HTTP 404 NOT_FOUND: cross-tenant access to foreign clinic consultation returns 404", async () => {
      const f = createFixture();

      const res = await f.request(
        "PATCH",
        `/organizations/clinica-a/consultations/${consultationBId}/draft`,
        {
          body: {
            version: 0,
            chiefComplaint: "Foreign clinic draft",
          },
        },
      );

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("NOT_FOUND");
    });

    test("HTTP 403 PERMISSION_DENIED: non-clinicians (RECEPTIONIST) cannot save consultation drafts", async () => {
      const f = createFixture();
      f.setRole("RECEPTIONIST");
      f.setUserId(receptionistId);

      const res = await f.request(
        "PATCH",
        `/organizations/clinica-a/consultations/${consultationAId}/draft`,
        {
          body: {
            version: 0,
            chiefComplaint: "Recepcionista tentando salvar",
          },
        },
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("PERMISSION_DENIED");
    });

    test("HTTP 401 UNAUTHENTICATED: unauthenticated request is rejected", async () => {
      const f = createFixture();

      const res = await f.request(
        "PATCH",
        `/organizations/clinica-a/consultations/${consultationAId}/draft`,
        {
          body: {
            version: 0,
            chiefComplaint: "Não autenticado",
          },
          token: null,
        },
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("UNAUTHENTICATED");
    });

    test("HTTP 200 OK: GET consultation detail includes chiefComplaint, clinicalNotes, anamnesisDraft", async () => {
      const f = createFixture();

      // Save draft first
      await f.request(
        "PATCH",
        `/organizations/clinica-a/consultations/${consultationAId}/draft`,
        {
          body: {
            version: 0,
            chiefComplaint: "Queixa confirmada via GET",
            clinicalNotes: "Notas confirmadas via GET",
            topics: { teste: "ok" },
          },
        },
      );

      const res = await f.request(
        "GET",
        `/organizations/clinica-a/consultations/${consultationAId}`,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as ConsultationDetailResponse;
      expect(data.version).toBe(1);
      expect(data.anamnesisStatus).toBe("DRAFT");
      expect(data.chiefComplaint).toBe("Queixa confirmada via GET");
      expect(data.clinicalNotes).toBe("Notas confirmadas via GET");
      expect(data.draftSavedAt).toBeDefined();
      expect(data.draftSavedById).toBe(profAId);
      expect(data.anamnesisDraft).toMatchObject({
        chiefComplaint: "Queixa confirmada via GET",
        clinicalNotes: "Notas confirmadas via GET",
        topics: { teste: "ok" },
      });
    });
  });
});
