import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type {
  AppointmentStatus,
  MembershipRole,
  MembershipStatus,
  PrismaClient,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { patientsModule } from "../src/modules/patients";
import type {
  ListPatientsResponse,
  PatientDetailResponse,
  PatientOverviewResponse,
} from "../src/modules/patients/model";
import {
  normalizePatientName,
  normalizePhone,
  PatientsService,
} from "../src/modules/patients/service";
import { signSessionToken } from "../src/services/session-token";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const professionalId = "33333333-3333-4333-8333-333333333333";
const secret = "patient-test-secret";
const validBody = {
  fullName: "João Souza",
  cpf: "529.982.247-25",
  birthDate: "1985-05-20",
  phone: "(11) 97777-6666",
};

function matchesPatientClause(
  patient: Record<string, unknown>,
  clause: Record<string, unknown>,
): boolean {
  if (
    clause.organizationId !== undefined &&
    patient.organizationId !== clause.organizationId
  ) {
    return false;
  }
  if (clause.id !== undefined && patient.id !== clause.id) {
    return false;
  }
  if (typeof clause.cpf === "string" && patient.cpf !== clause.cpf) {
    return false;
  }
  if (
    clause.cpf &&
    typeof clause.cpf === "object" &&
    "contains" in clause.cpf
  ) {
    const needle = String((clause.cpf as { contains: string }).contains);
    if (!normalizePhone(String(patient.cpf ?? "")).includes(needle)) {
      return false;
    }
  }
  if (
    clause.phone &&
    typeof clause.phone === "object" &&
    "contains" in clause.phone
  ) {
    const needle = String((clause.phone as { contains: string }).contains);
    if (!normalizePhone(String(patient.phone ?? "")).includes(needle)) {
      return false;
    }
  }
  if (
    clause.normalizedName &&
    typeof clause.normalizedName === "object" &&
    "contains" in clause.normalizedName
  ) {
    const needle = String(
      (clause.normalizedName as { contains: string }).contains,
    ).toLowerCase();
    const target = normalizePatientName(
      String(patient.normalizedName || patient.fullName || ""),
    );
    if (!target.includes(needle)) {
      return false;
    }
  }
  if (
    clause.fullName &&
    typeof clause.fullName === "object" &&
    "contains" in clause.fullName
  ) {
    const needle = String(
      (clause.fullName as { contains: string }).contains,
    ).toLowerCase();
    const target = String(patient.fullName ?? "").toLowerCase();
    if (!target.includes(needle)) {
      return false;
    }
  }
  const orClauses = clause.OR as Array<Record<string, unknown>> | undefined;
  if (orClauses) {
    return orClauses.some((subClause) =>
      matchesPatientClause(patient, subClause),
    );
  }
  return true;
}

function projectRecord<T extends Record<string, unknown>>(
  record: T,
  select?: Record<string, unknown>,
): Record<string, unknown> {
  if (!select) return { ...record };
  const result: Record<string, unknown> = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled) {
      result[key] = record[key];
    }
  }
  return result;
}

function fixture(options?: {
  role?: MembershipRole;
  status?: MembershipStatus;
}) {
  let activeRole: MembershipRole = options?.role ?? "RECEPTIONIST";
  const activeStatus: MembershipStatus = options?.status ?? "ACTIVE";
  const patients: Array<Record<string, unknown>> = [];
  const appointments: Array<{
    id: string;
    organizationId: string;
    patientId: string;
    professionalId: string;
    scheduledAt: Date;
    durationMinutes: number;
    status: AppointmentStatus;
  }> = [];
  const requests = new Map<string, Record<string, unknown>>();
  const patientApi = {
    findFirst: async ({
      where,
      select,
    }: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
    }) => {
      const found =
        patients.find((patient) => matchesPatientClause(patient, where)) ??
        null;
      return found ? projectRecord(found, select) : null;
    },
    findMany: async ({
      where,
      take,
      cursor,
      skip,
      select,
    }: {
      where: Record<string, unknown>;
      take?: number;
      cursor?: { id: string };
      skip?: number;
      select?: Record<string, unknown>;
    }) => {
      const filtered = patients
        .filter((patient) => matchesPatientClause(patient, where))
        .sort((a, b) => {
          const timeA = (a.createdAt as Date).getTime();
          const timeB = (b.createdAt as Date).getTime();
          if (timeA !== timeB) return timeA - timeB;
          return String(a.id).localeCompare(String(b.id));
        });

      let startIndex = 0;
      if (cursor?.id) {
        const idx = filtered.findIndex((item) => item.id === cursor.id);
        startIndex = idx >= 0 ? idx + (skip ?? 0) : filtered.length;
      }
      const sliced =
        take !== undefined
          ? filtered.slice(startIndex, startIndex + take)
          : filtered.slice(startIndex);
      return sliced.map((item) => projectRecord(item, select));
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const patient = {
        id: `patient-${patients.length + 1}`,
        email: null,
        healthInsurance: null,
        insuranceNumber: null,
        allergies: [],
        comorbidities: [],
        clinicalAlerts: [],
        medicalNotes: null,
        ...data,
        normalizedName: normalizePatientName(
          String(data.normalizedName || data.fullName || ""),
        ),
        version: 0,
        createdAt: new Date("2026-10-11T12:00:00.000Z"),
        updatedAt: new Date("2026-10-11T12:00:00.000Z"),
      };
      patients.push(patient);
      return patient;
    },
  };
  const appointmentApi = {
    findMany: async ({
      where,
      take,
      select,
    }: {
      where: {
        organizationId: string;
        patientId: string;
        status?: { in: AppointmentStatus[] };
        scheduledAt?: { gte: Date };
      };
      take?: number;
      select?: Record<string, unknown>;
    }) => {
      const allowedStatuses = where.status?.in;
      const minDate = where.scheduledAt?.gte;
      const filtered = appointments
        .filter(
          (item) =>
            item.organizationId === where.organizationId &&
            item.patientId === where.patientId &&
            (!allowedStatuses || allowedStatuses.includes(item.status)) &&
            (!minDate || item.scheduledAt.getTime() >= minDate.getTime()),
        )
        .sort(
          (a, b) =>
            a.scheduledAt.getTime() - b.scheduledAt.getTime() ||
            a.id.localeCompare(b.id),
        );
      const sliced = take !== undefined ? filtered.slice(0, take) : filtered;
      return sliced.map((item) =>
        projectRecord(item as unknown as Record<string, unknown>, select),
      );
    },
  };
  const requestApi = {
    findUnique: async ({ where }: { where: Record<string, unknown> }) => {
      const key = where.organizationId_idempotencyKey as {
        organizationId: string;
        idempotencyKey: string;
      };
      const request = requests.get(
        `${key.organizationId}:${key.idempotencyKey}`,
      );
      if (!request) return null;
      return {
        requestHash: request.requestHash,
        patient: patients.find((patient) => patient.id === request.patientId),
      };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      requests.set(`${data.organizationId}:${data.idempotencyKey}`, data);
      return data;
    },
  };
  const prisma = {
    patient: patientApi,
    appointment: appointmentApi,
    patientCreationRequest: requestApi,
    session: {
      findFirst: async () => ({
        id: "session-1",
        lastActiveAt: new Date(),
      }),
    },
    membership: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        (where.organization as { slug: string }).slug === "clinic-a"
          ? {
              id: "membership-1",
              organizationId,
              role: activeRole,
              status: activeStatus,
            }
          : null,
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({ patient: patientApi, patientCreationRequest: requestApi }),
  } as unknown as PrismaClient;

  const setRole = (nextRole: MembershipRole) => {
    activeRole = nextRole;
  };

  return { prisma, patients, appointments, requests, setRole };
}

function buildTestApp(prisma: PrismaClient) {
  return new Elysia()
    .onError(({ code, error, status }) => {
      if (error instanceof ApiError)
        return status(error.httpStatus, {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        });
      if (code === "VALIDATION")
        return status(400, { error: { code: "VALIDATION_ERROR" } });
      return status(500, { error: { code: "INTERNAL" } });
    })
    .use(patientsModule({ prisma, jwtSecret: secret }));
}

describe("patient creation", () => {
  test("limits duplicate checks to the resolved clinic and supports distinct-person confirmation", async () => {
    const f = fixture();
    const service = new PatientsService(f.prisma);
    f.patients.push({
      id: "patient-other-clinic",
      organizationId: otherOrganizationId,
      ...validBody,
      cpf: "52998224725",
      birthDate: new Date("1985-05-20T00:00:00.000Z"),
      phone: "11977776666",
      version: 0,
      createdAt: new Date("2026-10-10T12:00:00.000Z"),
      updatedAt: new Date("2026-10-10T12:00:00.000Z"),
    });

    const created = await service.create(
      organizationId,
      "request-0001",
      validBody,
    );
    expect(created.patient.id).toBe("patient-2");
    expect(f.patients[1]?.normalizedName).toBe("joao souza");

    await expect(
      service.create(organizationId, "request-0002", validBody),
    ).rejects.toMatchObject({
      code: "POSSIBLE_DUPLICATE",
      httpStatus: 409,
      details: { existingPatientId: "patient-2", matchedOn: "cpf" },
    });

    const confirmed = await service.create(organizationId, "request-0003", {
      ...validBody,
      distinctPersonConfirmed: true,
    });
    expect(confirmed.patient.id).toBe("patient-3");
  });

  test("replays one creation for the same key and rejects key reuse with other data", async () => {
    const f = fixture();
    const service = new PatientsService(f.prisma);
    const first = await service.create(
      organizationId,
      "request-0001",
      validBody,
    );
    const replay = await service.create(
      organizationId,
      "request-0001",
      validBody,
    );
    expect(replay).toEqual(first);
    expect(f.patients).toHaveLength(1);

    await expect(
      service.create(organizationId, "request-0001", {
        ...validBody,
        fullName: "Outra Pessoa",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", httpStatus: 409 });
    expect(f.patients).toHaveLength(1);
  });

  test("validates required fields and applies authenticated organization access", async () => {
    const f = fixture();
    const app = buildTestApp(f.prisma);
    const token = signSessionToken(
      { sid: "session-1", sub: "user-1" },
      secret,
      60,
    );
    const request = (slug: string, body: unknown, withKey = true) =>
      app.handle(
        new Request(`http://localhost/organizations/${slug}/patients`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            ...(withKey ? { "idempotency-key": "request-0001" } : {}),
          },
          body: JSON.stringify(body),
        }),
      );

    const createdResponse = await request("clinic-a", validBody);
    expect(createdResponse.status).toBe(201);
    expect((await request("clinic-b", validBody)).status).toBe(404);
    expect(
      (await request("clinic-a", { ...validBody, cpf: "111" })).status,
    ).toBe(400);
    expect((await request("clinic-a", validBody, false)).status).toBe(400);
  });
});

describe("patient search, detail, and clinical overview (#251)", () => {
  function seedSearchFixture(role: MembershipRole = "PROFESSIONAL") {
    const f = fixture({ role });
    f.patients.push(
      {
        id: "pat-1",
        organizationId,
        fullName: "João da Conceição",
        normalizedName: "joao da conceicao",
        cpf: "52998224725",
        birthDate: new Date("1985-05-20T00:00:00.000Z"),
        phone: "11977776666",
        email: "joao@exemplo.com",
        healthInsurance: "Unimed Nacional",
        insuranceNumber: "UNI-998877",
        allergies: ["Dipirona", "Penicilina"],
        comorbidities: ["Hipertensão arterial", "Diabetes tipo 2"],
        clinicalAlerts: ["Risco elevado de sangramento"],
        medicalNotes: "Uso contínuo de anticoagulante oral.",
        version: 2,
        createdAt: new Date("2026-10-01T10:00:00.000Z"),
        updatedAt: new Date("2026-10-05T10:00:00.000Z"),
      },
      {
        id: "pat-2",
        organizationId,
        fullName: "Maria José Alencar",
        normalizedName: "maria jose alencar",
        cpf: "11144477735",
        birthDate: new Date("1992-08-14T00:00:00.000Z"),
        phone: "85988881111",
        email: null,
        healthInsurance: null,
        insuranceNumber: null,
        allergies: [],
        comorbidities: [],
        clinicalAlerts: [],
        medicalNotes: null,
        version: 0,
        createdAt: new Date("2026-10-02T10:00:00.000Z"),
        updatedAt: new Date("2026-10-02T10:00:00.000Z"),
      },
      {
        id: "pat-3",
        organizationId,
        fullName: "Carlos Eduardo Mendes",
        normalizedName: "carlos eduardo mendes",
        cpf: "12345678909",
        birthDate: new Date("1978-01-30T00:00:00.000Z"),
        phone: "21966665555",
        email: "carlos@exemplo.com",
        healthInsurance: "Bradesco Saúde",
        insuranceNumber: "BRA-112233",
        allergies: [],
        comorbidities: [],
        clinicalAlerts: [],
        medicalNotes: null,
        version: 1,
        createdAt: new Date("2026-10-03T10:00:00.000Z"),
        updatedAt: new Date("2026-10-03T10:00:00.000Z"),
      },
      {
        id: "pat-other-clinic",
        organizationId: otherOrganizationId,
        fullName: "João de Outra Clínica",
        normalizedName: "joao de outra clinica",
        cpf: "52998224725",
        birthDate: new Date("1980-03-10T00:00:00.000Z"),
        phone: "11977776666",
        email: "outro@clinica-b.com",
        healthInsurance: "SulAmérica",
        insuranceNumber: "SUL-0001",
        allergies: ["Látex"],
        comorbidities: ["Asma grave"],
        clinicalAlerts: ["Alerta confidencial outra clínica"],
        medicalNotes: "Segredo de outra clínica",
        version: 0,
        createdAt: new Date("2026-10-01T08:00:00.000Z"),
        updatedAt: new Date("2026-10-01T08:00:00.000Z"),
      },
    );

    f.appointments.push(
      {
        id: "appt-past",
        organizationId,
        patientId: "pat-1",
        professionalId,
        scheduledAt: new Date("2020-01-01T10:00:00.000Z"),
        durationMinutes: 30,
        status: "CONFIRMED",
      },
      {
        id: "appt-cancelled",
        organizationId,
        patientId: "pat-1",
        professionalId,
        scheduledAt: new Date("2099-05-10T10:00:00.000Z"),
        durationMinutes: 30,
        status: "CANCELLED",
      },
      {
        id: "appt-upcoming-2",
        organizationId,
        patientId: "pat-1",
        professionalId,
        scheduledAt: new Date("2099-05-12T15:00:00.000Z"),
        durationMinutes: 45,
        status: "RESERVED",
      },
      {
        id: "appt-upcoming-1",
        organizationId,
        patientId: "pat-1",
        professionalId,
        scheduledAt: new Date("2099-05-11T09:00:00.000Z"),
        durationMinutes: 30,
        status: "CONFIRMED",
      },
      {
        id: "appt-other-clinic",
        organizationId: otherOrganizationId,
        patientId: "pat-1",
        professionalId,
        scheduledAt: new Date("2099-05-11T08:00:00.000Z"),
        durationMinutes: 30,
        status: "CONFIRMED",
      },
    );

    return f;
  }

  test("normalizes accents, phone variations, and CPF in search while isolating organization", async () => {
    const f = seedSearchFixture("RECEPTIONIST");
    const app = buildTestApp(f.prisma);
    const token = signSessionToken(
      { sid: "session-1", sub: "user-1" },
      secret,
      60,
    );

    const search = async (query: string) => {
      const res = await app.handle(
        new Request(
          `http://localhost/organizations/clinic-a/patients?${query}`,
          {
            headers: { authorization: `Bearer ${token}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      return (await res.json()) as ListPatientsResponse;
    };

    // Unaccented search finds accented patient name ("Joao" -> "João da Conceição")
    const byUnaccentedName = await search("search=Joao");
    expect(byUnaccentedName.data.map((p) => p.id)).toEqual(["pat-1"]);

    // Accented search with extra spaces finds patient ("  Conceição  " / "maria jose")
    const byAccentedQuery = await search(
      `search=${encodeURIComponent("  Maria   Jose ")}`,
    );
    expect(byAccentedQuery.data.map((p) => p.id)).toEqual(["pat-2"]);

    // Query alias `q` also works with accented query
    const byQueryAlias = await search(`q=${encodeURIComponent("conceicao")}`);
    expect(byQueryAlias.data.map((p) => p.id)).toEqual(["pat-1"]);

    // Formatted phone matches unformatted stored phone
    const byFormattedPhone = await search(
      `search=${encodeURIComponent("(11) 97777-6666")}`,
    );
    expect(byFormattedPhone.data.map((p) => p.id)).toEqual(["pat-1"]);

    // Country-prefixed formatted phone matches stored phone
    const byCountryPhone = await search(
      `search=${encodeURIComponent("+55 (85) 98888-1111")}`,
    );
    expect(byCountryPhone.data.map((p) => p.id)).toEqual(["pat-2"]);

    // Formatted CPF matches normalized CPF
    const byFormattedCpf = await search(
      `search=${encodeURIComponent("529.982.247-25")}`,
    );
    expect(byFormattedCpf.data.map((p) => p.id)).toEqual(["pat-1"]);
  });

  test("enforces page limits and supports cursor pagination", async () => {
    const f = seedSearchFixture("RECEPTIONIST");
    const app = buildTestApp(f.prisma);
    const token = signSessionToken(
      { sid: "session-1", sub: "user-1" },
      secret,
      60,
    );

    const page1Res = await app.handle(
      new Request("http://localhost/organizations/clinic-a/patients?limit=2", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as ListPatientsResponse;
    expect(page1.data.map((p) => p.id)).toEqual(["pat-1", "pat-2"]);
    expect(page1.pageInfo).toEqual({
      nextCursor: "pat-2",
      hasNextPage: true,
    });

    const page2Res = await app.handle(
      new Request(
        `http://localhost/organizations/clinic-a/patients?limit=2&cursor=${page1.pageInfo.nextCursor}`,
        {
          headers: { authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as ListPatientsResponse;
    expect(page2.data.map((p) => p.id)).toEqual(["pat-3"]);
    expect(page2.pageInfo).toEqual({
      nextCursor: null,
      hasNextPage: false,
    });

    // Limit > 100 or < 1 is rejected with 400 VALIDATION_ERROR
    const overLimitRes = await app.handle(
      new Request(
        "http://localhost/organizations/clinic-a/patients?limit=101",
        {
          headers: { authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(overLimitRes.status).toBe(400);

    const zeroLimitRes = await app.handle(
      new Request("http://localhost/organizations/clinic-a/patients?limit=0", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(zeroLimitRes.status).toBe(400);

    // Cursor belonging to another clinic is rejected with 400 VALIDATION_ERROR
    const foreignCursorRes = await app.handle(
      new Request(
        "http://localhost/organizations/clinic-a/patients?cursor=pat-other-clinic",
        {
          headers: { authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(foreignCursorRes.status).toBe(400);
  });

  test("returns patient detail for active clinic and 404 for unknown or cross-clinic IDs", async () => {
    const f = seedSearchFixture("RECEPTIONIST");
    const app = buildTestApp(f.prisma);
    const token = signSessionToken(
      { sid: "session-1", sub: "user-1" },
      secret,
      60,
    );

    const detailRes = await app.handle(
      new Request("http://localhost/organizations/clinic-a/patients/pat-1", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as PatientDetailResponse;
    expect(detail.patient).toMatchObject({
      id: "pat-1",
      fullName: "João da Conceição",
      cpf: "52998224725",
      birthDate: "1985-05-20",
      phone: "11977776666",
      email: "joao@exemplo.com",
      healthInsurance: "Unimed Nacional",
      insuranceNumber: "UNI-998877",
      version: 2,
    });

    // Non-existent ID returns 404
    const missingRes = await app.handle(
      new Request(
        "http://localhost/organizations/clinic-a/patients/pat-does-not-exist",
        {
          headers: { authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(missingRes.status).toBe(404);

    // Patient ID from another clinic returns 404 without leaking data
    const otherClinicRes = await app.handle(
      new Request(
        "http://localhost/organizations/clinic-a/patients/pat-other-clinic",
        {
          headers: { authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(otherClinicRes.status).toBe(404);
    const otherClinicText = await otherClinicRes.text();
    expect(otherClinicText).not.toContain("SulAmérica");
    expect(otherClinicText).not.toContain("João de Outra Clínica");
  });

  test("returns clinical alerts, insurance, and upcoming appointments in overview for clinical roles", async () => {
    const f = seedSearchFixture("PROFESSIONAL");
    const app = buildTestApp(f.prisma);
    const token = signSessionToken(
      { sid: "session-1", sub: "user-1" },
      secret,
      60,
    );

    for (const clinicalRole of [
      "PROFESSIONAL",
      "ADMIN_PROFESSIONAL",
    ] as const) {
      f.setRole(clinicalRole);
      const res = await app.handle(
        new Request(
          "http://localhost/organizations/clinic-a/patients/pat-1/overview",
          {
            headers: { authorization: `Bearer ${token}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const overview = (await res.json()) as PatientOverviewResponse;

      expect(overview.patient.id).toBe("pat-1");
      expect(overview.contact).toEqual({
        phone: "11977776666",
        email: "joao@exemplo.com",
      });
      expect(overview.activeInsurance).toEqual({
        name: "Unimed Nacional",
        number: "UNI-998877",
      });
      expect(overview.upcomingAppointments.map((a) => a.id)).toEqual([
        "appt-upcoming-1",
        "appt-upcoming-2",
      ]);
      expect(overview.allergies).toEqual(["Dipirona", "Penicilina"]);
      expect(overview.comorbidities).toEqual([
        "Hipertensão arterial",
        "Diabetes tipo 2",
      ]);
      expect(overview.clinicalAlerts).toEqual(["Risco elevado de sangramento"]);
      expect(overview.medicalNotes).toBe(
        "Uso contínuo de anticoagulante oral.",
      );
      expect(overview.clinicalSummary).toEqual({
        allergies: ["Dipirona", "Penicilina"],
        comorbidities: ["Hipertensão arterial", "Diabetes tipo 2"],
        clinicalAlerts: ["Risco elevado de sangramento"],
        medicalNotes: "Uso contínuo de anticoagulante oral.",
      });
    }
  });

  test("omits confidential clinical alerts and medical notes in overview for RECEPTIONIST and ADMIN roles", async () => {
    const f = seedSearchFixture("RECEPTIONIST");
    const app = buildTestApp(f.prisma);
    const token = signSessionToken(
      { sid: "session-1", sub: "user-1" },
      secret,
      60,
    );

    for (const nonClinicalRole of ["RECEPTIONIST", "ADMIN"] as const) {
      f.setRole(nonClinicalRole);
      const res = await app.handle(
        new Request(
          "http://localhost/organizations/clinic-a/patients/pat-1/overview",
          {
            headers: { authorization: `Bearer ${token}` },
          },
        ),
      );
      expect(res.status).toBe(200);
      const rawText = await res.text();
      const overview = JSON.parse(rawText) as PatientOverviewResponse;

      // Essential contact, active insurance, and upcoming appointments remain available
      expect(overview.patient.fullName).toBe("João da Conceição");
      expect(overview.contact).toEqual({
        phone: "11977776666",
        email: "joao@exemplo.com",
      });
      expect(overview.activeInsurance).toEqual({
        name: "Unimed Nacional",
        number: "UNI-998877",
      });
      expect(overview.upcomingAppointments.map((a) => a.id)).toEqual([
        "appt-upcoming-1",
        "appt-upcoming-2",
      ]);

      // Clinical fields are completely omitted
      expect(overview.allergies).toBeUndefined();
      expect(overview.comorbidities).toBeUndefined();
      expect(overview.clinicalAlerts).toBeUndefined();
      expect(overview.medicalNotes).toBeUndefined();
      expect(overview.clinicalSummary).toBeUndefined();

      // Verify raw JSON does not leak any confidential clinical content
      expect(rawText).not.toContain("Dipirona");
      expect(rawText).not.toContain("Penicilina");
      expect(rawText).not.toContain("Hipertensão");
      expect(rawText).not.toContain("Diabetes");
      expect(rawText).not.toContain("sangramento");
      expect(rawText).not.toContain("anticoagulante");
    }

    // Overview for non-existent ID or another clinic's ID returns 404
    const missingOverview = await app.handle(
      new Request(
        "http://localhost/organizations/clinic-a/patients/pat-missing/overview",
        {
          headers: { authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(missingOverview.status).toBe(404);

    const otherClinicOverview = await app.handle(
      new Request(
        "http://localhost/organizations/clinic-a/patients/pat-other-clinic/overview",
        {
          headers: { authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(otherClinicOverview.status).toBe(404);
  });
});
