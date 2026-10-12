import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type { PrismaClient } from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { patientsModule } from "../src/modules/patients";
import { PatientsService } from "../src/modules/patients/service";
import { signSessionToken } from "../src/services/session-token";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const secret = "patient-test-secret";
const validBody = {
  fullName: "João Souza",
  cpf: "529.982.247-25",
  birthDate: "1985-05-20",
  phone: "(11) 97777-6666",
};

function fixture() {
  const patients: Array<Record<string, unknown>> = [];
  const requests = new Map<string, Record<string, unknown>>();
  const patientApi = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      patients.find(
        (patient) =>
          patient.organizationId === where.organizationId &&
          patient.cpf === where.cpf,
      ) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const patient = {
        id: `patient-${patients.length + 1}`,
        ...data,
        version: 0,
        createdAt: new Date("2026-10-11T12:00:00.000Z"),
        updatedAt: new Date("2026-10-11T12:00:00.000Z"),
      };
      patients.push(patient);
      return patient;
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
              role: "RECEPTIONIST",
              status: "ACTIVE",
            }
          : null,
    },
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({ patient: patientApi, patientCreationRequest: requestApi }),
  } as unknown as PrismaClient;
  return { prisma, patients, requests };
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
    });

    const created = await service.create(
      organizationId,
      "request-0001",
      validBody,
    );
    expect(created.patient.id).toBe("patient-2");

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
    const app = new Elysia()
      .onError(({ code, error, status }) => {
        if (error instanceof ApiError)
          return status(error.httpStatus, { error: { code: error.code } });
        if (code === "VALIDATION")
          return status(400, { error: { code: "VALIDATION_ERROR" } });
        return status(500, { error: { code: "INTERNAL" } });
      })
      .use(patientsModule({ prisma: f.prisma, jwtSecret: secret }));
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
