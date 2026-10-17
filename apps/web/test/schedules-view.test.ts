import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// 1. Strict Rule: mock server-only before any import
mock.module("server-only", () => ({}));

let mockSessionToken: string | null = "valid-session-jwt";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
  }),
}));

mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

const mockPush = mock(() => {});
const mockReplace = mock(() => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

// Dynamic import of server and shared code
const {
  getWeeklySchedule,
  getScheduleExceptions,
  getScheduleProfessionals,
  ScheduleApiError,
} = await import("../server/schedules");

const {
  formatTimezoneCallout,
  checkIntervalOverlap,
  groupScheduleRulesByDay,
  formatExceptionDateRange,
  filterExceptions,
  timeToMinutes,
  DAYS_OF_WEEK,
} = await import("../lib/schedules");

const { SchedulesView } = await import(
  "../app/app/[orgSlug]/settings/schedules/schedules-view"
);

const {
  SchedulesForbidden,
  SchedulesError,
  default: SchedulesSettingsPage,
} = await import("../app/app/[orgSlug]/settings/schedules/page");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
  mockPush.mockClear();
  mockReplace.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

// Sample test data
const sampleWeeklySchedule = {
  timezone: "America/Sao_Paulo",
  rules: [
    {
      dayOfWeek: "MONDAY" as const,
      startTime: "08:00",
      endTime: "12:00",
      slotDurationMinutes: 30,
    },
    {
      dayOfWeek: "MONDAY" as const,
      startTime: "13:00",
      endTime: "18:00",
      slotDurationMinutes: 30,
    },
    {
      dayOfWeek: "TUESDAY" as const,
      startTime: "08:00",
      endTime: "17:00",
      slotDurationMinutes: 45,
    },
    {
      dayOfWeek: "WEDNESDAY" as const,
      startTime: "08:00",
      endTime: "12:00",
      slotDurationMinutes: 30,
    },
    {
      dayOfWeek: "WEDNESDAY" as const,
      startTime: "10:00", // Overlap with 08:00-12:00
      endTime: "14:00",
      slotDurationMinutes: 30,
    },
  ],
};

const sampleExceptionsData = {
  timezone: "America/Sao_Paulo",
  exceptions: [
    {
      id: "exc-1",
      professionalId: null, // Clinic-wide
      startsAt: "2026-12-25T00:00:00.000Z",
      endsAt: "2026-12-25T23:59:59.000Z",
      timezone: "America/Sao_Paulo",
      reason: "Feriado de Natal",
    },
    {
      id: "exc-2",
      professionalId: "doc-1",
      startsAt: "2026-11-10T08:00:00.000Z",
      endsAt: "2026-11-10T12:00:00.000Z",
      timezone: "America/Sao_Paulo",
      reason: "Congresso Médico",
    },
    {
      id: "exc-3",
      professionalId: "doc-2",
      startsAt: "2026-12-20T08:00:00.000Z",
      endsAt: "2027-01-05T18:00:00.000Z",
      timezone: "America/Sao_Paulo",
      reason: "Férias programadas",
    },
  ],
};

const sampleProfessionals = [
  { id: "doc-1", name: "Dra. Ana Paula", role: "ADMIN_PROFESSIONAL" },
  { id: "doc-2", name: "Dr. Carlos Santos", role: "PROFESSIONAL" },
];

describe("Schedules Settings - Server Layer (#308)", () => {
  test("getWeeklySchedule throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(getWeeklySchedule("clinica-vida")).rejects.toThrow(
      "Entre novamente para continuar.",
    );
  });

  test("getWeeklySchedule throws FORBIDDEN on 403 response", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });

    try {
      await getWeeklySchedule("clinica-vida");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ScheduleApiError);
      expect((err as InstanceType<typeof ScheduleApiError>).code).toBe(
        "FORBIDDEN",
      );
    }
  });

  test("getWeeklySchedule throws NOT_FOUND on 404 response", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Not found" }), { status: 404 });

    try {
      await getWeeklySchedule("clinica-vida");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ScheduleApiError);
      expect((err as InstanceType<typeof ScheduleApiError>).code).toBe(
        "NOT_FOUND",
      );
    }
  });

  test("getWeeklySchedule returns valid schedule rules", async () => {
    globalThis.fetch = async (url) => {
      expect(String(url)).toContain(
        "/organizations/clinica-vida/settings/schedule-rules",
      );
      return new Response(JSON.stringify(sampleWeeklySchedule), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await getWeeklySchedule("clinica-vida");
    expect(result.timezone).toBe("America/Sao_Paulo");
    expect(result.rules.length).toBe(5);
    expect(result.rules[0].dayOfWeek).toBe("MONDAY");
  });

  test("getScheduleExceptions throws UNAUTHENTICATED when token is missing", async () => {
    mockSessionToken = null;
    expect(getScheduleExceptions("clinica-vida")).rejects.toThrow(
      "Entre novamente para continuar.",
    );
  });

  test("getScheduleExceptions returns valid exceptions list", async () => {
    globalThis.fetch = async (url) => {
      expect(String(url)).toContain(
        "/organizations/clinica-vida/settings/schedule-exceptions",
      );
      return new Response(JSON.stringify(sampleExceptionsData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await getScheduleExceptions("clinica-vida");
    expect(result.timezone).toBe("America/Sao_Paulo");
    expect(result.exceptions.length).toBe(3);
    expect(result.exceptions[0].reason).toBe("Feriado de Natal");
  });

  test("getScheduleProfessionals returns mapped members", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "m-1",
              userId: "doc-1",
              userName: "Dra. Ana Paula",
              email: "ana@clinica.com",
              role: "ADMIN_PROFESSIONAL",
            },
            {
              id: "m-2",
              userId: "doc-2",
              userName: "Dr. Carlos Santos",
              email: "carlos@clinica.com",
              role: "PROFESSIONAL",
            },
            {
              id: "m-3",
              userId: "rec-1",
              userName: "Mariana Recepção",
              email: "mariana@clinica.com",
              role: "RECEPTIONIST",
            },
          ],
        }),
        { status: 200 },
      );

    const profs = await getScheduleProfessionals("clinica-vida");
    expect(profs.length).toBe(2);
    expect(profs[0].name).toBe("Dra. Ana Paula");
    expect(profs[1].name).toBe("Dr. Carlos Santos");
  });
});

describe("Schedules - Shared Library & Formatters (#308)", () => {
  test("timeToMinutes converts HH:MM to minutes accurately", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("08:00")).toBe(480);
    expect(timeToMinutes("08:30")).toBe(510);
    expect(timeToMinutes("12:00")).toBe(720);
    expect(timeToMinutes("23:59")).toBe(1439);
    expect(timeToMinutes("invalid")).toBe(0);
  });

  test("formatTimezoneCallout produces prominent official timezone banner text", () => {
    const callout = formatTimezoneCallout("America/Sao_Paulo");
    expect(callout).toContain("Fuso horário oficial:");
    expect(callout).toContain("América/São Paulo");
    expect(callout).toContain("GMT-3");

    const fallback = formatTimezoneCallout(null);
    expect(fallback).toContain("Fuso horário oficial: América/São Paulo");
  });

  test("checkIntervalOverlap detects overlap between intervals correctly", () => {
    // Non-overlapping intervals
    const clean = [
      {
        dayOfWeek: "MONDAY" as const,
        startTime: "08:00",
        endTime: "12:00",
        slotDurationMinutes: 30,
      },
      {
        dayOfWeek: "MONDAY" as const,
        startTime: "13:00",
        endTime: "18:00",
        slotDurationMinutes: 30,
      },
    ];
    expect(checkIntervalOverlap(clean)).toBe(false);

    // Contiguous intervals (12:00 end and 12:00 start) are not overlapping
    const contiguous = [
      {
        dayOfWeek: "MONDAY" as const,
        startTime: "08:00",
        endTime: "12:00",
        slotDurationMinutes: 30,
      },
      {
        dayOfWeek: "MONDAY" as const,
        startTime: "12:00",
        endTime: "17:00",
        slotDurationMinutes: 30,
      },
    ];
    expect(checkIntervalOverlap(contiguous)).toBe(false);

    // Overlapping intervals (08:00-12:00 and 10:00-14:00)
    const overlapping = [
      {
        dayOfWeek: "WEDNESDAY" as const,
        startTime: "08:00",
        endTime: "12:00",
        slotDurationMinutes: 30,
      },
      {
        dayOfWeek: "WEDNESDAY" as const,
        startTime: "10:00",
        endTime: "14:00",
        slotDurationMinutes: 30,
      },
    ];
    expect(checkIntervalOverlap(overlapping)).toBe(true);
  });

  test("groupScheduleRulesByDay groups all 7 days with overlap status", () => {
    const groups = groupScheduleRulesByDay(sampleWeeklySchedule.rules);

    expect(groups.length).toBe(7);
    expect(groups.map((g) => g.dayOfWeek)).toEqual([...DAYS_OF_WEEK]);

    // Monday: 2 intervals, no overlap
    expect(groups[0].dayOfWeek).toBe("MONDAY");
    expect(groups[0].label).toBe("Segunda-feira");
    expect(groups[0].totalIntervals).toBe(2);
    expect(groups[0].hasOverlap).toBe(false);

    // Tuesday: 1 interval
    expect(groups[1].dayOfWeek).toBe("TUESDAY");
    expect(groups[1].totalIntervals).toBe(1);
    expect(groups[1].hasOverlap).toBe(false);

    // Wednesday: 2 overlapping intervals
    expect(groups[2].dayOfWeek).toBe("WEDNESDAY");
    expect(groups[2].totalIntervals).toBe(2);
    expect(groups[2].hasOverlap).toBe(true);

    // Thursday to Sunday: 0 intervals (closed)
    expect(groups[3].totalIntervals).toBe(0);
    expect(groups[4].totalIntervals).toBe(0);
    expect(groups[5].totalIntervals).toBe(0);
    expect(groups[6].totalIntervals).toBe(0);
  });

  test("formatExceptionDateRange handles single-day and multi-day ranges", () => {
    const singleDay = formatExceptionDateRange(
      "2026-12-25T00:00:00.000Z",
      "2026-12-25T23:59:59.000Z",
      "America/Sao_Paulo",
    );
    expect(singleDay).toContain("25/12/2026");

    const multiDay = formatExceptionDateRange(
      "2026-12-20T08:00:00.000Z",
      "2027-01-05T18:00:00.000Z",
      "America/Sao_Paulo",
    );
    expect(multiDay).toContain("20/12/2026");
    expect(multiDay).toContain("05/01/2027");
  });

  test("filterExceptions filters by professional ID or clinic", () => {
    // All
    const all = filterExceptions(sampleExceptionsData.exceptions, "all");
    expect(all.length).toBe(3);

    // Toda a clínica
    const clinic = filterExceptions(sampleExceptionsData.exceptions, "clinic");
    expect(clinic.length).toBe(1);
    expect(clinic[0].reason).toBe("Feriado de Natal");

    // Specific doctor
    const doc1 = filterExceptions(sampleExceptionsData.exceptions, "doc-1");
    expect(doc1.length).toBe(1);
    expect(doc1[0].reason).toBe("Congresso Médico");

    const doc2 = filterExceptions(sampleExceptionsData.exceptions, "doc-2");
    expect(doc2.length).toBe(1);
    expect(doc2[0].reason).toBe("Férias programadas");
  });
});

describe("Schedules Settings - UI View Component (#308)", () => {
  test("renders header with title and action button (?sheet=new)", () => {
    const html = renderToStaticMarkup(
      createElement(SchedulesView, {
        orgSlug: "clinica-vida",
        weeklySchedule: sampleWeeklySchedule,
        exceptionsData: sampleExceptionsData,
        professionals: sampleProfessionals,
      }),
    );

    expect(html).toContain("Horários de Atendimento e Bloqueios");
    expect(html).toContain("Novo horário / bloqueio");
    expect(html).toContain("sheet=new");
  });

  test("renders prominent official timezone callout at top", () => {
    const html = renderToStaticMarkup(
      createElement(SchedulesView, {
        orgSlug: "clinica-vida",
        weeklySchedule: sampleWeeklySchedule,
        exceptionsData: sampleExceptionsData,
        professionals: sampleProfessionals,
      }),
    );

    expect(html).toContain("Fuso horário oficial: América/São Paulo");
    expect(html).toContain("GMT-3");
    expect(html).toContain("respeitam o fuso horário oficial");
  });

  test("renders weekly schedule days and intervals", () => {
    const html = renderToStaticMarkup(
      createElement(SchedulesView, {
        orgSlug: "clinica-vida",
        weeklySchedule: sampleWeeklySchedule,
        exceptionsData: sampleExceptionsData,
        professionals: sampleProfessionals,
      }),
    );

    expect(html).toContain("Segunda-feira");
    expect(html).toContain("08:00 - 12:00");
    expect(html).toContain("13:00 - 18:00");
    expect(html).toContain("30 min");

    expect(html).toContain("Terça-feira");
    expect(html).toContain("08:00 - 17:00");
    expect(html).toContain("45 min");
  });

  test("renders neutral badge 'Sem atendimento' on closed days", () => {
    const html = renderToStaticMarkup(
      createElement(SchedulesView, {
        orgSlug: "clinica-vida",
        weeklySchedule: sampleWeeklySchedule,
        exceptionsData: sampleExceptionsData,
        professionals: sampleProfessionals,
      }),
    );

    expect(html).toContain("Sem atendimento");
    expect(html).toContain("Quinta-feira");
    expect(html).toContain("Sexta-feira");
    expect(html).toContain("Sábado");
    expect(html).toContain("Domingo");
  });

  test("renders overlap warning indicator when intervals conflict", () => {
    const html = renderToStaticMarkup(
      createElement(SchedulesView, {
        orgSlug: "clinica-vida",
        weeklySchedule: sampleWeeklySchedule,
        exceptionsData: sampleExceptionsData,
        professionals: sampleProfessionals,
      }),
    );

    expect(html).toContain("Atenção: Há horários sobrepostos neste dia");
  });

  test("renders exceptions list with affected professional and dates", () => {
    const html = renderToStaticMarkup(
      createElement(SchedulesView, {
        orgSlug: "clinica-vida",
        weeklySchedule: sampleWeeklySchedule,
        exceptionsData: sampleExceptionsData,
        professionals: sampleProfessionals,
        initialTab: "exceptions",
      }),
    );

    expect(html).toContain("Feriado de Natal");
    expect(html).toContain("Toda a clínica");

    expect(html).toContain("Congresso Médico");
    expect(html).toContain("Dra. Ana Paula");

    expect(html).toContain("Férias programadas");
    expect(html).toContain("Dr. Carlos Santos");
  });

  test("renders edit action links with ?sheet=edit&scheduleId=...", () => {
    // Tab 1: Weekly schedule day edit link
    const weeklyHtml = renderToStaticMarkup(
      createElement(SchedulesView, {
        orgSlug: "clinica-vida",
        weeklySchedule: sampleWeeklySchedule,
        exceptionsData: sampleExceptionsData,
        professionals: sampleProfessionals,
        initialTab: "weekly",
      }),
    );
    expect(weeklyHtml).toContain("sheet=edit&amp;scheduleId=MONDAY");

    // Tab 2: Exception item edit link
    const exceptionsHtml = renderToStaticMarkup(
      createElement(SchedulesView, {
        orgSlug: "clinica-vida",
        weeklySchedule: sampleWeeklySchedule,
        exceptionsData: sampleExceptionsData,
        professionals: sampleProfessionals,
        initialTab: "exceptions",
      }),
    );
    expect(exceptionsHtml).toContain("sheet=edit&amp;scheduleId=exc-1");
  });

  test("renders empty states when no rules or exceptions exist", () => {
    // Tab 1 empty state
    const weeklyHtml = renderToStaticMarkup(
      createElement(SchedulesView, {
        orgSlug: "clinica-vida",
        weeklySchedule: { timezone: "America/Sao_Paulo", rules: [] },
        exceptionsData: { timezone: "America/Sao_Paulo", exceptions: [] },
        professionals: [],
        initialTab: "weekly",
      }),
    );
    expect(weeklyHtml).toContain("Nenhum horário cadastrado");

    // Tab 2 empty state
    const exceptionsHtml = renderToStaticMarkup(
      createElement(SchedulesView, {
        orgSlug: "clinica-vida",
        weeklySchedule: { timezone: "America/Sao_Paulo", rules: [] },
        exceptionsData: { timezone: "America/Sao_Paulo", exceptions: [] },
        professionals: [],
        initialTab: "exceptions",
      }),
    );
    expect(exceptionsHtml).toContain("Nenhum bloqueio ou recesso registrado");
  });
});

describe("Schedules Settings - Page Layer & Role Protection (#308)", () => {
  test("SchedulesForbidden renders 403 message for unauthorized roles", () => {
    const html = renderToStaticMarkup(
      createElement(SchedulesForbidden, {
        orgSlug: "clinica-vida",
      }),
    );

    expect(html).toContain("403 — Acesso Restrito");
    expect(html).toContain("Acesso restrito a administradores e profissionais");
    expect(html).toContain("Voltar ao Dashboard");
  });

  test("SchedulesError renders error message with retry button", () => {
    const html = renderToStaticMarkup(
      createElement(SchedulesError, {
        orgSlug: "clinica-vida",
        errorMessage: "Falha ao conectar com o serviço de horários",
      }),
    );

    expect(html).toContain("Não foi possível carregar os horários e bloqueios");
    expect(html).toContain("Falha ao conectar com o serviço de horários");
    expect(html).toContain("Tentar novamente");
    expect(html).toContain("/settings/schedules");
  });

  test("SchedulesSettingsPage blocks unauthorized roles (RECEPTIONIST)", async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (
        urlStr.endsWith("/organizations") ||
        urlStr.includes("/organizations?")
      ) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "org-1",
                name: "Clínica Vida",
                slug: "clinica-vida",
                role: "RECEPTIONIST", // Not admin or admin_professional
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    };

    const pageElement = await SchedulesSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-vida" }),
    });

    const html = renderToStaticMarkup(pageElement);
    expect(html).toContain("403 — Acesso Restrito");
    expect(html).toContain("Acesso restrito a administradores e profissionais");
  });

  test("SchedulesSettingsPage allows ADMIN and ADMIN_PROFESSIONAL roles", async () => {
    globalThis.fetch = async (url) => {
      const urlStr = String(url);
      if (
        urlStr.includes("/organizations/") &&
        urlStr.includes("/schedule-rules")
      ) {
        return new Response(JSON.stringify(sampleWeeklySchedule), {
          status: 200,
        });
      }
      if (
        urlStr.includes("/organizations/") &&
        urlStr.includes("/schedule-exceptions")
      ) {
        return new Response(JSON.stringify(sampleExceptionsData), {
          status: 200,
        });
      }
      if (urlStr.includes("/organizations/") && urlStr.includes("/members")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "m-1",
                userId: "doc-1",
                userName: "Dra. Ana Paula",
                email: "ana@clinica.com",
                role: "ADMIN_PROFESSIONAL",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes("/organizations")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "org-1",
                name: "Clínica Vida",
                slug: "clinica-vida",
                role: "ADMIN",
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    };

    const pageElement = await SchedulesSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-vida" }),
    });

    const html = renderToStaticMarkup(pageElement);
    expect(html).toContain("Horários de Atendimento e Bloqueios");
    expect(html).toContain("Fuso horário oficial: América/São Paulo");
  });
});
