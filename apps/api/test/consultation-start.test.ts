import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type {
  AnamnesisStatus,
  AppointmentStatus,
  ConsultationStatus,
  MembershipRole,
  MembershipStatus,
  Prisma,
  PrismaClient,
  ReceptionQueueStatus,
} from "../src/generated/prisma/client";
import type { ConsultationDetailResponse } from "../src/modules/consultations/model";
import { signSessionToken } from "../src/services/session-token";

const secret = "consultation-start-secret-32-chars!!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const profAId = "33333333-3333-4333-8333-333333333331";
const profBId = "33333333-3333-4333-8333-333333333332";

const patient1ClinicAId = "44444444-4444-4444-8444-444444444441";
const patient2ClinicAId = "44444444-4444-4444-8444-444444444442";
const patientClinicBId = "44444444-4444-4444-8444-444444444449";

const appointment1ClinicAId = "55555555-5555-4555-8555-555555555551";
const appointmentReservedId = "55555555-5555-4555-8555-555555555552";
const appointmentClinicBId = "55555555-5555-4555-8555-555555555559";

interface StoredPatient {
  id: string;
  organizationId: string;
  fullName: string;
}

interface StoredAppointment {
  id: string;
  organizationId: string;
  patientId: string;
  professionalId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  queueStatus: ReceptionQueueStatus;
  arrivedAt: Date | null;
  queueUpdatedAt: Date | null;
  queueUpdatedById: string | null;
  version: number;
}

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
  anamnesisTopicRevisionId: string | null;
  version: number;
  createdAt: Date;
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

function createFixture() {
  let role: MembershipRole = "PROFESSIONAL";
  let membershipStatus: MembershipStatus = "ACTIVE";
  let currentUserId: string = profAId;
  const sessionActive = true;
  const allowedOrgSlugs = new Set<string>(["clinica-a"]);

  const patients: StoredPatient[] = [
    {
      id: patient1ClinicAId,
      organizationId: clinicAId,
      fullName: "João Carlos Oliveira",
    },
    {
      id: patient2ClinicAId,
      organizationId: clinicAId,
      fullName: "Maria Fernanda Santos",
    },
    {
      id: patientClinicBId,
      organizationId: clinicBId,
      fullName: "Paciente da Outra Clínica",
    },
  ];

  const appointments: StoredAppointment[] = [
    {
      id: appointment1ClinicAId,
      organizationId: clinicAId,
      patientId: patient1ClinicAId,
      professionalId: profAId,
      scheduledAt: new Date("2026-10-15T13:00:00.000Z"),
      durationMinutes: 30,
      status: "CONFIRMED",
      queueStatus: "ARRIVED",
      arrivedAt: new Date("2026-10-15T12:50:00.000Z"),
      queueUpdatedAt: new Date("2026-10-15T12:50:00.000Z"),
      queueUpdatedById: profAId,
      version: 1,
    },
    {
      id: appointmentReservedId,
      organizationId: clinicAId,
      patientId: patient1ClinicAId,
      professionalId: profAId,
      scheduledAt: new Date("2026-10-15T14:00:00.000Z"),
      durationMinutes: 30,
      status: "RESERVED",
      queueStatus: "WAITING",
      arrivedAt: null,
      queueUpdatedAt: null,
      queueUpdatedById: null,
      version: 0,
    },
    {
      id: appointmentClinicBId,
      organizationId: clinicBId,
      patientId: patientClinicBId,
      professionalId: profBId,
      scheduledAt: new Date("2026-10-15T15:00:00.000Z"),
      durationMinutes: 30,
      status: "CONFIRMED",
      queueStatus: "WAITING",
      arrivedAt: null,
      queueUpdatedAt: null,
      queueUpdatedById: null,
      version: 0,
    },
  ];

  const consultations: StoredConsultation[] = [];
  const auditLogs: StoredAuditLog[] = [];

  const users = [
    {
      id: profAId,
      fullName: "Dra. Ana Costa",
      professionalTitle: "Médica Cardiologista",
      registrationNumber: "CRM/CE 12345",
    },
    {
      id: profBId,
      fullName: "Dr. Bruno Lima",
      professionalTitle: "Médico Clínico",
      registrationNumber: "CRM/CE 67890",
    },
  ];

  const prisma = {
    session: {
      findFirst: async () =>
        sessionActive ? { id: "session-1", lastActiveAt: new Date() } : null,
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

        if (where.organizationId) {
          const matchOrg = where.organizationId === clinicAId;
          const matchUser = where.userId
            ? where.userId === currentUserId || where.userId === profAId
            : true;
          const matchRole = where.role?.in
            ? where.role.in.includes(role)
            : true;
          const matchStatus = where.status
            ? where.status === membershipStatus
            : true;

          if (matchOrg && matchUser && matchRole && matchStatus) {
            return {
              id: "membership-1",
              organizationId: clinicAId,
              role,
              status: membershipStatus,
            };
          }
          return null;
        }

        return null;
      },
    },
    patient: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) => {
        const found = patients.find(
          (p) => p.id === where.id && p.organizationId === where.organizationId,
        );
        return found ? { id: found.id, fullName: found.fullName } : null;
      },
    },
    appointment: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) => {
        const found = appointments.find(
          (a) => a.id === where.id && a.organizationId === where.organizationId,
        );
        return found ? { ...found } : null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<StoredAppointment>;
      }) => {
        const appt = appointments.find((a) => a.id === where.id);
        if (!appt) throw new Error("Appointment not found");
        Object.assign(appt, data);
        return { ...appt };
      },
    },
    consultation: {
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string;
          appointmentId?: string;
          organizationId: string;
        };
      }) => {
        const found = consultations.find((c) => {
          if (c.organizationId !== where.organizationId) return false;
          if (where.id && c.id !== where.id) return false;
          if (where.appointmentId && c.appointmentId !== where.appointmentId)
            return false;
          return true;
        });
        if (!found) return null;

        const patient = patients.find((p) => p.id === found.patientId);
        const professional = users.find((u) => u.id === found.professionalId);

        return {
          ...found,
          patient: patient
            ? { id: patient.id, fullName: patient.fullName }
            : null,
          professional: professional ? { ...professional } : null,
        };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.appointmentId) {
          const duplicate = consultations.some(
            (c) =>
              c.appointmentId === data.appointmentId &&
              c.organizationId === data.organizationId,
          );
          if (duplicate) {
            const err = new Error("Unique constraint failed") as Error & {
              code: string;
            };
            err.code = "P2002";
            throw err;
          }
        }

        const now = new Date();
        const record: StoredConsultation = {
          id: (data.id as string | undefined) ?? crypto.randomUUID(),
          organizationId: data.organizationId as string,
          appointmentId: (data.appointmentId as string | null) ?? null,
          patientId: data.patientId as string,
          professionalId: data.professionalId as string,
          scheduledAt: (data.scheduledAt as Date) ?? now,
          startedAt: (data.startedAt as Date | null) ?? now,
          completedAt: null,
          status: (data.status as ConsultationStatus) ?? "IN_PROGRESS",
          anamnesisStatus:
            (data.anamnesisStatus as AnamnesisStatus) ?? "PENDING",
          anamnesisTopicRevisionId: null,
          version: 0,
          createdAt: now,
          updatedAt: now,
        };
        consultations.push(record);

        const patient = patients.find((p) => p.id === record.patientId);
        const professional = users.find((u) => u.id === record.professionalId);

        return {
          ...record,
          patient: patient
            ? { id: patient.id, fullName: patient.fullName }
            : null,
          professional: professional ? { ...professional } : null,
        };
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
      findUnique: async ({ where }: { where: { id: string } }) => {
        return users.find((u) => u.id === where.id) ?? null;
      },
    },
    $transaction: async <T>(
      callback: (tx: typeof prisma) => Promise<T>,
    ): Promise<T> => callback(prisma),
  } as unknown as PrismaClient;

  const env = {
    jwtSecret: secret,
    corsOrigin: "http://localhost:3000",
    wahaBaseUrl: "http://127.0.0.1:1",
    version: "test",
    webAppUrl: "http://localhost:3000",
  } as Env;

  const app = createApp(env, { prisma, mailer: {} as never });
  const token = signSessionToken(
    { sid: "session-1", sub: profAId },
    secret,
    3600,
  );

  const request = (
    method: "GET" | "POST",
    path: string,
    options: {
      body?: unknown;
      authenticated?: boolean;
    } = {},
  ) => {
    const { body, authenticated = true } = options;
    const headers: Record<string, string> = {};
    if (authenticated) {
      headers.authorization = `Bearer ${token}`;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    return app.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  };

  return {
    post: (path: string, body?: unknown, authenticated = true) =>
      request("POST", path, { body, authenticated }),
    get: (path: string, authenticated = true) =>
      request("GET", path, { authenticated }),
    setRole: (value: MembershipRole) => {
      role = value;
    },
    setMembershipStatus: (value: MembershipStatus) => {
      membershipStatus = value;
    },
    setCurrentUserId: (id: string) => {
      currentUserId = id;
    },
    allowClinicB: () => {
      allowedOrgSlugs.add("clinica-b");
    },
    appointments,
    consultations,
    auditLogs,
  };
}

describe("Clinical Consultation Start (Issue #263)", () => {
  test("starts consultation linked to patient and appointment in same clinic with 201 Created", async () => {
    const f = createFixture();

    const res = await f.post("/organizations/clinica-a/consultations", {
      appointmentId: appointment1ClinicAId,
      patientId: patient1ClinicAId,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as ConsultationDetailResponse;

    expect(body.id).toBeDefined();
    expect(body.consultationId).toBe(body.id);
    expect(body.organizationId).toBe(clinicAId);
    expect(body.patientId).toBe(patient1ClinicAId);
    expect(body.professionalId).toBe(profAId);
    expect(body.appointmentId).toBe(appointment1ClinicAId);
    expect(body.status).toBe("IN_PROGRESS");
    expect(body.anamnesisStatus).toBe("PENDING");
    expect(body.startedAt).toBeDefined();
    expect(body.patient?.fullName).toBe("João Carlos Oliveira");
    expect(body.professional?.fullName).toBe("Dra. Ana Costa");

    // Appointment status updated to IN_PROGRESS and queueStatus to IN_SERVICE
    const updatedAppt = f.appointments.find(
      (a) => a.id === appointment1ClinicAId,
    );
    expect(updatedAppt?.status).toBe("IN_PROGRESS");
    expect(updatedAppt?.queueStatus).toBe("IN_SERVICE");

    // AuditLog recorded
    expect(f.auditLogs.length).toBe(1);
    const log = f.auditLogs[0];
    if (!log) throw new Error("Expected audit log");
    expect(log.action).toBe("CONSULTATION_STARTED");
    expect(log.targetType).toBe("CONSULTATION");
    expect(log.targetId).toBe(body.id);
    expect(log.organizationId).toBe(clinicAId);
    expect(log.actorUserId).toBe(profAId);
    expect(log.metadata).toMatchObject({
      patientId: patient1ClinicAId,
      professionalId: profAId,
      appointmentId: appointment1ClinicAId,
    });
  });

  test("repeating start for the same appointment is idempotent and returns existing consultation with 200 OK without duplicates", async () => {
    const f = createFixture();

    // First call: creates consultation
    const firstRes = await f.post("/organizations/clinica-a/consultations", {
      appointmentId: appointment1ClinicAId,
      patientId: patient1ClinicAId,
    });
    expect(firstRes.status).toBe(201);
    const firstBody = (await firstRes.json()) as ConsultationDetailResponse;
    expect(f.consultations.length).toBe(1);
    expect(f.auditLogs.length).toBe(1);

    // Second call: returns existing consultation with 200 OK
    const secondRes = await f.post("/organizations/clinica-a/consultations", {
      appointmentId: appointment1ClinicAId,
      patientId: patient1ClinicAId,
    });
    expect(secondRes.status).toBe(200);
    const secondBody = (await secondRes.json()) as ConsultationDetailResponse;

    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.consultationId).toBe(firstBody.id);
    expect(secondBody.status).toBe("IN_PROGRESS");

    // No duplicate consultation created
    expect(f.consultations.length).toBe(1);
    // No duplicate audit log created
    expect(f.auditLogs.length).toBe(1);
  });

  test("works through alias POST /organizations/:orgSlug/consultations/start and updates RESERVED appointment to IN_PROGRESS", async () => {
    const f = createFixture();

    const res = await f.post("/organizations/clinica-a/consultations/start", {
      appointmentId: appointmentReservedId,
      patientId: patient1ClinicAId,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as ConsultationDetailResponse;
    expect(body.status).toBe("IN_PROGRESS");
    expect(body.appointmentId).toBe(appointmentReservedId);

    const updatedAppt = f.appointments.find(
      (a) => a.id === appointmentReservedId,
    );
    expect(updatedAppt?.status).toBe("IN_PROGRESS");
    expect(updatedAppt?.queueStatus).toBe("IN_SERVICE");

    // Calling alias again returns 200 OK idempotent
    const repeatRes = await f.post(
      "/organizations/clinica-a/consultations/start",
      {
        appointmentId: appointmentReservedId,
        patientId: patient1ClinicAId,
      },
    );
    expect(repeatRes.status).toBe(200);
    const repeatBody = (await repeatRes.json()) as ConsultationDetailResponse;
    expect(repeatBody.id).toBe(body.id);
  });

  test("starts direct walk-in consultation without appointment with valid patient", async () => {
    const f = createFixture();

    const res = await f.post("/organizations/clinica-a/consultations", {
      patientId: patient2ClinicAId,
      notes: "Atendimento imediato sem agendamento",
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as ConsultationDetailResponse;

    expect(body.id).toBeDefined();
    expect(body.appointmentId).toBeNull();
    expect(body.patientId).toBe(patient2ClinicAId);
    expect(body.status).toBe("IN_PROGRESS");
    expect(body.anamnesisStatus).toBe("PENDING");
    expect(body.patient?.fullName).toBe("Maria Fernanda Santos");

    // Audit log records direct consultation with appointmentId: null and notes
    expect(f.auditLogs.length).toBe(1);
    const directLog = f.auditLogs[0];
    if (!directLog) throw new Error("Expected direct consultation audit log");
    expect(directLog.action).toBe("CONSULTATION_STARTED");
    expect(directLog.metadata).toMatchObject({
      patientId: patient2ClinicAId,
      professionalId: profAId,
      appointmentId: null,
      notes: "Atendimento imediato sem agendamento",
    });
  });

  test("rejects patient from another clinic with 404 NOT_FOUND", async () => {
    const f = createFixture();

    const res = await f.post("/organizations/clinica-a/consultations", {
      patientId: patientClinicBId,
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(f.consultations.length).toBe(0);
    expect(f.auditLogs.length).toBe(0);
  });

  test("rejects appointment from another clinic with 404 NOT_FOUND", async () => {
    const f = createFixture();

    const res = await f.post("/organizations/clinica-a/consultations", {
      appointmentId: appointmentClinicBId,
      patientId: patient1ClinicAId,
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(f.consultations.length).toBe(0);
    expect(f.auditLogs.length).toBe(0);
  });

  test("rejects appointment where patient does not match with 400 VALIDATION_ERROR", async () => {
    const f = createFixture();

    // appointment1ClinicAId belongs to patient1ClinicAId, but we send patient2ClinicAId
    const res = await f.post("/organizations/clinica-a/consultations", {
      appointmentId: appointment1ClinicAId,
      patientId: patient2ClinicAId,
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: { field: "patientId" },
      },
    });
    expect(f.consultations.length).toBe(0);
    expect(f.auditLogs.length).toBe(0);
  });

  test("enforces RBAC on POST: RECEPTIONIST receives 403 PERMISSION_DENIED", async () => {
    const f = createFixture();

    for (const deniedRole of ["RECEPTIONIST"] as const) {
      f.setRole(deniedRole);
      const res = await f.post("/organizations/clinica-a/consultations", {
        appointmentId: appointment1ClinicAId,
        patientId: patient1ClinicAId,
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({
        error: {
          code: "PERMISSION_DENIED",
          details: { requiredPermission: "consultations:write" },
        },
      });
    }

    expect(f.consultations.length).toBe(0);
    expect(f.auditLogs.length).toBe(0);
  });

  test("allows ADMIN (clinic owner) to start consultation with 201 Created", async () => {
    const f = createFixture();
    f.setRole("ADMIN");

    const res = await f.post("/organizations/clinica-a/consultations", {
      appointmentId: appointment1ClinicAId,
      patientId: patient1ClinicAId,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as ConsultationDetailResponse;
    expect(body.status).toBe("IN_PROGRESS");
    expect(f.consultations.length).toBe(1);
  });

  test("allows ADMIN_PROFESSIONAL to start consultation with 201 Created", async () => {
    const f = createFixture();
    f.setRole("ADMIN_PROFESSIONAL");

    const res = await f.post("/organizations/clinica-a/consultations", {
      appointmentId: appointment1ClinicAId,
      patientId: patient1ClinicAId,
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as ConsultationDetailResponse;
    expect(body.status).toBe("IN_PROGRESS");
    expect(f.consultations.length).toBe(1);
  });

  test("GET /organizations/:orgSlug/consultations/:consultationId returns consultation detail", async () => {
    const f = createFixture();

    // Start consultation first
    const createRes = await f.post("/organizations/clinica-a/consultations", {
      appointmentId: appointment1ClinicAId,
      patientId: patient1ClinicAId,
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as ConsultationDetailResponse;

    // Get consultation detail
    const getRes = await f.get(
      `/organizations/clinica-a/consultations/${created.id}`,
    );
    expect(getRes.status).toBe(200);
    const detail = (await getRes.json()) as ConsultationDetailResponse;

    expect(detail.id).toBe(created.id);
    expect(detail.consultationId).toBe(created.id);
    expect(detail.patientId).toBe(patient1ClinicAId);
    expect(detail.status).toBe("IN_PROGRESS");
    expect(detail.anamnesisStatus).toBe("PENDING");
    expect(detail.patient?.fullName).toBe("João Carlos Oliveira");
    expect(detail.professional?.fullName).toBe("Dra. Ana Costa");
  });

  test("enforces RBAC on GET by ID: RECEPTIONIST receives 403 PERMISSION_DENIED", async () => {
    const f = createFixture();

    // Start consultation first as PROFESSIONAL
    const createRes = await f.post("/organizations/clinica-a/consultations", {
      appointmentId: appointment1ClinicAId,
      patientId: patient1ClinicAId,
    });
    const created = (await createRes.json()) as ConsultationDetailResponse;

    // Try accessing as RECEPTIONIST
    for (const deniedRole of ["RECEPTIONIST"] as const) {
      f.setRole(deniedRole);
      const res = await f.get(
        `/organizations/clinica-a/consultations/${created.id}`,
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body).toMatchObject({
        error: {
          code: "PERMISSION_DENIED",
          details: { requiredPermission: "consultations:read" },
        },
      });
    }
  });

  test("GET by ID returns 404 NOT_FOUND for non-existent consultation or consultation belonging to another clinic", async () => {
    const f = createFixture();
    f.allowClinicB();

    // Non-existent ID
    const notFoundRes = await f.get(
      "/organizations/clinica-a/consultations/99999999-9999-4999-8999-999999999999",
    );
    expect(notFoundRes.status).toBe(404);
    expect(await notFoundRes.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });

    // Create consultation in clinica-a
    const createRes = await f.post("/organizations/clinica-a/consultations", {
      appointmentId: appointment1ClinicAId,
      patientId: patient1ClinicAId,
    });
    const created = (await createRes.json()) as ConsultationDetailResponse;

    // Try reading clinica-a consultation from clinica-b context
    const crossTenantRes = await f.get(
      `/organizations/clinica-b/consultations/${created.id}`,
    );
    expect(crossTenantRes.status).toBe(404);
    expect(await crossTenantRes.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  test("rejects unauthenticated requests with 401 UNAUTHENTICATED and suspended membership with 403 MEMBERSHIP_INACTIVE", async () => {
    const f = createFixture();

    const unauthPost = await f.post(
      "/organizations/clinica-a/consultations",
      { patientId: patient1ClinicAId },
      false,
    );
    expect(unauthPost.status).toBe(401);
    expect(await unauthPost.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });

    const unauthGet = await f.get(
      "/organizations/clinica-a/consultations/11111111-1111-4111-8111-111111111111",
      false,
    );
    expect(unauthGet.status).toBe(401);

    f.setMembershipStatus("SUSPENDED");
    const suspendedPost = await f.post(
      "/organizations/clinica-a/consultations",
      { patientId: patient1ClinicAId },
    );
    expect(suspendedPost.status).toBe(403);
    expect(await suspendedPost.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });
  });
});
