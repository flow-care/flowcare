import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { canOpenSection } from "@/lib/app-navigation";
import { formatScheduledAt } from "../components/flowcare/consultations/format-date";

mock.module("server-only", () => ({}));

let mockToken: string | null = "test-token";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) => (mockToken ? { value: mockToken } : undefined),
    set: () => {},
  }),
}));

const {
  getConsultations,
  listConsultationsResponseSchema,
  resolvePeriodDates,
} = await import("../server/consultations");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test";
  mockToken = "valid-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

describe("consultations web logic (#268)", () => {
  test("resolves period dates for today, week, and month relative to fixed time", () => {
    // 2026-10-14 is a Wednesday
    const refDate = new Date("2026-10-14T14:30:00.000Z");

    const today = resolvePeriodDates("today", refDate);
    expect(today.startDate).toBe("2026-10-14");
    expect(today.endDate).toBe("2026-10-14");

    const hoje = resolvePeriodDates("hoje", refDate);
    expect(hoje.startDate).toBe("2026-10-14");
    expect(hoje.endDate).toBe("2026-10-14");

    const week = resolvePeriodDates("week", refDate);
    expect(week.startDate).toBe("2026-10-12"); // Monday
    expect(week.endDate).toBe("2026-10-18"); // Sunday

    const month = resolvePeriodDates("month", refDate);
    expect(month.startDate).toBe("2026-10-01");
    expect(month.endDate).toBe("2026-10-31");

    expect(resolvePeriodDates(undefined, refDate)).toEqual({});
    expect(resolvePeriodDates("all", refDate)).toEqual({});
  });

  test("formats scheduled dates cleanly into Brazilian human readable format", () => {
    expect(
      formatScheduledAt("2026-10-10T12:00:00.000Z", "2026-10-10T09:00:00"),
    ).toBe("10/10/2026 às 09:00");

    expect(formatScheduledAt("2026-10-15T15:45:00")).toBe(
      "15/10/2026 às 15:45",
    );
  });

  test("validates consultation response schema with Zod", () => {
    const validPayload = {
      timeZone: "America/Sao_Paulo",
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          appointmentId: null,
          patientId: "22222222-2222-4222-8222-222222222222",
          professionalId: "33333333-3333-4333-8333-333333333333",
          scheduledAt: "2026-10-14T10:00:00.000Z",
          localScheduledAt: "2026-10-14T07:00:00",
          startedAt: null,
          completedAt: null,
          status: "SCHEDULED",
          anamnesisStatus: "PENDING",
          patient: {
            id: "22222222-2222-4222-8222-222222222222",
            fullName: "Carlos Silva",
          },
          professional: {
            id: "33333333-3333-4333-8333-333333333333",
            fullName: "Dra. Maria Santos",
            professionalTitle: "Clínica Geral",
            registrationNumber: "CRM/SP 123456",
          },
          version: 1,
          createdAt: "2026-10-14T08:00:00.000Z",
          updatedAt: "2026-10-14T08:00:00.000Z",
        },
      ],
      items: [],
      pageInfo: {
        limit: 20,
        page: 1,
        totalCount: 1,
        hasNextPage: false,
        nextCursor: null,
      },
    };

    const parsed = listConsultationsResponseSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
  });

  test("enforces RBAC: only ADMIN_PROFESSIONAL and PROFESSIONAL have access to consultations", () => {
    expect(canOpenSection("PROFESSIONAL", "consultations")).toBe(true);
    expect(canOpenSection("ADMIN_PROFESSIONAL", "consultations")).toBe(true);
    expect(canOpenSection("RECEPTIONIST", "consultations")).toBe(false);
    expect(canOpenSection("ADMIN", "consultations")).toBe(false);
  });

  test("getConsultations handles unauthenticated sessions and API responses", async () => {
    // When no cookie is found, getSessionToken returns null
    mockToken = null;
    await expect(getConsultations("clinica-teste")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });

    mockToken = "valid-token";
    // Mock successful fetch
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const urlStr = url.toString();
      expect(urlStr).toContain("/organizations/clinica-teste/consultations");
      expect(urlStr).toContain("status=IN_PROGRESS");
      expect(urlStr).toContain("startDate=");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer valid-token",
      });
      return Response.json({
        timeZone: "America/Sao_Paulo",
        data: [],
        items: [],
        pageInfo: {
          limit: 20,
          page: 1,
          totalCount: 0,
          hasNextPage: false,
          nextCursor: null,
        },
      });
    }) as unknown as typeof fetch;

    const res = await getConsultations("clinica-teste", {
      period: "today",
      status: "IN_PROGRESS",
    });
    expect(res.data).toEqual([]);

    // Mock 403 Forbidden
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), {
        status: 403,
      })) as unknown as typeof fetch;

    await expect(getConsultations("clinica-teste")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
