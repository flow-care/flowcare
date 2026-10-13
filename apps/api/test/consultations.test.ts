import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type {
  AnamnesisStatus,
  ConsultationStatus,
  MembershipRole,
  MembershipStatus,
  PrismaClient,
} from "../src/generated/prisma/client";
import type { ListConsultationsResponse } from "../src/modules/consultations/model";
import { normalizePatientName } from "../src/modules/patients/service";
import { signSessionToken } from "../src/services/session-token";

const secret = "consultations-test-secret-key-32-chars!!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const profAId = "33333333-3333-4333-8333-333333333331";
const profBId = "33333333-3333-4333-8333-333333333332";

const patient1Id = "44444444-4444-4444-8444-444444444441";
const patient2Id = "44444444-4444-4444-8444-444444444442";
const patientClinicBId = "44444444-4444-4444-8444-444444444449";

const consultation1Id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const consultation2Id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const consultation3Id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const consultation4Id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const consultationClinicBId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

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
  version: number;
  createdAt: Date;
  updatedAt: Date;
  patient: {
    id: string;
    fullName: string;
    normalizedName: string;
  };
  professional: {
    id: string;
    fullName: string;
    professionalTitle: string | null;
    registrationNumber: string | null;
  };
}

function createFixture() {
  let role: MembershipRole = "PROFESSIONAL";
  let membershipStatus: MembershipStatus = "ACTIVE";
  let membershipOrgSlug: string | null = "clinica-a";
  let sessionActive = true;

  const seedConsultations: StoredConsultation[] = [
    {
      id: consultation1Id,
      organizationId: clinicAId,
      appointmentId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      patientId: patient1Id,
      professionalId: profAId,
      // 2026-10-10 09:00 in America/Fortaleza (UTC-3) = 12:00Z
      scheduledAt: new Date("2026-10-10T12:00:00.000Z"),
      startedAt: new Date("2026-10-10T12:05:00.000Z"),
      completedAt: new Date("2026-10-10T12:35:00.000Z"),
      status: "COMPLETED",
      anamnesisStatus: "APPROVED",
      version: 2,
      createdAt: new Date("2026-10-10T11:00:00.000Z"),
      updatedAt: new Date("2026-10-10T12:35:00.000Z"),
      patient: {
        id: patient1Id,
        fullName: "João Carlos Oliveira",
        normalizedName: normalizePatientName("João Carlos Oliveira"),
      },
      professional: {
        id: profAId,
        fullName: "Dra. Ana Costa",
        professionalTitle: "Médica Cardiologista",
        registrationNumber: "CRM/CE 12345",
      },
    },
    {
      id: consultation2Id,
      organizationId: clinicAId,
      appointmentId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
      patientId: patient2Id,
      professionalId: profAId,
      // 2026-10-11 14:00 in America/Fortaleza (UTC-3) = 17:00Z
      scheduledAt: new Date("2026-10-11T17:00:00.000Z"),
      startedAt: new Date("2026-10-11T17:02:00.000Z"),
      completedAt: null,
      status: "IN_PROGRESS",
      anamnesisStatus: "DRAFT",
      version: 1,
      createdAt: new Date("2026-10-11T16:00:00.000Z"),
      updatedAt: new Date("2026-10-11T17:10:00.000Z"),
      patient: {
        id: patient2Id,
        fullName: "Maria Fernanda Santos",
        normalizedName: normalizePatientName("Maria Fernanda Santos"),
      },
      professional: {
        id: profAId,
        fullName: "Dra. Ana Costa",
        professionalTitle: "Médica Cardiologista",
        registrationNumber: "CRM/CE 12345",
      },
    },
    {
      id: consultation3Id,
      organizationId: clinicAId,
      appointmentId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
      patientId: patient1Id,
      professionalId: profBId,
      // 2026-10-12 10:00 in America/Fortaleza (UTC-3) = 13:00Z
      scheduledAt: new Date("2026-10-12T13:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      status: "SCHEDULED",
      anamnesisStatus: "PENDING",
      version: 0,
      createdAt: new Date("2026-10-12T08:00:00.000Z"),
      updatedAt: new Date("2026-10-12T08:00:00.000Z"),
      patient: {
        id: patient1Id,
        fullName: "João Carlos Oliveira",
        normalizedName: normalizePatientName("João Carlos Oliveira"),
      },
      professional: {
        id: profBId,
        fullName: "Dr. Bruno Lima",
        professionalTitle: "Médico Clínico",
        registrationNumber: "CRM/CE 67890",
      },
    },
    {
      id: consultation4Id,
      organizationId: clinicAId,
      appointmentId: null,
      patientId: patient2Id,
      professionalId: profBId,
      // 2026-10-12 22:30 in America/Fortaleza (UTC-3) = 2026-10-13T01:30:00.000Z
      scheduledAt: new Date("2026-10-13T01:30:00.000Z"),
      startedAt: null,
      completedAt: null,
      status: "CANCELLED",
      anamnesisStatus: "PENDING",
      version: 1,
      createdAt: new Date("2026-10-12T09:00:00.000Z"),
      updatedAt: new Date("2026-10-12T20:00:00.000Z"),
      patient: {
        id: patient2Id,
        fullName: "Maria Fernanda Santos",
        normalizedName: normalizePatientName("Maria Fernanda Santos"),
      },
      professional: {
        id: profBId,
        fullName: "Dr. Bruno Lima",
        professionalTitle: "Médico Clínico",
        registrationNumber: "CRM/CE 67890",
      },
    },
    {
      id: consultationClinicBId,
      organizationId: clinicBId,
      appointmentId: null,
      patientId: patientClinicBId,
      professionalId: profAId,
      scheduledAt: new Date("2026-10-12T15:00:00.000Z"),
      startedAt: null,
      completedAt: null,
      status: "SCHEDULED",
      anamnesisStatus: "PENDING",
      version: 0,
      createdAt: new Date("2026-10-12T10:00:00.000Z"),
      updatedAt: new Date("2026-10-12T10:00:00.000Z"),
      patient: {
        id: patientClinicBId,
        fullName: "Paciente Outra Clínica",
        normalizedName: normalizePatientName("Paciente Outra Clínica"),
      },
      professional: {
        id: profAId,
        fullName: "Dra. Ana Costa",
        professionalTitle: "Médica Cardiologista",
        registrationNumber: "CRM/CE 12345",
      },
    },
  ];

  const matchesWhere = (
    item: StoredConsultation,
    where: Record<string, unknown>,
  ): boolean => {
    if (where.organizationId && item.organizationId !== where.organizationId) {
      return false;
    }
    if (where.id && item.id !== where.id) {
      return false;
    }
    if (where.professionalId && item.professionalId !== where.professionalId) {
      return false;
    }
    if (where.patientId && item.patientId !== where.patientId) {
      return false;
    }
    if (where.status && item.status !== where.status) {
      return false;
    }
    if (
      where.anamnesisStatus &&
      item.anamnesisStatus !== where.anamnesisStatus
    ) {
      return false;
    }
    if (where.scheduledAt && typeof where.scheduledAt === "object") {
      const range = where.scheduledAt as { gte?: Date; lt?: Date };
      if (range.gte && item.scheduledAt < range.gte) return false;
      if (range.lt && item.scheduledAt >= range.lt) return false;
    }
    if (where.patient && typeof where.patient === "object") {
      const patientWhere = where.patient as {
        OR?: Array<{
          normalizedName?: { contains?: string };
          fullName?: { contains?: string };
        }>;
      };
      if (patientWhere.OR) {
        const matched = patientWhere.OR.some((clause) => {
          if (clause.normalizedName?.contains) {
            return item.patient.normalizedName.includes(
              clause.normalizedName.contains.toLowerCase(),
            );
          }
          if (clause.fullName?.contains) {
            return item.patient.fullName
              .toLowerCase()
              .includes(clause.fullName.contains.toLowerCase());
          }
          return false;
        });
        if (!matched) return false;
      }
    }
    return true;
  };

  const sortConsultationsDesc = (items: StoredConsultation[]) =>
    [...items].sort(
      (a, b) =>
        b.scheduledAt.getTime() - a.scheduledAt.getTime() ||
        b.id.localeCompare(a.id),
    );

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
        where: { userId: string; organization: { slug: string } };
      }) => {
        if (!membershipOrgSlug || where.organization.slug !== membershipOrgSlug)
          return null;
        return {
          id: "membership-1",
          organizationId:
            where.organization.slug === "clinica-b" ? clinicBId : clinicAId,
          role,
          status: membershipStatus,
        };
      },
    },
    consultation: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const found = seedConsultations.find((item) =>
          matchesWhere(item, where),
        );
        return found ? { id: found.id } : null;
      },
      count: async ({ where }: { where: Record<string, unknown> }) =>
        seedConsultations.filter((item) => matchesWhere(item, where)).length,
      findMany: async ({
        where,
        take,
        cursor,
        skip,
      }: {
        where: Record<string, unknown>;
        take: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        const filtered = sortConsultationsDesc(
          seedConsultations.filter((item) => matchesWhere(item, where)),
        );

        let startIndex = 0;
        if (cursor?.id) {
          const idx = filtered.findIndex((item) => item.id === cursor.id);
          startIndex = idx >= 0 ? idx + (skip ?? 0) : filtered.length;
        } else if (skip) {
          startIndex = skip;
        }
        return filtered.slice(startIndex, startIndex + take);
      },
    },
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
    { sid: "session-1", sub: "user-1" },
    secret,
    3600,
  );

  const get = (path: string, authenticated = true) =>
    app.handle(
      new Request(`http://localhost/api${path}`, {
        headers: authenticated ? { authorization: `Bearer ${token}` } : {},
      }),
    );

  return {
    get,
    setRole: (value: MembershipRole) => {
      role = value;
    },
    setMembershipStatus: (value: MembershipStatus) => {
      membershipStatus = value;
    },
    setMembershipOrgSlug: (value: string | null) => {
      membershipOrgSlug = value;
    },
    setSessionActive: (value: boolean) => {
      sessionActive = value;
    },
  };
}

describe("consultations module (#262)", () => {
  test("lists consultations of the active clinic in descending scheduledAt order with essential summary fields and strict tenant isolation", async () => {
    const f = createFixture();

    const res = await f.get("/organizations/clinica-a/consultations");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListConsultationsResponse;

    expect(body.timeZone).toBe("America/Fortaleza");
    expect(body.data.map((item) => item.id)).toEqual([
      consultation4Id,
      consultation3Id,
      consultation2Id,
      consultation1Id,
    ]);
    expect(body.items).toEqual(body.data);
    expect(body.pageInfo).toEqual({
      limit: 20,
      page: 1,
      totalCount: 4,
      hasNextPage: false,
      nextCursor: null,
    });

    // Essential fields check on item
    expect(body.data[3]).toEqual({
      id: consultation1Id,
      appointmentId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
      patientId: patient1Id,
      professionalId: profAId,
      scheduledAt: "2026-10-10T12:00:00.000Z",
      localScheduledAt: "2026-10-10T09:00:00",
      startedAt: "2026-10-10T12:05:00.000Z",
      completedAt: "2026-10-10T12:35:00.000Z",
      status: "COMPLETED",
      anamnesisStatus: "APPROVED",
      patient: {
        id: patient1Id,
        fullName: "João Carlos Oliveira",
      },
      professional: {
        id: profAId,
        fullName: "Dra. Ana Costa",
        professionalTitle: "Médica Cardiologista",
        registrationNumber: "CRM/CE 12345",
      },
      version: 2,
      createdAt: "2026-10-10T11:00:00.000Z",
      updatedAt: "2026-10-10T12:35:00.000Z",
    });

    // Consultations from clinic B are never exposed
    expect(body.data.some((item) => item.id === consultationClinicBId)).toBe(
      false,
    );
  });

  test("supports cursor-based and page-based pagination and rejects cursors from other clinics", async () => {
    const f = createFixture();

    // Cursor-based pagination (page 1 -> page 2)
    const page1Res = await f.get(
      "/organizations/clinica-a/consultations?limit=2",
    );
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as ListConsultationsResponse;
    expect(page1.data.map((item) => item.id)).toEqual([
      consultation4Id,
      consultation3Id,
    ]);
    expect(page1.pageInfo).toEqual({
      limit: 2,
      page: 1,
      totalCount: 4,
      hasNextPage: true,
      nextCursor: consultation3Id,
    });

    const page2CursorRes = await f.get(
      `/organizations/clinica-a/consultations?limit=2&cursor=${consultation3Id}`,
    );
    expect(page2CursorRes.status).toBe(200);
    const page2Cursor =
      (await page2CursorRes.json()) as ListConsultationsResponse;
    expect(page2Cursor.data.map((item) => item.id)).toEqual([
      consultation2Id,
      consultation1Id,
    ]);
    expect(page2Cursor.pageInfo).toEqual({
      limit: 2,
      page: 1,
      totalCount: 4,
      hasNextPage: false,
      nextCursor: null,
    });

    // Page-based pagination (?limit=2&page=2)
    const page2OffsetRes = await f.get(
      "/organizations/clinica-a/consultations?limit=2&page=2",
    );
    expect(page2OffsetRes.status).toBe(200);
    const page2Offset =
      (await page2OffsetRes.json()) as ListConsultationsResponse;
    expect(page2Offset.data.map((item) => item.id)).toEqual([
      consultation2Id,
      consultation1Id,
    ]);
    expect(page2Offset.pageInfo).toEqual({
      limit: 2,
      page: 2,
      totalCount: 4,
      hasNextPage: false,
      nextCursor: null,
    });

    // Foreign clinic cursor is rejected with 400 VALIDATION_ERROR
    const foreignCursorRes = await f.get(
      `/organizations/clinica-a/consultations?cursor=${consultationClinicBId}`,
    );
    expect(foreignCursorRes.status).toBe(400);
    expect(await foreignCursorRes.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  test("supports combinable filters by date range (in clinic timezone), professional, patient, consultation status, anamnesis status, and patient name search", async () => {
    const f = createFixture();

    // Filter by date range in America/Fortaleza (2026-10-12 includes consultation4 at 22:30 local = 2026-10-13T01:30Z and consultation3 at 10:00 local)
    const byDateRes = await f.get(
      "/organizations/clinica-a/consultations?startDate=2026-10-12&endDate=2026-10-12",
    );
    expect(byDateRes.status).toBe(200);
    const byDate = (await byDateRes.json()) as ListConsultationsResponse;
    expect(byDate.data.map((item) => item.id)).toEqual([
      consultation4Id,
      consultation3Id,
    ]);

    // Filter by professionalId + status
    const byProfAndStatusRes = await f.get(
      `/organizations/clinica-a/consultations?professionalId=${profAId}&status=IN_PROGRESS`,
    );
    expect(byProfAndStatusRes.status).toBe(200);
    const byProfAndStatus =
      (await byProfAndStatusRes.json()) as ListConsultationsResponse;
    expect(byProfAndStatus.data.map((item) => item.id)).toEqual([
      consultation2Id,
    ]);

    // Filter by patientId + anamnesisStatus
    const byPatientAndAnamnesisRes = await f.get(
      `/organizations/clinica-a/consultations?patientId=${patient1Id}&anamnesisStatus=APPROVED`,
    );
    expect(byPatientAndAnamnesisRes.status).toBe(200);
    const byPatientAndAnamnesis =
      (await byPatientAndAnamnesisRes.json()) as ListConsultationsResponse;
    expect(byPatientAndAnamnesis.data.map((item) => item.id)).toEqual([
      consultation1Id,
    ]);

    // Filter by accent-insensitive patient name search (?search=joao) combined with date range
    const bySearchAndDateRes = await f.get(
      "/organizations/clinica-a/consultations?search=joao&startDate=2026-10-11&endDate=2026-10-12",
    );
    expect(bySearchAndDateRes.status).toBe(200);
    const bySearchAndDate =
      (await bySearchAndDateRes.json()) as ListConsultationsResponse;
    expect(bySearchAndDate.data.map((item) => item.id)).toEqual([
      consultation3Id,
    ]);

    // Invalid date range (startDate > endDate) -> 400 VALIDATION_ERROR
    const invalidRangeRes = await f.get(
      "/organizations/clinica-a/consultations?startDate=2026-10-15&endDate=2026-10-10",
    );
    expect(invalidRangeRes.status).toBe(400);
    expect(await invalidRangeRes.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    // Invalid calendar date -> 400 VALIDATION_ERROR
    const invalidCalendarDateRes = await f.get(
      "/organizations/clinica-a/consultations?startDate=2026-02-30",
    );
    expect(invalidCalendarDateRes.status).toBe(400);
    expect(await invalidCalendarDateRes.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  test("enforces RBAC: RECEPTIONIST and non-clinical ADMIN receive 403 PERMISSION_DENIED while PROFESSIONAL and ADMIN_PROFESSIONAL succeed", async () => {
    const f = createFixture();

    // Unauthenticated -> 401 UNAUTHENTICATED
    const unauth = await f.get("/organizations/clinica-a/consultations", false);
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });

    // Non-member -> 404 NOT_FOUND
    const nonMember = await f.get("/organizations/clinica-b/consultations");
    expect(nonMember.status).toBe(404);
    expect(await nonMember.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });

    // Suspended membership -> 403 MEMBERSHIP_INACTIVE
    f.setMembershipStatus("SUSPENDED");
    const suspended = await f.get("/organizations/clinica-a/consultations");
    expect(suspended.status).toBe(403);
    expect(await suspended.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });
    f.setMembershipStatus("ACTIVE");

    // RECEPTIONIST and ADMIN -> 403 PERMISSION_DENIED
    for (const deniedRole of ["RECEPTIONIST", "ADMIN"] as const) {
      f.setRole(deniedRole);
      const denied = await f.get("/organizations/clinica-a/consultations");
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({
        error: {
          code: "PERMISSION_DENIED",
          details: { requiredPermission: "consultations:read" },
        },
      });
    }

    // PROFESSIONAL and ADMIN_PROFESSIONAL -> 200 OK
    for (const allowedRole of ["PROFESSIONAL", "ADMIN_PROFESSIONAL"] as const) {
      f.setRole(allowedRole);
      const allowed = await f.get("/organizations/clinica-a/consultations");
      expect(allowed.status).toBe(200);
    }
  });
});
