import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type {
  MembershipRole,
  MembershipStatus,
  PrismaClient,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { patientsModule } from "../src/modules/patients";
import type {
  PatientResponse,
  UpdatePatientBody,
} from "../src/modules/patients/model";
import { PatientsService } from "../src/modules/patients/service";
import { signSessionToken } from "../src/services/session-token";

const jwtSecret = "patient-update-test-secret-32chars!";

const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";
const patientOneId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const patientTwoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const clinicBPatientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

interface StoredPatient {
  id: string;
  organizationId: string;
  fullName: string;
  normalizedName?: string;
  cpf: string;
  birthDate: Date;
  phone: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredAuditLog {
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

interface MembershipRecord {
  id: string;
  userId: string;
  organizationId: string;
  slug: string;
  role: MembershipRole;
  status: MembershipStatus;
}

function setup() {
  const patients = new Map<string, StoredPatient>([
    [
      patientOneId,
      {
        id: patientOneId,
        organizationId: clinicAId,
        fullName: "João Souza",
        cpf: "52998224725",
        birthDate: new Date("1985-05-20T00:00:00.000Z"),
        phone: "11977776666",
        version: 0,
        createdAt: new Date("2026-10-10T12:00:00.000Z"),
        updatedAt: new Date("2026-10-10T12:00:00.000Z"),
      },
    ],
    [
      patientTwoId,
      {
        id: patientTwoId,
        organizationId: clinicAId,
        fullName: "Maria Oliveira",
        cpf: "11144477735",
        birthDate: new Date("1990-08-15T00:00:00.000Z"),
        phone: "11966665555",
        version: 0,
        createdAt: new Date("2026-10-10T13:00:00.000Z"),
        updatedAt: new Date("2026-10-10T13:00:00.000Z"),
      },
    ],
    [
      clinicBPatientId,
      {
        id: clinicBPatientId,
        organizationId: clinicBId,
        fullName: "Carlos Pereira",
        cpf: "93541134780",
        birthDate: new Date("1978-03-10T00:00:00.000Z"),
        phone: "21999998888",
        version: 0,
        createdAt: new Date("2026-10-10T14:00:00.000Z"),
        updatedAt: new Date("2026-10-10T14:00:00.000Z"),
      },
    ],
  ]);

  const memberships: MembershipRecord[] = [
    {
      id: "mem-recep",
      userId: "user-recep",
      organizationId: clinicAId,
      slug: "clinic-a",
      role: "RECEPTIONIST",
      status: "ACTIVE",
    },
    {
      id: "mem-prof",
      userId: "user-prof",
      organizationId: clinicAId,
      slug: "clinic-a",
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-admin",
      userId: "user-admin",
      organizationId: clinicAId,
      slug: "clinic-a",
      role: "ADMIN",
      status: "ACTIVE",
    },
    {
      id: "mem-admin-prof",
      userId: "user-admin-prof",
      organizationId: clinicAId,
      slug: "clinic-a",
      role: "ADMIN_PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-suspended",
      userId: "user-suspended",
      organizationId: clinicAId,
      slug: "clinic-a",
      role: "RECEPTIONIST",
      status: "SUSPENDED",
    },
    {
      id: "mem-clinic-b",
      userId: "user-clinic-b",
      organizationId: clinicBId,
      slug: "clinic-b",
      role: "ADMIN",
      status: "ACTIVE",
    },
  ];

  const auditLogs: StoredAuditLog[] = [];
  let simulateConcurrentConflict = false;

  const patientApi = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      for (const patient of patients.values()) {
        if (
          where.organizationId &&
          patient.organizationId !== where.organizationId
        ) {
          continue;
        }
        if (typeof where.id === "string" && patient.id !== where.id) {
          continue;
        }
        if (
          typeof where.id === "object" &&
          where.id !== null &&
          "not" in where.id &&
          patient.id === (where.id as { not: string }).not
        ) {
          continue;
        }
        if (typeof where.cpf === "string" && patient.cpf !== where.cpf) {
          continue;
        }
        return { ...patient };
      }
      return null;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; organizationId: string; version: number };
      data: {
        fullName: string;
        normalizedName: string;
        cpf: string;
        birthDate: Date;
        phone: string;
        updatedAt: Date;
        version: { increment: number };
      };
    }) => {
      const current = patients.get(where.id);
      if (
        !current ||
        current.organizationId !== where.organizationId ||
        current.version !== where.version ||
        simulateConcurrentConflict
      ) {
        return { count: 0 };
      }
      patients.set(where.id, {
        ...current,
        fullName: data.fullName,
        normalizedName: data.normalizedName,
        cpf: data.cpf,
        birthDate: data.birthDate,
        phone: data.phone,
        updatedAt: data.updatedAt,
        version: current.version + data.version.increment,
      });
      return { count: 1 };
    },
  };

  const auditLogApi = {
    create: async ({ data }: { data: StoredAuditLog }) => {
      auditLogs.push(data);
      return { id: `audit-${auditLogs.length}`, ...data };
    },
  };

  const prisma = {
    session: {
      findFirst: async () => ({
        id: "session-1",
        lastActiveAt: new Date(),
      }),
    },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; organization: { slug: string } };
      }) => {
        const found = memberships.find(
          (m) =>
            m.userId === where.userId && m.slug === where.organization.slug,
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
    patient: patientApi,
    auditLog: auditLogApi,
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ patient: patientApi, auditLog: auditLogApi }),
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
      if (code === "VALIDATION" || code === "PARSE") {
        const path =
          code === "VALIDATION" && error.type === "body"
            ? error.all.find((issue) =>
                /^\/[A-Za-z][A-Za-z0-9]*$/.test(issue.path),
              )?.path
            : undefined;
        const field = path?.slice(1);
        return status(400, {
          error: {
            code: "VALIDATION_ERROR",
            message: "Dados inválidos.",
            ...(field ? { details: { field } } : {}),
          },
        });
      }
      return status(500, {
        error: { code: "INTERNAL", message: "Erro interno." },
      });
    })
    .use(patientsModule({ prisma, jwtSecret }));

  const request = (
    path: string,
    options: RequestInit & { userId?: string | null } = {},
  ) => {
    const { userId = "user-recep", headers, ...rest } = options;
    const reqHeaders = new Headers(headers);
    if (userId) {
      const token = signSessionToken(
        { sid: "session-1", sub: userId },
        jwtSecret,
        3600,
      );
      reqHeaders.set("authorization", `Bearer ${token}`);
    }
    return app.handle(
      new Request(`http://localhost/api${path}`, {
        ...rest,
        headers: reqHeaders,
      }),
    );
  };

  return {
    prisma,
    patients,
    auditLogs,
    request,
    setSimulateConcurrentConflict: (value: boolean) => {
      simulateConcurrentConflict = value;
    },
  };
}

describe("#252 patient registration update with conflict control", () => {
  test("updates allowed registration fields via PATCH and PUT, increments version, and records actor and timestamp in AuditLog", async () => {
    const { request, patients, auditLogs } = setup();

    const patchRes = await request(
      `/organizations/clinic-a/patients/${patientOneId}`,
      {
        userId: "user-recep",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 0,
          fullName: "  João   Carlos   Souza  ",
          phone: "(11) 98888-5555",
        }),
      },
    );

    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as PatientResponse;
    expect(patched.patient).toMatchObject({
      id: patientOneId,
      fullName: "João Carlos Souza",
      cpf: "52998224725",
      birthDate: "1985-05-20",
      phone: "11988885555",
      version: 1,
      createdAt: "2026-10-10T12:00:00.000Z",
    });
    expect(typeof patched.patient.updatedAt).toBe("string");
    expect(patients.get(patientOneId)?.normalizedName).toBe(
      "joao carlos souza",
    );

    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      organizationId: clinicAId,
      actorUserId: "user-recep",
      action: "PATIENT_UPDATED",
      targetType: "PATIENT",
      targetId: patientOneId,
      metadata: {
        changedFields: ["fullName", "phone"],
        previousVersion: 0,
        newVersion: 1,
        updatedAt: patched.patient.updatedAt,
      },
    });

    const putRes = await request(
      `/organizations/clinic-a/patients/${patientOneId}`,
      {
        userId: "user-prof",
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          fullName: "João Carlos Souza",
          cpf: "529.982.247-25",
          birthDate: "1985-05-21",
          phone: "(11) 98888-4444",
        }),
      },
    );

    expect(putRes.status).toBe(200);
    const afterPut = (await putRes.json()) as PatientResponse;
    expect(afterPut.patient).toMatchObject({
      id: patientOneId,
      fullName: "João Carlos Souza",
      cpf: "52998224725",
      birthDate: "1985-05-21",
      phone: "11988884444",
      version: 2,
    });
    expect(patients.get(patientOneId)?.version).toBe(2);
    expect(patients.get(patientOneId)?.phone).toBe("11988884444");

    expect(auditLogs).toHaveLength(2);
    expect(auditLogs[1]).toMatchObject({
      organizationId: clinicAId,
      actorUserId: "user-prof",
      action: "PATIENT_UPDATED",
      targetType: "PATIENT",
      targetId: patientOneId,
      metadata: {
        changedFields: ["birthDate", "phone"],
        previousVersion: 1,
        newVersion: 2,
        updatedAt: afterPut.patient.updatedAt,
      },
    });
  });

  test("rejects stale version and concurrent updates with 409 VERSION_CONFLICT while preserving newer data", async () => {
    const {
      request,
      patients,
      auditLogs,
      prisma,
      setSimulateConcurrentConflict,
    } = setup();

    // First user updates version 0 -> 1
    const firstUpdate = await request(
      `/organizations/clinic-a/patients/${patientOneId}`,
      {
        userId: "user-recep",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 0,
          phone: "(11) 99999-1111",
        }),
      },
    );
    expect(firstUpdate.status).toBe(200);

    // Second user tries to update based on stale version 0
    const staleUpdate = await request(
      `/organizations/clinic-a/patients/${patientOneId}`,
      {
        userId: "user-admin",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 0,
          fullName: "Edição Antiga que Não Deve Sobrescrever",
          phone: "(11) 90000-0000",
        }),
      },
    );

    expect(staleUpdate.status).toBe(409);
    expect(await staleUpdate.json()).toEqual({
      error: {
        code: "VERSION_CONFLICT",
        message:
          "O cadastro do paciente foi atualizado por outra pessoa. Recarregue os dados antes de salvar.",
      },
    });

    // Newer data from first update is preserved
    const stored = patients.get(patientOneId)!;
    expect(stored.fullName).toBe("João Souza");
    expect(stored.phone).toBe("11999991111");
    expect(stored.version).toBe(1);
    expect(auditLogs).toHaveLength(1);

    // Concurrent race condition where two requests pass initial read with version 1
    const [raceA, raceB] = await Promise.all([
      request(`/organizations/clinic-a/patients/${patientOneId}`, {
        userId: "user-recep",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          fullName: "João Souza Atualizado",
        }),
      }),
      request(`/organizations/clinic-a/patients/${patientOneId}`, {
        userId: "user-prof",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          fullName: "João Souza Concorrente",
        }),
      }),
    ]);

    const statuses = [raceA.status, raceB.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(patients.get(patientOneId)?.version).toBe(2);
    expect(auditLogs).toHaveLength(2);

    // Also verify updateMany returning count: 0 when concurrent write commits between findFirst and updateMany
    setSimulateConcurrentConflict(true);
    const service = new PatientsService(prisma);
    await expect(
      service.update(clinicAId, "user-recep", patientOneId, {
        version: 2,
        phone: "(11) 95555-4444",
      }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      httpStatus: 409,
    });
    expect(auditLogs).toHaveLength(2);
  });

  test("validates each registration field and rejects invalid values before mutating data", async () => {
    const { request, patients, auditLogs } = setup();

    const invalidFieldCases: Array<{
      payload: Record<string, unknown>;
      field?: string;
    }> = [
      { payload: { version: 0, fullName: "   " }, field: "fullName" },
      { payload: { version: 0, fullName: " A " }, field: "fullName" },
      {
        payload: { version: 0, fullName: "A".repeat(161) },
        field: "fullName",
      },
      { payload: { version: 0, cpf: "111.111.111-11" }, field: "cpf" },
      { payload: { version: 0, cpf: "529.982.247-20" }, field: "cpf" },
      { payload: { version: 0, cpf: "12345" }, field: "cpf" },
      { payload: { version: 0, birthDate: "20/05/1985" }, field: "birthDate" },
      { payload: { version: 0, birthDate: "2026-02-30" }, field: "birthDate" },
      { payload: { version: 0, birthDate: "2099-01-01" }, field: "birthDate" },
      { payload: { version: 0, phone: "12345" }, field: "phone" },
      {
        payload: { version: 0, phone: "119999988887777" },
        field: "phone",
      },
      { payload: { version: 0, phone: "abcdefghij" }, field: "phone" },
      { payload: { version: -1, phone: "(11) 98888-5555" }, field: "version" },
      { payload: { phone: "(11) 98888-5555" }, field: "version" },
      { payload: { version: 0 } },
    ];

    for (const item of invalidFieldCases) {
      const res = await request(
        `/organizations/clinic-a/patients/${patientOneId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(item.payload),
        },
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        error: { code: string; details?: { field?: string } };
      };
      expect(body.error.code).toBe("VALIDATION_ERROR");
      if (item.field) {
        expect(body.error.details?.field).toBe(item.field);
      }
    }

    expect(patients.get(patientOneId)?.version).toBe(0);
    expect(patients.get(patientOneId)?.fullName).toBe("João Souza");
    expect(auditLogs).toHaveLength(0);
  });

  test("rejects clinical and immutable fields on both HTTP endpoints and service calls", async () => {
    const { request, patients, auditLogs, prisma } = setup();
    const service = new PatientsService(prisma);

    const clinicalPayloads: Array<{
      field: string;
      payload: Record<string, unknown>;
    }> = [
      {
        field: "allergies",
        payload: {
          version: 0,
          phone: "(11) 98888-5555",
          allergies: "Dipirona",
        },
      },
      {
        field: "comorbidities",
        payload: {
          version: 0,
          phone: "(11) 98888-5555",
          comorbidities: "Hipertensão",
        },
      },
      {
        field: "clinicalAlerts",
        payload: {
          version: 0,
          phone: "(11) 98888-5555",
          clinicalAlerts: "Risco de queda",
        },
      },
      {
        field: "medicalNotes",
        payload: {
          version: 0,
          phone: "(11) 98888-5555",
          medicalNotes: "Evolução clínica restrita",
        },
      },
      {
        field: "confidentialNotes",
        payload: {
          version: 0,
          phone: "(11) 98888-5555",
          confidentialNotes: "Nota sigilosa",
        },
      },
      {
        field: "anamnesis",
        payload: {
          version: 0,
          phone: "(11) 98888-5555",
          anamnesis: "Queixa principal: cefaleia",
        },
      },
      {
        field: "diagnosis",
        payload: {
          version: 0,
          phone: "(11) 98888-5555",
          diagnosis: "G43",
        },
      },
      {
        field: "prescription",
        payload: {
          version: 0,
          phone: "(11) 98888-5555",
          prescription: "Paracetamol 500mg",
        },
      },
      {
        field: "clinicalRecord",
        payload: {
          version: 0,
          phone: "(11) 98888-5555",
          clinicalRecord: { status: "APPROVED" },
        },
      },
      {
        field: "organizationId",
        payload: {
          version: 0,
          phone: "(11) 98888-5555",
          organizationId: clinicBId,
        },
      },
      {
        field: "customClinicalField",
        payload: {
          version: 0,
          phone: "(11) 98888-5555",
          customClinicalField: "Não permitido",
        },
      },
    ];

    for (const item of clinicalPayloads) {
      const res = await request(
        `/organizations/clinic-a/patients/${patientOneId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(item.payload),
        },
      );
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: { field: item.field },
        },
      });

      await expect(
        service.update(
          clinicAId,
          "user-recep",
          patientOneId,
          item.payload as unknown as UpdatePatientBody,
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        httpStatus: 400,
        details: { field: item.field },
      });
    }

    expect(patients.get(patientOneId)?.version).toBe(0);
    expect(patients.get(patientOneId)?.phone).toBe("11977776666");
    expect(auditLogs).toHaveLength(0);
  });

  test("checks duplicate CPF within the same clinic and supports distinctPersonConfirmed", async () => {
    const { request, patients, auditLogs } = setup();

    // Changing CPF to patientTwo's CPF in the same clinic without confirmation returns 409 POSSIBLE_DUPLICATE
    const duplicateRes = await request(
      `/organizations/clinic-a/patients/${patientOneId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 0,
          cpf: "111.444.777-35",
        }),
      },
    );
    expect(duplicateRes.status).toBe(409);
    await expect(duplicateRes.json()).resolves.toMatchObject({
      error: {
        code: "POSSIBLE_DUPLICATE",
        details: {
          existingPatientId: patientTwoId,
          matchedOn: "cpf",
        },
      },
    });
    expect(patients.get(patientOneId)?.cpf).toBe("52998224725");
    expect(auditLogs).toHaveLength(0);

    // Updating CPF to a CPF that exists only in Clinic B succeeds without confirmation
    const crossClinicCpfRes = await request(
      `/organizations/clinic-a/patients/${patientOneId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 0,
          cpf: "935.411.347-80",
        }),
      },
    );
    expect(crossClinicCpfRes.status).toBe(200);
    expect(patients.get(patientOneId)?.cpf).toBe("93541134780");
    expect(patients.get(patientOneId)?.version).toBe(1);

    // Updating CPF to patientTwo's CPF WITH distinctPersonConfirmed: true succeeds
    const confirmedDuplicateRes = await request(
      `/organizations/clinic-a/patients/${patientOneId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          version: 1,
          cpf: "111.444.777-35",
          distinctPersonConfirmed: true,
        }),
      },
    );
    expect(confirmedDuplicateRes.status).toBe(200);
    expect(patients.get(patientOneId)?.cpf).toBe("11144477735");
    expect(patients.get(patientOneId)?.version).toBe(2);
    expect(auditLogs).toHaveLength(2);
  });

  test("enforces tenant isolation, authentication, and RBAC", async () => {
    const { request, patients, auditLogs } = setup();

    // Unauthenticated request -> 401
    const unauthRes = await request(
      `/organizations/clinic-a/patients/${patientOneId}`,
      {
        userId: null,
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 0, phone: "(11) 98888-5555" }),
      },
    );
    expect(unauthRes.status).toBe(401);

    // Suspended member -> 403 MEMBERSHIP_INACTIVE
    const suspendedRes = await request(
      `/organizations/clinic-a/patients/${patientOneId}`,
      {
        userId: "user-suspended",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 0, phone: "(11) 98888-5555" }),
      },
    );
    expect(suspendedRes.status).toBe(403);
    await expect(suspendedRes.json()).resolves.toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });

    // Member of Clinic A attempting to update a patient of Clinic B -> 404 NOT_FOUND
    const foreignPatientRes = await request(
      `/organizations/clinic-a/patients/${clinicBPatientId}`,
      {
        userId: "user-admin",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 0, phone: "(11) 98888-5555" }),
      },
    );
    expect(foreignPatientRes.status).toBe(404);
    expect(patients.get(clinicBPatientId)?.phone).toBe("21999998888");

    // Member of Clinic B attempting to use Clinic A's slug -> 404 NOT_FOUND
    const foreignSlugRes = await request(
      `/organizations/clinic-a/patients/${patientOneId}`,
      {
        userId: "user-clinic-b",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 0, phone: "(11) 98888-5555" }),
      },
    );
    expect(foreignSlugRes.status).toBe(404);

    // Non-existent patient in Clinic A -> 404 NOT_FOUND
    const missingPatientRes = await request(
      `/organizations/clinic-a/patients/non-existent-patient`,
      {
        userId: "user-admin",
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: 0, phone: "(11) 98888-5555" }),
      },
    );
    expect(missingPatientRes.status).toBe(404);

    expect(auditLogs).toHaveLength(0);
  });
});
