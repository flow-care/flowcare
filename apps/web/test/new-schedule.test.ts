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

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  useSearchParams: () => new URLSearchParams("sheet=new"),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const { validateWeeklyRule, checkNewRuleConflict, validateExceptionInput } =
  await import("../lib/schedules");

const { replaceWeeklySchedule, createScheduleException } = await import(
  "../server/schedules"
);

const { NewScheduleForm } = await import(
  "../app/app/[orgSlug]/settings/schedules/new-schedule-sheet"
);

describe("lib/schedules validations (#309)", () => {
  test("validateWeeklyRule blocks start >= end and invalid slot durations", () => {
    // end before start
    const invalidTimes = validateWeeklyRule({
      dayOfWeek: "MONDAY",
      startTime: "18:00",
      endTime: "08:00",
      slotDurationMinutes: 30,
    });
    expect(invalidTimes.valid).toBe(false);
    expect(invalidTimes.error).toContain("posterior ao horário de início");

    // end equals start
    const equalTimes = validateWeeklyRule({
      dayOfWeek: "MONDAY",
      startTime: "10:00",
      endTime: "10:00",
      slotDurationMinutes: 30,
    });
    expect(equalTimes.valid).toBe(false);

    // slot duration > interval
    const durationTooLong = validateWeeklyRule({
      dayOfWeek: "MONDAY",
      startTime: "08:00",
      endTime: "08:30",
      slotDurationMinutes: 60,
    });
    expect(durationTooLong.valid).toBe(false);
    expect(durationTooLong.error).toContain("não pode ser maior");

    // valid
    const valid = validateWeeklyRule({
      dayOfWeek: "TUESDAY",
      startTime: "08:00",
      endTime: "12:00",
      slotDurationMinutes: 30,
    });
    expect(valid.valid).toBe(true);
  });

  test("checkNewRuleConflict detects overlapping rules on the same day", () => {
    const existingRules = [
      {
        dayOfWeek: "TUESDAY" as const,
        startTime: "08:00",
        endTime: "12:00",
        slotDurationMinutes: 30,
      },
      {
        dayOfWeek: "TUESDAY" as const,
        startTime: "13:00",
        endTime: "18:00",
        slotDurationMinutes: 30,
      },
    ];

    // Overlaps morning rule (10:00 - 14:00 overlaps 08:00 - 12:00 and 13:00 - 18:00)
    expect(
      checkNewRuleConflict(existingRules, {
        dayOfWeek: "TUESDAY",
        startTime: "10:00",
        endTime: "14:00",
        slotDurationMinutes: 30,
      }),
    ).toBe(true);

    // Overlaps inside morning rule (09:00 - 11:00)
    expect(
      checkNewRuleConflict(existingRules, {
        dayOfWeek: "TUESDAY",
        startTime: "09:00",
        endTime: "11:00",
        slotDurationMinutes: 20,
      }),
    ).toBe(true);

    // Non-overlapping (12:00 - 13:00)
    expect(
      checkNewRuleConflict(existingRules, {
        dayOfWeek: "TUESDAY",
        startTime: "12:00",
        endTime: "13:00",
        slotDurationMinutes: 30,
      }),
    ).toBe(false);

    // Same time on different day (MONDAY 08:00 - 12:00)
    expect(
      checkNewRuleConflict(existingRules, {
        dayOfWeek: "MONDAY",
        startTime: "08:00",
        endTime: "12:00",
        slotDurationMinutes: 30,
      }),
    ).toBe(false);
  });

  test("validateExceptionInput validates date range", () => {
    expect(
      validateExceptionInput({
        startsAt: "2026-12-25T18:00",
        endsAt: "2026-12-25T08:00",
      }).valid,
    ).toBe(false);

    expect(
      validateExceptionInput({
        startsAt: "2026-12-25T08:00",
        endsAt: "2026-12-25T18:00",
      }).valid,
    ).toBe(true);
  });
});

describe("server/schedules mutations (#309)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockSessionToken = "valid-session-jwt";
  });

  test("replaceWeeklySchedule PUTs rules and returns updated schedule", async () => {
    globalThis.fetch = mock(async (_url, init) => {
      expect(init?.method).toBe("PUT");
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
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const res = await replaceWeeklySchedule("clinica-vida", [
      {
        dayOfWeek: "MONDAY",
        startTime: "08:00",
        endTime: "12:00",
        slotDurationMinutes: 30,
      },
    ]);

    expect(res.timezone).toBe("America/Sao_Paulo");
    expect(res.rules.length).toBe(1);
  });

  test("createScheduleException POSTs exception and returns created item", async () => {
    globalThis.fetch = mock(async (_url, init) => {
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify({
          exception: {
            id: "exc-123",
            professionalId: null,
            startsAt: "2026-12-25T00:00:00.000Z",
            endsAt: "2026-12-25T23:59:00.000Z",
            timezone: "America/Sao_Paulo",
            reason: "Natal",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });

    const res = await createScheduleException("clinica-vida", {
      professionalId: null,
      startsAt: "2026-12-25T00:00:00.000Z",
      endsAt: "2026-12-25T23:59:00.000Z",
      reason: "Natal",
    });

    expect(res.id).toBe("exc-123");
    expect(res.reason).toBe("Natal");
  });
});

describe("NewScheduleSheet UI (#309)", () => {
  const dummyWeeklySchedule = {
    timezone: "America/Sao_Paulo",
    rules: [
      {
        dayOfWeek: "MONDAY" as const,
        startTime: "08:00",
        endTime: "12:00",
        slotDurationMinutes: 30,
      },
    ],
  };

  test("renders NewScheduleForm with tabs for weekly rule and exception", () => {
    const html = renderToStaticMarkup(
      createElement(NewScheduleForm, {
        orgSlug: "clinica-vida",
        onClose: () => {},
        weeklySchedule: dummyWeeklySchedule,
        professionals: [{ id: "prof-1", name: "Dr. Roberto" }],
      }),
    );

    expect(html).toContain("Novo Horário ou Bloqueio");
    expect(html).toContain("Horário Recorrente");
    expect(html).toContain("Bloqueio Pontual");
    expect(html).toContain("Dia da semana");
    expect(html).toContain("Início do expediente");
    expect(html).toContain("Término do expediente");
    expect(html).toContain("Duração padrão por consulta");
    expect(html).toContain("Cadastrar horário");
  });

  test("displays conflict alert when new rule overlaps existing rule on same day", () => {
    const html = renderToStaticMarkup(
      createElement(NewScheduleForm, {
        orgSlug: "clinica-vida",
        onClose: () => {},
        weeklySchedule: dummyWeeklySchedule, // Monday 08:00 - 12:00
        professionals: [],
        initialDay: "MONDAY",
        initialStartTime: "08:00",
        initialEndTime: "12:00",
      }),
    );

    expect(html).toContain("Conflito de horário detectado");
    expect(html).toContain("Já existe um intervalo de atendimento ativo");
  });

  test("does not display conflict alert when new rule has no overlap", () => {
    const html = renderToStaticMarkup(
      createElement(NewScheduleForm, {
        orgSlug: "clinica-vida",
        onClose: () => {},
        weeklySchedule: dummyWeeklySchedule, // Monday 08:00 - 12:00
        professionals: [],
        initialDay: "MONDAY",
        initialStartTime: "13:00",
        initialEndTime: "18:00",
      }),
    );

    expect(html).not.toContain("Conflito de horário detectado");
  });
});
