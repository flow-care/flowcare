import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type {
  AppointmentStatus,
  MembershipRole,
  MembershipStatus,
  PrismaClient,
} from "../src/generated/prisma/client";
import type { DashboardMetricsResponse } from "../src/modules/dashboard/model";
import { metricsPeriod } from "../src/modules/dashboard/service";
import type { Mailer } from "../src/services/mailer";
import { signSessionToken } from "../src/services/session-token";

const secret = "dashboard-indicators-test-secret-32-chars!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

interface StoredAppointment {
  id: string;
  organizationId: string;
  scheduledAt: Date;
  status: AppointmentStatus;
}

interface StoredMembership {
  id: string;
  userId: string;
  organizationId: string;
  orgSlug: string;
  role: MembershipRole;
  status: MembershipStatus;
}

function createFixture() {
  const fixedNow = new Date("2026-10-13T12:00:00.000Z");

  const organizations = [
    { id: clinicAId, slug: "clinica-a", timezone: "America/Sao_Paulo" },
    { id: clinicBId, slug: "clinica-b", timezone: "America/Fortaleza" },
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
      userId: "usr-prof",
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
      role: "RECEPTIONIST",
      status: "SUSPENDED",
    },
    {
      id: "mem-clinic-b-admin",
      userId: "usr-clinic-b",
      organizationId: clinicBId,
      orgSlug: "clinica-b",
      role: "ADMIN",
      status: "ACTIVE",
    },
  ];

  // In America/Sao_Paulo (UTC-3), 2026-10-13 00:00 local is 2026-10-13T03:00:00.000Z.
  // 2026-10-14 00:00 local is 2026-10-14T03:00:00.000Z.
  // 2026-10-13T10:00:00.000Z is 07:00 local (Tuesday) -> today, week, month.
  // 2026-10-12T10:00:00.000Z is 07:00 local (Monday) -> week, month.
  // 2026-10-05T10:00:00.000Z is 07:00 local (Monday) -> month.
  const appointments: StoredAppointment[] = [
    // Clinic A - 2026-10-13 (today):
    // 2 RESERVED, 2 CONFIRMED, 3 COMPLETED, 2 CANCELLED, 1 NO_SHOW
    {
      id: "app-1",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-13T10:00:00.000Z"),
      status: "RESERVED",
    },
    {
      id: "app-2",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-13T10:30:00.000Z"),
      status: "RESERVED",
    },
    {
      id: "app-3",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-13T11:00:00.000Z"),
      status: "CONFIRMED",
    },
    {
      id: "app-4",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-13T11:30:00.000Z"),
      status: "CONFIRMED",
    },
    {
      id: "app-5",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-13T14:00:00.000Z"),
      status: "COMPLETED",
    },
    {
      id: "app-6",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-13T14:30:00.000Z"),
      status: "COMPLETED",
    },
    {
      id: "app-7",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-13T15:00:00.000Z"),
      status: "COMPLETED",
    },
    {
      id: "app-8",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-13T16:00:00.000Z"),
      status: "CANCELLED",
    },
    {
      id: "app-9",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-13T16:30:00.000Z"),
      status: "CANCELLED",
    },
    {
      id: "app-10",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-13T17:00:00.000Z"),
      status: "NO_SHOW",
    },
    // Clinic A - Monday 2026-10-12 (same week, same month)
    {
      id: "app-11",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-12T10:00:00.000Z"),
      status: "COMPLETED",
    },
    // Clinic A - Monday 2026-10-05 (previous week, same month)
    {
      id: "app-12",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-10-05T10:00:00.000Z"),
      status: "COMPLETED",
    },
    // Clinic A - September 2026 (previous month)
    {
      id: "app-13",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-09-20T10:00:00.000Z"),
      status: "COMPLETED",
    },

    // Clinic B - 2026-10-13:
    // 5 COMPLETED appointments
    {
      id: "app-b-1",
      organizationId: clinicBId,
      scheduledAt: new Date("2026-10-13T11:00:00.000Z"),
      status: "COMPLETED",
    },
    {
      id: "app-b-2",
      organizationId: clinicBId,
      scheduledAt: new Date("2026-10-13T12:00:00.000Z"),
      status: "COMPLETED",
    },
    {
      id: "app-b-3",
      organizationId: clinicBId,
      scheduledAt: new Date("2026-10-13T13:00:00.000Z"),
      status: "COMPLETED",
    },
    {
      id: "app-b-4",
      organizationId: clinicBId,
      scheduledAt: new Date("2026-10-13T14:00:00.000Z"),
      status: "COMPLETED",
    },
    {
      id: "app-b-5",
      organizationId: clinicBId,
      scheduledAt: new Date("2026-10-13T15:00:00.000Z"),
      status: "COMPLETED",
    },
  ];

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
    appointment: {
      groupBy: async ({
        by: _by,
        where,
      }: {
        by: string[];
        where: {
          organizationId: string;
          scheduledAt: { gte: Date; lt: Date };
        };
      }) => {
        const filtered = appointments.filter((app) => {
          if (app.organizationId !== where.organizationId) return false;
          if (app.scheduledAt < where.scheduledAt.gte) return false;
          if (app.scheduledAt >= where.scheduledAt.lt) return false;
          return true;
        });

        const countsByStatus = new Map<AppointmentStatus, number>();
        for (const item of filtered) {
          countsByStatus.set(
            item.status,
            (countsByStatus.get(item.status) ?? 0) + 1,
          );
        }

        return Array.from(countsByStatus.entries()).map(([status, count]) => ({
          status,
          _count: { _all: count },
        }));
      },
    },
  } as unknown as PrismaClient;

  const env = {
    port: 3000,
    version: "0.1.0",
    jwtSecret: secret,
    corsOrigin: "*",
    webAppUrl: "http://localhost:3000",
    wahaBaseUrl: "http://localhost:3001",
    wahaApiKey: "test-waha-key",
    trustProxy: false,
  } as Env;

  const app = createApp(env, {
    prisma,
    mailer: { send: async () => {} } as unknown as Mailer,
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
    prisma,
    appointments,
    tokenForUser,
    request,
    fixedNow,
  };
}

describe("Dashboard Indicators - metricsPeriod Unit Calculations", () => {
  const refTime = new Date("2026-10-13T12:00:00.000Z"); // Tuesday

  test("calculates today period in America/Sao_Paulo (UTC-3)", () => {
    const period = metricsPeriod({}, "America/Sao_Paulo", refTime);
    expect(period.periodStart.toISOString()).toBe("2026-10-13T03:00:00.000Z");
    expect(period.periodEnd.toISOString()).toBe("2026-10-14T03:00:00.000Z");
  });

  test("calculates week period starting on Monday", () => {
    const period = metricsPeriod(
      { period: "week" },
      "America/Sao_Paulo",
      refTime,
    );
    expect(period.periodStart.toISOString()).toBe("2026-10-12T03:00:00.000Z");
    expect(period.periodEnd.toISOString()).toBe("2026-10-19T03:00:00.000Z");
  });

  test("calculates month period from 1st of month to 1st of next month", () => {
    const period = metricsPeriod(
      { period: "month" },
      "America/Sao_Paulo",
      refTime,
    );
    expect(period.periodStart.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(period.periodEnd.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });

  test("calculates explicit custom range", () => {
    const period = metricsPeriod(
      { startDate: "2026-10-01", endDate: "2026-10-15" },
      "America/Sao_Paulo",
      refTime,
    );
    expect(period.periodStart.toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(period.periodEnd.toISOString()).toBe("2026-10-15T03:00:00.000Z");
  });

  test("allows startDate === endDate", () => {
    const period = metricsPeriod(
      { startDate: "2026-10-13", endDate: "2026-10-13" },
      "America/Sao_Paulo",
      refTime,
    );
    expect(period.periodStart.toISOString()).toBe("2026-10-13T03:00:00.000Z");
    expect(period.periodEnd.toISOString()).toBe("2026-10-13T03:00:00.000Z");
  });

  test("rejects inverted range where startDate > endDate", () => {
    expect(() =>
      metricsPeriod(
        { startDate: "2026-10-14", endDate: "2026-10-13" },
        "America/Sao_Paulo",
        refTime,
      ),
    ).toThrow();
  });

  test("rejects range exceeding 366 days", () => {
    expect(() =>
      metricsPeriod(
        { startDate: "2025-01-01", endDate: "2026-01-03" },
        "America/Sao_Paulo",
        refTime,
      ),
    ).toThrow();
  });

  test("rejects combining period with startDate or endDate", () => {
    expect(() =>
      metricsPeriod(
        { period: "today", startDate: "2026-10-13", endDate: "2026-10-14" },
        "America/Sao_Paulo",
        refTime,
      ),
    ).toThrow();
  });

  test("rejects providing only startDate without endDate", () => {
    expect(() =>
      metricsPeriod({ startDate: "2026-10-13" }, "America/Sao_Paulo", refTime),
    ).toThrow();
  });

  test("rejects invalid date format or calendar date", () => {
    expect(() =>
      metricsPeriod(
        { startDate: "2026-02-31", endDate: "2026-03-05" },
        "America/Sao_Paulo",
        refTime,
      ),
    ).toThrow();
  });

  test("rejects invalid timezone with validation error", () => {
    expect(() =>
      metricsPeriod({ period: "today" }, "Invalid/TZ_Name", refTime),
    ).toThrow();
  });
});

describe("GET /organizations/:orgSlug/dashboard/metrics HTTP Integration", () => {
  test("returns indicators for default today period in clinic's timezone", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-admin");

    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics",
      {
        token,
      },
    );
    expect(res.status).toBe(200);

    const data = (await res.json()) as DashboardMetricsResponse;
    expect(data.timeZone).toBe("America/Sao_Paulo");
    expect(data.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(data.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(typeof data.totalAppointments).toBe("number");
    expect(typeof data.scheduledAppointments).toBe("number");
    expect(typeof data.completedAppointments).toBe("number");
    expect(typeof data.cancelledAppointments).toBe("number");
    expect(typeof data.noShowAppointments).toBe("number");
  });

  test("returns indicators for week and month periods", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-admin");

    const weekRes = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?period=week",
      { token },
    );
    expect(weekRes.status).toBe(200);
    const weekData = (await weekRes.json()) as DashboardMetricsResponse;
    expect(weekData.timeZone).toBe("America/Sao_Paulo");
    expect(weekData.totalAppointments).toBeGreaterThanOrEqual(0);

    const monthRes = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?period=month",
      { token },
    );
    expect(monthRes.status).toBe(200);
    const monthData = (await monthRes.json()) as DashboardMetricsResponse;
    expect(monthData.timeZone).toBe("America/Sao_Paulo");
    expect(monthData.totalAppointments).toBeGreaterThanOrEqual(0);
  });

  test("returns indicators for custom explicit range", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-admin");

    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?startDate=2026-10-13&endDate=2026-10-14",
      { token },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardMetricsResponse;
    expect(data.periodStart).toBe("2026-10-13T03:00:00.000Z");
    expect(data.periodEnd).toBe("2026-10-14T03:00:00.000Z");
    expect(data.timeZone).toBe("America/Sao_Paulo");
    expect(data.totalAppointments).toBe(10);
    expect(data.scheduledAppointments).toBe(4);
    expect(data.completedAppointments).toBe(3);
    expect(data.cancelledAppointments).toBe(2);
    expect(data.noShowAppointments).toBe(1);
    expect(data.noShowRate).toBe(0.25);
  });

  test("computes noShowRate rounded to 4 decimals", async () => {
    const fix = createFixture();
    // Add appointments to produce 1 / 6 = 0.16666... -> 0.1667
    fix.appointments.push(
      {
        id: "calc-1",
        organizationId: clinicAId,
        scheduledAt: new Date("2026-11-05T10:00:00.000Z"),
        status: "COMPLETED",
      },
      {
        id: "calc-2",
        organizationId: clinicAId,
        scheduledAt: new Date("2026-11-05T11:00:00.000Z"),
        status: "COMPLETED",
      },
      {
        id: "calc-3",
        organizationId: clinicAId,
        scheduledAt: new Date("2026-11-05T12:00:00.000Z"),
        status: "COMPLETED",
      },
      {
        id: "calc-4",
        organizationId: clinicAId,
        scheduledAt: new Date("2026-11-05T13:00:00.000Z"),
        status: "COMPLETED",
      },
      {
        id: "calc-5",
        organizationId: clinicAId,
        scheduledAt: new Date("2026-11-05T14:00:00.000Z"),
        status: "COMPLETED",
      },
      {
        id: "calc-6",
        organizationId: clinicAId,
        scheduledAt: new Date("2026-11-05T15:00:00.000Z"),
        status: "NO_SHOW",
      },
    );

    const token = fix.tokenForUser("usr-admin");
    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?startDate=2026-11-05&endDate=2026-11-06",
      { token },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardMetricsResponse;
    expect(data.completedAppointments).toBe(5);
    expect(data.noShowAppointments).toBe(1);
    expect(data.noShowRate).toBe(0.1667);
  });

  test("returns null for noShowRate when denominator is 0", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-admin");

    // Range with only RESERVED appointments
    fix.appointments.push({
      id: "zero-denom",
      organizationId: clinicAId,
      scheduledAt: new Date("2026-12-01T10:00:00.000Z"),
      status: "RESERVED",
    });

    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?startDate=2026-12-01&endDate=2026-12-02",
      { token },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as DashboardMetricsResponse;
    expect(data.totalAppointments).toBe(1);
    expect(data.scheduledAppointments).toBe(1);
    expect(data.completedAppointments).toBe(0);
    expect(data.noShowAppointments).toBe(0);
    expect(data.noShowRate).toBeNull();
  });

  test("enforces strict multi-tenant isolation", async () => {
    const fix = createFixture();
    const tokenA = fix.tokenForUser("usr-admin");
    const tokenB = fix.tokenForUser("usr-clinic-b");

    const resA = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?startDate=2026-10-13&endDate=2026-10-14",
      { token: tokenA },
    );
    expect(resA.status).toBe(200);
    const dataA = (await resA.json()) as DashboardMetricsResponse;
    expect(dataA.totalAppointments).toBe(10);
    expect(dataA.timeZone).toBe("America/Sao_Paulo");

    const resB = await fix.request(
      "/organizations/clinica-b/dashboard/metrics?startDate=2026-10-13&endDate=2026-10-14",
      { token: tokenB },
    );
    expect(resB.status).toBe(200);
    const dataB = (await resB.json()) as DashboardMetricsResponse;
    expect(dataB.totalAppointments).toBe(5);
    expect(dataB.completedAppointments).toBe(5);
    expect(dataB.timeZone).toBe("America/Fortaleza");
  });

  test("rejects invalid period with 400 VALIDATION_ERROR", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-admin");

    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?period=invalid_period",
      { token },
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects inverted date ranges (startDate > endDate) with 400 VALIDATION_ERROR", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-admin");

    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?startDate=2026-10-20&endDate=2026-10-10",
      { token },
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects range exceeding 366 days with 400 VALIDATION_ERROR", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-admin");

    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?startDate=2025-01-01&endDate=2026-02-01",
      { token },
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects combining period with startDate and endDate with 400 VALIDATION_ERROR", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-admin");

    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?period=today&startDate=2026-10-13&endDate=2026-10-14",
      { token },
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects providing only startDate with 400 VALIDATION_ERROR", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-admin");

    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?startDate=2026-10-13",
      { token },
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects invalid date calendar format with 400 VALIDATION_ERROR", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-admin");

    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics?startDate=2026-02-31&endDate=2026-03-05",
      { token },
    );
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  test("allows all roles with dashboard:read capability (ADMIN, ADMIN_PROFESSIONAL, PROFESSIONAL, RECEPTIONIST)", async () => {
    const fix = createFixture();

    for (const userId of [
      "usr-admin",
      "usr-admin-prof",
      "usr-prof",
      "usr-recep",
    ]) {
      const token = fix.tokenForUser(userId);
      const res = await fix.request(
        "/organizations/clinica-a/dashboard/metrics?startDate=2026-10-13&endDate=2026-10-14",
        { token },
      );
      expect(res.status).toBe(200);
    }
  });

  test("rejects unauthenticated request with 401 UNAUTHENTICATED", async () => {
    const fix = createFixture();
    const res = await fix.request("/organizations/clinica-a/dashboard/metrics");
    expect(res.status).toBe(401);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("UNAUTHENTICATED");
  });

  test("rejects user from another clinic with 404 NOT_FOUND", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-clinic-b");

    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics",
      {
        token,
      },
    );
    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("NOT_FOUND");
  });

  test("rejects suspended membership with 403 MEMBERSHIP_INACTIVE", async () => {
    const fix = createFixture();
    const token = fix.tokenForUser("usr-suspended");

    const res = await fix.request(
      "/organizations/clinica-a/dashboard/metrics",
      {
        token,
      },
    );
    expect(res.status).toBe(403);
    const data = (await res.json()) as { error: { code: string } };
    expect(data.error.code).toBe("MEMBERSHIP_INACTIVE");
  });
});
