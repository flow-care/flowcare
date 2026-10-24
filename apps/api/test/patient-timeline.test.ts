import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type {
  MembershipRole,
  MembershipStatus,
  PrismaClient,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { patientsModule } from "../src/modules/patients";
import type { PatientTimelineResponse } from "../src/modules/patients/model";
import { signSessionToken } from "../src/services/session-token";

const jwtSecret = "patient-timeline-test-secret-32ch";

interface StoredPatient {
  id: string;
  organizationId: string;
  fullName: string;
}

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
  registrationNumber: string | null;
  professionalTitle: string | null;
}

interface StoredConsultation {
  id: string;
  organizationId: string;
  patientId: string;
  professionalId: string;
  scheduledAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  anamnesisStatus: "PENDING" | "DRAFT" | "APPROVED";
  appointmentId: string | null;
  notes?: string | null;
}

interface StoredClinicalDocument {
  id: string;
  organizationId: string;
  patientId: string;
  authorId: string;
  type: "PRESCRIPTION" | "CERTIFICATE" | "REPORT" | "EXAM_REQUEST";
  title: string;
  status: "DRAFT" | "ISSUED" | "VOIDED";
  templateId: string | null;
  issuedAt: Date | null;
  voidedAt: Date | null;
  createdAt: Date;
}

interface StoredPatientAttachment {
  id: string;
  organizationId: string;
  patientId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  category: string | null;
  description: string | null;
  uploadedById: string;
  archivedAt: Date | null;
  createdAt: Date;
}

interface StoredAppointment {
  id: string;
  organizationId: string;
  patientId: string;
  professionalId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: "RESERVED" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  queueStatus:
    | "WAITING"
    | "ARRIVED"
    | "CALLED"
    | "IN_SERVICE"
    | "COMPLETED"
    | "NO_SHOW";
  notes: string | null;
}

interface StoredAuditLog {
  id?: string;
  organizationId?: string | null;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

function setup() {
  const users: StoredUser[] = [
    {
      id: "user-prof-a",
      fullName: "Dr. João Silva",
      registrationNumber: "CRM 12345",
      professionalTitle: "Médico Cardiologista",
    },
    {
      id: "user-admin-prof-a",
      fullName: "Dra. Ana Santos",
      registrationNumber: "CRM 67890",
      professionalTitle: "Médica Pediatra",
    },
    {
      id: "user-admin-a",
      fullName: "Roberto Gestor",
      registrationNumber: null,
      professionalTitle: null,
    },
    {
      id: "user-recep-a",
      fullName: "Carla Recepcionista",
      registrationNumber: null,
      professionalTitle: null,
    },
    {
      id: "user-prof-b",
      fullName: "Dr. Outra Clínica",
      registrationNumber: "CRM 99999",
      professionalTitle: "Médico",
    },
  ];

  const memberships: StoredMembership[] = [
    {
      id: "mem-prof-a",
      userId: "user-prof-a",
      organizationId: "org-a",
      orgSlug: "clinica-a",
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-admin-prof-a",
      userId: "user-admin-prof-a",
      organizationId: "org-a",
      orgSlug: "clinica-a",
      role: "ADMIN_PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-admin-a",
      userId: "user-admin-a",
      organizationId: "org-a",
      orgSlug: "clinica-a",
      role: "ADMIN",
      status: "ACTIVE",
    },
    {
      id: "mem-recep-a",
      userId: "user-recep-a",
      organizationId: "org-a",
      orgSlug: "clinica-a",
      role: "RECEPTIONIST",
      status: "ACTIVE",
    },
    {
      id: "mem-prof-b",
      userId: "user-prof-b",
      organizationId: "org-b",
      orgSlug: "clinica-b",
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
  ];

  const patients: StoredPatient[] = [
    {
      id: "patient-1",
      organizationId: "org-a",
      fullName: "Carlos Eduardo Oliveira",
    },
    {
      id: "patient-foreign",
      organizationId: "org-b",
      fullName: "Mariana Souza",
    },
  ];

  const consultations: StoredConsultation[] = [
    {
      id: "consultation-1",
      organizationId: "org-a",
      patientId: "patient-1",
      professionalId: "user-prof-a",
      scheduledAt: new Date("2026-10-14T10:00:00.000Z"),
      startedAt: new Date("2026-10-14T10:05:00.000Z"),
      completedAt: new Date("2026-10-14T10:45:00.000Z"),
      status: "COMPLETED",
      anamnesisStatus: "APPROVED",
      appointmentId: "appt-linked-1",
      notes: "Consulta de retorno pós-cirúrgico",
    },
    {
      id: "consultation-2",
      organizationId: "org-a",
      patientId: "patient-1",
      professionalId: "user-admin-prof-a",
      scheduledAt: new Date("2026-09-01T14:00:00.000Z"),
      startedAt: null,
      completedAt: new Date("2026-09-01T14:30:00.000Z"),
      status: "COMPLETED",
      anamnesisStatus: "APPROVED",
      appointmentId: null,
      notes: "Primeira consulta de avaliação",
    },
  ];

  const clinicalDocuments: StoredClinicalDocument[] = [
    {
      id: "document-1",
      organizationId: "org-a",
      patientId: "patient-1",
      authorId: "user-prof-a",
      type: "PRESCRIPTION",
      title: "Receita de Medicamentos Contínuos",
      status: "ISSUED",
      templateId: "template-1",
      issuedAt: new Date("2026-10-13T15:30:00.000Z"),
      voidedAt: null,
      createdAt: new Date("2026-10-13T15:00:00.000Z"),
    },
  ];

  const patientAttachments: StoredPatientAttachment[] = [
    {
      id: "attachment-1",
      organizationId: "org-a",
      patientId: "patient-1",
      fileName: "hemograma_completo.pdf",
      contentType: "application/pdf",
      sizeBytes: 204800,
      category: "LAB_EXAM",
      description: "Hemograma completo com plaquetas",
      uploadedById: "user-prof-a",
      archivedAt: null,
      createdAt: new Date("2026-10-12T09:00:00.000Z"),
    },
  ];

  const appointments: StoredAppointment[] = [
    {
      id: "appointment-1",
      organizationId: "org-a",
      patientId: "patient-1",
      professionalId: "user-prof-a",
      scheduledAt: new Date("2026-10-10T08:00:00.000Z"),
      durationMinutes: 30,
      status: "CONFIRMED",
      queueStatus: "WAITING",
      notes: "Agendamento de rotina semestral",
    },
  ];

  const auditLogs: StoredAuditLog[] = [];

  const getUser = (id: string) => users.find((u) => u.id === id) ?? null;

  const prisma = {
    session: {
      findFirst: async () => ({ id: "session-1", lastActiveAt: new Date() }),
    },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; organization: { slug: string } };
      }) => {
        const found = memberships.find(
          (m) =>
            m.userId === where.userId && m.orgSlug === where.organization.slug,
        );
        if (!found) return null;
        return {
          id: found.id,
          organizationId: found.organizationId,
          role: found.role,
          status: found.status,
        };
      },
    },
    patient: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return (
          patients.find(
            (p) =>
              p.id === where.id && p.organizationId === where.organizationId,
          ) ?? null
        );
      },
    },
    consultation: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        return consultations
          .filter(
            (c) =>
              c.organizationId === where.organizationId &&
              c.patientId === where.patientId,
          )
          .map((c) => {
            const prof = getUser(c.professionalId);
            return {
              id: c.id,
              scheduledAt: c.scheduledAt,
              startedAt: c.startedAt,
              completedAt: c.completedAt,
              status: c.status,
              anamnesisStatus: c.anamnesisStatus,
              appointmentId: c.appointmentId,
              appointment: c.notes ? { notes: c.notes } : null,
              professional: prof
                ? {
                    id: prof.id,
                    fullName: prof.fullName,
                    registrationNumber: prof.registrationNumber,
                    professionalTitle: prof.professionalTitle,
                  }
                : null,
            };
          });
      },
    },
    clinicalDocument: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        return clinicalDocuments
          .filter(
            (d) =>
              d.organizationId === where.organizationId &&
              d.patientId === where.patientId,
          )
          .map((d) => {
            const author = getUser(d.authorId);
            return {
              id: d.id,
              title: d.title,
              type: d.type,
              status: d.status,
              templateId: d.templateId,
              issuedAt: d.issuedAt,
              voidedAt: d.voidedAt,
              createdAt: d.createdAt,
              author: author
                ? {
                    id: author.id,
                    fullName: author.fullName,
                    registrationNumber: author.registrationNumber,
                    professionalTitle: author.professionalTitle,
                  }
                : null,
            };
          });
      },
    },
    patientAttachment: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        return patientAttachments
          .filter(
            (a) =>
              a.organizationId === where.organizationId &&
              a.patientId === where.patientId,
          )
          .map((a) => {
            const uploadedBy = getUser(a.uploadedById);
            return {
              id: a.id,
              fileName: a.fileName,
              contentType: a.contentType,
              sizeBytes: a.sizeBytes,
              category: a.category,
              description: a.description,
              uploadedById: a.uploadedById,
              archivedAt: a.archivedAt,
              createdAt: a.createdAt,
              uploadedBy: uploadedBy
                ? {
                    id: uploadedBy.id,
                    fullName: uploadedBy.fullName,
                    registrationNumber: uploadedBy.registrationNumber,
                    professionalTitle: uploadedBy.professionalTitle,
                  }
                : null,
            };
          });
      },
    },
    appointment: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        return appointments
          .filter(
            (apt) =>
              apt.organizationId === where.organizationId &&
              apt.patientId === where.patientId,
          )
          .map((apt) => {
            const prof = getUser(apt.professionalId);
            return {
              id: apt.id,
              scheduledAt: apt.scheduledAt,
              durationMinutes: apt.durationMinutes,
              status: apt.status,
              queueStatus: apt.queueStatus,
              notes: apt.notes,
              professional: prof
                ? {
                    id: prof.id,
                    fullName: prof.fullName,
                    registrationNumber: prof.registrationNumber,
                    professionalTitle: prof.professionalTitle,
                  }
                : null,
            };
          });
      },
    },
    auditLog: {
      create: async ({ data }: { data: StoredAuditLog }) => {
        const record = { id: `audit-${auditLogs.length + 1}`, ...data };
        auditLogs.push(record);
        return record;
      },
    },
  } as unknown as PrismaClient;

  const app = new Elysia({ prefix: "/api" })
    .onError(({ code, error, status }) => {
      if (error instanceof ApiError) {
        return status(error.httpStatus, {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        });
      }
      if (code === "NOT_FOUND") {
        return status(404, {
          error: { code: "NOT_FOUND", message: "Recurso não encontrado." },
        });
      }
      if (code === "VALIDATION") {
        return status(400, {
          error: {
            code: "VALIDATION_ERROR",
            message: "Dados inválidos.",
          },
        });
      }
      return status(500, {
        error: { code: "INTERNAL", message: "Erro interno." },
      });
    })
    .use(patientsModule({ prisma, jwtSecret }));

  const tokenFor = (userId: string) =>
    signSessionToken({ sid: "session-1", sub: userId }, jwtSecret, 3600);

  const request = (
    path: string,
    init: RequestInit & { userId?: string | null } = {},
  ) => {
    const { userId = "user-prof-a", headers, ...rest } = init;
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

  return { app, request, auditLogs, patients };
}

describe("Patient Timeline (#254)", () => {
  test("returns events from consultations, documents, attachments, and appointments sorted strictly descending by timestamp", async () => {
    const { request } = setup();

    const res = await request(
      "/organizations/clinica-a/patients/patient-1/timeline",
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as PatientTimelineResponse;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(5);

    // Strict chronological DESC sorting:
    // 1. consultation-1: 2026-10-14T10:05:00.000Z (startedAt)
    // 2. document-1:     2026-10-13T15:30:00.000Z (issuedAt)
    // 3. attachment-1:   2026-10-12T09:00:00.000Z (createdAt)
    // 4. appointment-1:  2026-10-10T08:00:00.000Z (scheduledAt)
    // 5. consultation-2: 2026-09-01T14:00:00.000Z (scheduledAt)
    const [item0, item1, item2, item3, item4] = body.data;
    if (!item0 || !item1 || !item2 || !item3 || !item4) {
      throw new Error("Expected 5 items in timeline");
    }

    expect(item0.id).toBe("consultation-1");
    expect(item0.eventType).toBe("CONSULTATION");
    expect(item0.timestamp).toBe("2026-10-14T10:05:00.000Z");
    expect(item0.summary).toBe("Consulta de retorno pós-cirúrgico");
    expect(item0.status).toBe("COMPLETED");
    expect(item0.resourceId).toBe("consultation-1");
    expect(item0.professional).toEqual({
      id: "user-prof-a",
      name: "Dr. João Silva",
      registrationNumber: "CRM 12345",
      professionalTitle: "Médico Cardiologista",
    });

    expect(item1.id).toBe("document-1");
    expect(item1.eventType).toBe("DOCUMENT");
    expect(item1.timestamp).toBe("2026-10-13T15:30:00.000Z");
    expect(item1.summary).toBe("Receita de Medicamentos Contínuos");
    expect(item1.status).toBe("ISSUED");
    expect(item1.resourceId).toBe("document-1");
    expect(item1.professional).toEqual({
      id: "user-prof-a",
      name: "Dr. João Silva",
      registrationNumber: "CRM 12345",
      professionalTitle: "Médico Cardiologista",
    });

    expect(item2.id).toBe("attachment-1");
    expect(item2.eventType).toBe("ATTACHMENT");
    expect(item2.timestamp).toBe("2026-10-12T09:00:00.000Z");
    expect(item2.summary).toBe("Hemograma completo com plaquetas");
    expect(item2.status).toBe("ACTIVE");
    expect(item2.resourceId).toBe("attachment-1");

    expect(item3.id).toBe("appointment-1");
    expect(item3.eventType).toBe("APPOINTMENT");
    expect(item3.timestamp).toBe("2026-10-10T08:00:00.000Z");
    expect(item3.summary).toBe("Agendamento de rotina semestral");
    expect(item3.status).toBe("CONFIRMED");
    expect(item3.resourceId).toBe("appointment-1");

    expect(item4.id).toBe("consultation-2");
    expect(item4.eventType).toBe("CONSULTATION");
    expect(item4.timestamp).toBe("2026-09-01T14:00:00.000Z");

    expect(body.pageInfo).toEqual({
      limit: 20,
      hasNextPage: false,
      nextCursor: null,
      totalCount: 5,
      page: 1,
    });
  });

  test("records alias endpoint returns the same result", async () => {
    const { request } = setup();

    const res = await request(
      "/organizations/clinica-a/patients/patient-1/records",
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as PatientTimelineResponse;
    expect(body.data.length).toBe(5);
    expect(body.data[0]?.id).toBe("consultation-1");
  });

  test("filters events by eventType / type", async () => {
    const { request } = setup();

    // Consultation only
    const resConsultation = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?type=consultation",
    );
    expect(resConsultation.status).toBe(200);
    const bodyConsultation =
      (await resConsultation.json()) as PatientTimelineResponse;
    expect(bodyConsultation.data.length).toBe(2);
    expect(
      bodyConsultation.data.every((e) => e.eventType === "CONSULTATION"),
    ).toBe(true);

    // Document only
    const resDoc = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?eventType=document",
    );
    expect(resDoc.status).toBe(200);
    const bodyDoc = (await resDoc.json()) as PatientTimelineResponse;
    expect(bodyDoc.data.length).toBe(1);
    expect(bodyDoc.data[0]?.eventType).toBe("DOCUMENT");
    expect(bodyDoc.data[0]?.id).toBe("document-1");

    // Attachment only
    const resAtt = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?type=attachment",
    );
    expect(resAtt.status).toBe(200);
    const bodyAtt = (await resAtt.json()) as PatientTimelineResponse;
    expect(bodyAtt.data.length).toBe(1);
    expect(bodyAtt.data[0]?.eventType).toBe("ATTACHMENT");
    expect(bodyAtt.data[0]?.id).toBe("attachment-1");

    // Appointment only
    const resAppt = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?eventType=appointment",
    );
    expect(resAppt.status).toBe(200);
    const bodyAppt = (await resAppt.json()) as PatientTimelineResponse;
    expect(bodyAppt.data.length).toBe(1);
    expect(bodyAppt.data[0]?.eventType).toBe("APPOINTMENT");
    expect(bodyAppt.data[0]?.id).toBe("appointment-1");

    // Case-insensitive filter
    const resCase = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?eventType=CONSULTATION",
    );
    expect(resCase.status).toBe(200);
    const bodyCase = (await resCase.json()) as PatientTimelineResponse;
    expect(bodyCase.data.length).toBe(2);
  });

  test("filters events by date range (startDate & endDate)", async () => {
    const { request } = setup();

    // Range Oct 11 to Oct 13 -> includes document-1 (Oct 13) and attachment-1 (Oct 12)
    const res = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?startDate=2026-10-11&endDate=2026-10-13",
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as PatientTimelineResponse;
    expect(body.data.length).toBe(2);
    expect(body.data[0]?.id).toBe("document-1");
    expect(body.data[1]?.id).toBe("attachment-1");
  });

  test("denies RECEPTIONIST with 403 PERMISSION_DENIED", async () => {
    const { request } = setup();

    // RECEPTIONIST
    const resRecep = await request(
      "/organizations/clinica-a/patients/patient-1/timeline",
      { userId: "user-recep-a" },
    );
    expect(resRecep.status).toBe(403);
    const bodyRecep = (await resRecep.json()) as {
      error: { code: string; details?: { requiredPermission?: string } };
    };
    expect(bodyRecep.error.code).toBe("PERMISSION_DENIED");
    expect(bodyRecep.error.details?.requiredPermission).toBe(
      "patients:read_history",
    );
  });

  test("permits ADMIN, ADMIN_PROFESSIONAL and PROFESSIONAL", async () => {
    const { request } = setup();

    // ADMIN (dono da clínica) também lê a timeline clínica
    const resAdmin = await request(
      "/organizations/clinica-a/patients/patient-1/timeline",
      { userId: "user-admin-a" },
    );
    expect(resAdmin.status).toBe(200);

    // ADMIN_PROFESSIONAL
    const resAdminProf = await request(
      "/organizations/clinica-a/patients/patient-1/timeline",
      { userId: "user-admin-prof-a" },
    );
    expect(resAdminProf.status).toBe(200);

    // PROFESSIONAL
    const resProf = await request(
      "/organizations/clinica-a/patients/patient-1/timeline",
      { userId: "user-prof-a" },
    );
    expect(resProf.status).toBe(200);
  });

  test("returns 401 UNAUTHENTICATED for unauthenticated requests", async () => {
    const { request } = setup();

    const res = await request(
      "/organizations/clinica-a/patients/patient-1/timeline",
      { userId: null },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  test("returns 404 NOT_FOUND when patient belongs to another clinic", async () => {
    const { request } = setup();

    // patient-foreign belongs to org-b, not clinica-a
    const res = await request(
      "/organizations/clinica-a/patients/patient-foreign/timeline",
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Paciente não encontrado.");
  });

  test("records AuditLog entry for LGPD compliance", async () => {
    const { request, auditLogs } = setup();

    expect(auditLogs.length).toBe(0);

    const res = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?type=consultation",
      { userId: "user-prof-a" },
    );
    expect(res.status).toBe(200);

    expect(auditLogs.length).toBe(1);
    const log = auditLogs[0];
    if (!log) throw new Error("Expected audit log");
    expect(log.action).toBe("PATIENT_TIMELINE_ACCESSED");
    expect(log.targetType).toBe("PATIENT");
    expect(log.targetId).toBe("patient-1");
    expect(log.actorUserId).toBe("user-prof-a");
    expect(log.organizationId).toBe("org-a");
    expect(log.metadata).toMatchObject({
      eventType: "consultation",
    });
  });

  test("supports pagination with limit and cursor", async () => {
    const { request } = setup();

    // Page 1: limit 2
    const resPage1 = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?limit=2",
    );
    expect(resPage1.status).toBe(200);
    const body1 = (await resPage1.json()) as PatientTimelineResponse;
    expect(body1.data.length).toBe(2);
    expect(body1.data[0]?.id).toBe("consultation-1");
    expect(body1.data[1]?.id).toBe("document-1");
    expect(body1.pageInfo.hasNextPage).toBe(true);
    expect(body1.pageInfo.nextCursor).toBe("document-1");

    // Page 2: with cursor
    const resPage2 = await request(
      `/organizations/clinica-a/patients/patient-1/timeline?limit=2&cursor=${body1.pageInfo.nextCursor}`,
    );
    expect(resPage2.status).toBe(200);
    const body2 = (await resPage2.json()) as PatientTimelineResponse;
    expect(body2.data.length).toBe(2);
    expect(body2.data[0]?.id).toBe("attachment-1");
    expect(body2.data[1]?.id).toBe("appointment-1");
    expect(body2.pageInfo.hasNextPage).toBe(true);
    expect(body2.pageInfo.nextCursor).toBe("appointment-1");

    // Page 3: with cursor
    const resPage3 = await request(
      `/organizations/clinica-a/patients/patient-1/timeline?limit=2&cursor=${body2.pageInfo.nextCursor}`,
    );
    expect(resPage3.status).toBe(200);
    const body3 = (await resPage3.json()) as PatientTimelineResponse;
    expect(body3.data.length).toBe(1);
    expect(body3.data[0]?.id).toBe("consultation-2");
    expect(body3.pageInfo.hasNextPage).toBe(false);
    expect(body3.pageInfo.nextCursor).toBeNull();
  });

  test("supports page-based pagination", async () => {
    const { request } = setup();

    const resPage2 = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?limit=2&page=2",
    );
    expect(resPage2.status).toBe(200);
    const body = (await resPage2.json()) as PatientTimelineResponse;
    expect(body.data.length).toBe(2);
    expect(body.data[0]?.id).toBe("attachment-1");
    expect(body.data[1]?.id).toBe("appointment-1");
    expect(body.pageInfo.page).toBe(2);
  });

  test("validates query parameters and returns 400 for invalid inputs", async () => {
    const { request } = setup();

    // Invalid startDate format
    const resBadDate = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?startDate=2026-15-99",
    );
    expect(resBadDate.status).toBe(400);

    // startDate after endDate
    const resInvertedDate = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?startDate=2026-10-20&endDate=2026-10-10",
    );
    expect(resInvertedDate.status).toBe(400);
    const bodyInverted = (await resInvertedDate.json()) as {
      error: { message: string };
    };
    expect(bodyInverted.error.message).toBe(
      "A data inicial não pode ser posterior à data final.",
    );

    // Invalid cursor
    const resBadCursor = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?cursor=non-existent-cursor-id",
    );
    expect(resBadCursor.status).toBe(400);

    // Invalid limit (0 or > 100)
    const resBadLimit = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?limit=0",
    );
    expect(resBadLimit.status).toBe(400);

    // Invalid eventType
    const resBadType = await request(
      "/organizations/clinica-a/patients/patient-1/timeline?type=invalid_type",
    );
    expect(resBadType.status).toBe(400);
  });
});
