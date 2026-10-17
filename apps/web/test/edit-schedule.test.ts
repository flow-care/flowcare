import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.API_INTERNAL_URL = "http://localhost:3001";

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
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: () => {},
  }),
  useSearchParams: () => new URLSearchParams("sheet=edit&scheduleId=MONDAY"),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const {
  updateDayRulesAction,
  deleteDayRulesAction,
  deleteScheduleExceptionAction,
} = await import("../app/app/[orgSlug]/settings/schedules/actions");

const { EditScheduleForm } = await import(
  "../app/app/[orgSlug]/settings/schedules/edit-schedule-sheet"
);

describe("EditScheduleSheet (#310) - UI Form Component", () => {
  const dummyWeeklySchedule = {
    timezone: "America/Sao_Paulo",
    rules: [
      {
        dayOfWeek: "MONDAY" as const,
        startTime: "08:00",
        endTime: "18:00",
        slotDurationMinutes: 30,
      },
      {
        dayOfWeek: "TUESDAY" as const,
        startTime: "09:00",
        endTime: "17:00",
        slotDurationMinutes: 45,
      },
    ],
  };

  const dummyExceptionsData = {
    timezone: "America/Sao_Paulo",
    exceptions: [
      {
        id: "exc-natal",
        professionalId: null,
        startsAt: "2026-12-25T00:00:00.000Z",
        endsAt: "2026-12-25T23:59:00.000Z",
        timezone: "America/Sao_Paulo",
        reason: "Feriado de Natal",
      },
      {
        id: "exc-dr-marcelo",
        professionalId: "prof-1",
        startsAt: "2026-11-10T08:00:00.000Z",
        endsAt: "2026-11-15T18:00:00.000Z",
        timezone: "America/Sao_Paulo",
        reason: "Férias anuais",
      },
    ],
  };

  const dummyProfessionals = [{ id: "prof-1", name: "Dr. Marcelo Ramos" }];

  test("renders weekly rule editor for valid day with affected appointments alert", () => {
    const html = renderToStaticMarkup(
      createElement(EditScheduleForm, {
        orgSlug: "clinica-central",
        scheduleId: "MONDAY",
        onClose: () => {},
        weeklySchedule: dummyWeeklySchedule,
        exceptionsData: dummyExceptionsData,
        professionals: dummyProfessionals,
      }),
    );

    expect(html).toContain("Editar Horário: Segunda-feira");
    expect(html).toContain("Início do expediente");
    expect(html).toContain("Término do expediente");
    expect(html).toContain("08:00");
    expect(html).toContain("18:00");
    expect(html).toContain("Aviso sobre agendamentos existentes");
    expect(html).toContain("Desativar dia");
    expect(html).toContain("Salvar alterações");
  });

  test("renders exception details and removal dialog when scheduleId matches exception", () => {
    const html = renderToStaticMarkup(
      createElement(EditScheduleForm, {
        orgSlug: "clinica-central",
        scheduleId: "exc-natal",
        onClose: () => {},
        weeklySchedule: dummyWeeklySchedule,
        exceptionsData: dummyExceptionsData,
        professionals: dummyProfessionals,
      }),
    );

    expect(html).toContain("Bloqueio de Agenda");
    expect(html).toContain("Toda a clínica (Geral)");
    expect(html).toContain("Feriado de Natal");
    expect(html).toContain("Zona de Exclusão");
    expect(html).toContain("Remover este bloqueio");
  });

  test("renders clean 404/not found state when scheduleId is invalid", () => {
    const html = renderToStaticMarkup(
      createElement(EditScheduleForm, {
        orgSlug: "clinica-central",
        scheduleId: "non-existent-id",
        onClose: () => {},
        weeklySchedule: dummyWeeklySchedule,
        exceptionsData: dummyExceptionsData,
        professionals: dummyProfessionals,
      }),
    );

    expect(html).toContain("Item não encontrado");
    expect(html).toContain(
      "não corresponde a uma regra de horário ou bloqueio",
    );
    expect(html).toContain("Fechar");
  });
});

describe("EditScheduleSheet (#310) - Server Actions", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockSessionToken = "valid-session-jwt";
  });

  test("updateDayRulesAction updates rules for the day while keeping other days", async () => {
    let capturedBody: unknown = null;
    let getCalled = false;

    globalThis.fetch = mock(async (_url, init) => {
      if (init?.method === "GET") {
        getCalled = true;
        return new Response(
          JSON.stringify({
            timezone: "America/Sao_Paulo",
            rules: [
              {
                dayOfWeek: "MONDAY",
                startTime: "08:00",
                endTime: "12:00",
                slotDurationMinutes: 30,
              },
              {
                dayOfWeek: "TUESDAY",
                startTime: "09:00",
                endTime: "17:00",
                slotDurationMinutes: 45,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (init?.method === "PUT") {
        capturedBody = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify({
            timezone: "America/Sao_Paulo",
            rules: (capturedBody as { rules: unknown[] }).rules,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("", { status: 404 });
    });

    const res = await updateDayRulesAction("clinica-central", "MONDAY", [
      {
        dayOfWeek: "MONDAY",
        startTime: "08:00",
        endTime: "16:00",
        slotDurationMinutes: 30,
      },
    ]);

    expect(res.ok).toBe(true);
    expect(getCalled).toBe(true);
    const rules = (
      capturedBody as { rules: Array<{ dayOfWeek: string; endTime: string }> }
    ).rules;
    expect(rules.length).toBe(2);
    // Tuesday is preserved
    expect(rules.find((r) => r.dayOfWeek === "TUESDAY")?.endTime).toBe("17:00");
    // Monday is updated to 16:00
    expect(rules.find((r) => r.dayOfWeek === "MONDAY")?.endTime).toBe("16:00");
  });

  test("deleteDayRulesAction removes rules for the day while keeping other days", async () => {
    let capturedBody: unknown = null;

    globalThis.fetch = mock(async (_url, init) => {
      if (init?.method === "GET") {
        return new Response(
          JSON.stringify({
            timezone: "America/Sao_Paulo",
            rules: [
              {
                dayOfWeek: "MONDAY",
                startTime: "08:00",
                endTime: "12:00",
                slotDurationMinutes: 30,
              },
              {
                dayOfWeek: "TUESDAY",
                startTime: "09:00",
                endTime: "17:00",
                slotDurationMinutes: 45,
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (init?.method === "PUT") {
        capturedBody = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify({
            timezone: "America/Sao_Paulo",
            rules: (capturedBody as { rules: unknown[] }).rules,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("", { status: 404 });
    });

    const res = await deleteDayRulesAction("clinica-central", "MONDAY");

    expect(res.ok).toBe(true);
    const rules = (capturedBody as { rules: Array<{ dayOfWeek: string }> })
      .rules;
    expect(rules.length).toBe(1);
    expect(rules[0].dayOfWeek).toBe("TUESDAY");
  });

  test("deleteScheduleExceptionAction calls DELETE /schedule-exceptions/:id", async () => {
    let deleteMethod = "";

    globalThis.fetch = mock(async (_url, init) => {
      deleteMethod = init?.method ?? "";
      return new Response(JSON.stringify({ deleted: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const res = await deleteScheduleExceptionAction(
      "clinica-central",
      "exc-natal",
    );
    expect(res.ok).toBe(true);
    expect(deleteMethod).toBe("DELETE");
  });
});
