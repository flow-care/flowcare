import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  addDays,
  formatAppointmentTime,
  formatDateLabel,
  formatWeekRangeLabel,
  getTodayDateString,
  getWeekRange,
  isValidDateString,
  normalizeAppointmentStatus,
} from "../lib/appointments";

mock.module("server-only", () => ({}));

let mockCookieToken: string | null = "valid-token";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockCookieToken ? { value: mockCookieToken } : undefined,
    set: () => {},
  }),
}));

const { getAppointments, AppointmentsApiError } = await import(
  "../server/appointments"
);

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockCookieToken = "valid-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

test("normalizeAppointmentStatus maps all appointment statuses accurately", () => {
  expect(normalizeAppointmentStatus("RESERVED")).toEqual({
    key: "SCHEDULED",
    label: "Agendado",
    variant: "secondary",
  });
  expect(normalizeAppointmentStatus("CONFIRMED")).toEqual({
    key: "SCHEDULED",
    label: "Confirmado",
    variant: "secondary",
  });
  expect(normalizeAppointmentStatus("SCHEDULED")).toEqual({
    key: "SCHEDULED",
    label: "Agendado",
    variant: "secondary",
  });
  expect(normalizeAppointmentStatus("WAITING")).toEqual({
    key: "WAITING",
    label: "Aguardando",
    variant: "outline",
  });
  expect(normalizeAppointmentStatus("IN_PROGRESS")).toEqual({
    key: "IN_CONSULTATION",
    label: "Em consulta",
    variant: "default",
  });
  expect(normalizeAppointmentStatus("IN_CONSULTATION")).toEqual({
    key: "IN_CONSULTATION",
    label: "Em consulta",
    variant: "default",
  });
  expect(normalizeAppointmentStatus("COMPLETED")).toEqual({
    key: "COMPLETED",
    label: "Concluído",
    variant: "outline",
  });
  expect(normalizeAppointmentStatus("CANCELLED")).toEqual({
    key: "CANCELLED",
    label: "Cancelado",
    variant: "destructive",
  });
  expect(normalizeAppointmentStatus("NO_SHOW")).toEqual({
    key: "NO_SHOW",
    label: "Não compareceu",
    variant: "destructive",
  });
});

test("date utilities handle calculations, ranges and formatting", () => {
  expect(isValidDateString("2026-10-14")).toBe(true);
  expect(isValidDateString("invalid")).toBe(false);
  expect(isValidDateString("2026-02-30")).toBe(false);

  expect(getTodayDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(addDays("2026-10-14", 1)).toBe("2026-10-15");
  expect(addDays("2026-10-14", -1)).toBe("2026-10-13");
  expect(addDays("2026-10-31", 1)).toBe("2026-11-01");

  const week = getWeekRange("2026-10-14"); // Wednesday
  expect(week.startDate).toBe("2026-10-12"); // Monday
  expect(week.endDate).toBe("2026-10-18"); // Sunday
  expect(week.days).toHaveLength(7);
  expect(week.days[0]).toBe("2026-10-12");
  expect(week.days[6]).toBe("2026-10-18");

  expect(formatDateLabel("2026-10-14")).toContain("14 de outubro de 2026");
  expect(formatWeekRangeLabel("2026-10-12", "2026-10-18")).toBe(
    "12 a 18 de outubro de 2026",
  );

  expect(formatAppointmentTime("2026-10-14T10:00:00", 30)).toBe(
    "10:00 – 10:30",
  );
  expect(formatAppointmentTime("2026-10-14T14:45:00", 45)).toBe(
    "14:45 – 15:30",
  );
});

test("getAppointments calls backend and returns typed appointments matching backend", async () => {
  const requestedUrls: string[] = [];
  const authHeaders: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestedUrls.push(url);
    authHeaders.push(
      String((init?.headers as Record<string, string>)?.Authorization),
    );

    if (url.includes("/appointments")) {
      return Response.json({
        timeZone: "America/Sao_Paulo",
        appointments: [
          {
            id: "apt-1",
            patientId: "patient-1",
            professionalId: "prof-1",
            scheduledAt: "2026-10-14T13:00:00.000Z",
            localScheduledAt: "2026-10-14T10:00:00",
            durationMinutes: 30,
            status: "CONFIRMED",
            version: 1,
          },
        ],
        nextCursor: null,
      });
    }

    if (url.includes("/patients")) {
      return Response.json({
        data: [
          {
            id: "patient-1",
            fullName: "Maria Silva",
            phone: "11999999999",
          },
        ],
        pageInfo: { nextCursor: null, hasNextPage: false },
      });
    }

    if (url.includes("/members")) {
      return Response.json({
        data: [
          {
            userId: "prof-1",
            userName: "Dra. Ana Santos",
            role: "PROFESSIONAL",
          },
        ],
      });
    }

    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;

  const result = await getAppointments("clinica-teste", {
    startDate: "2026-10-14",
    endDate: "2026-10-14",
  });

  const appointmentsUrl = requestedUrls.find((u) =>
    u.includes("/appointments"),
  );
  expect(appointmentsUrl).toBeDefined();
  expect(appointmentsUrl).toContain(
    "/organizations/clinica-teste/appointments?startDate=2026-10-14&endDate=2026-10-14",
  );
  expect(authHeaders[0]).toBe("Bearer valid-token");
  expect(result.timeZone).toBe("America/Sao_Paulo");
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe("apt-1");
  expect(result[0].patientName).toBe("Maria Silva");
  expect(result[0].professionalName).toBe("Dra. Ana Santos");
  expect(result[0].status).toBe("CONFIRMED");
});

test("getAppointments throws AppointmentsApiError when unauthenticated", async () => {
  mockCookieToken = null;
  expect(
    getAppointments("clinica-teste", {
      startDate: "2026-10-14",
      endDate: "2026-10-14",
    }),
  ).rejects.toBeInstanceOf(AppointmentsApiError);
});

test("getAppointments throws AppointmentsApiError when upstream returns 500", async () => {
  globalThis.fetch = (async () =>
    new Response("Error", { status: 500 })) as unknown as typeof fetch;

  expect(
    getAppointments("clinica-teste", {
      startDate: "2026-10-14",
      endDate: "2026-10-14",
    }),
  ).rejects.toBeInstanceOf(AppointmentsApiError);
});
