import { afterEach, beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let mockToken: string | null = "test-jwt-token";

mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) => (mockToken ? { value: mockToken } : undefined),
  }),
}));

const {
  DashboardApiError,
  dashboardMetricsResponseSchema,
  getDashboardMetrics,
} = await import("../server/dashboard");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockToken = "test-jwt-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

const validMetricsPayload = {
  periodStart: "2026-10-14T03:00:00.000Z",
  periodEnd: "2026-10-15T03:00:00.000Z",
  timeZone: "America/Sao_Paulo",
  totalAppointments: 10,
  scheduledAppointments: 2,
  completedAppointments: 5,
  cancelledAppointments: 2,
  noShowAppointments: 1,
  noShowRate: 0.1667,
};

test("dashboardMetricsResponseSchema valida payload completo e noShowRate nulo", () => {
  const result = dashboardMetricsResponseSchema.safeParse(validMetricsPayload);
  expect(result.success).toBe(true);

  const withNullRate = {
    ...validMetricsPayload,
    totalAppointments: 0,
    scheduledAppointments: 0,
    completedAppointments: 0,
    cancelledAppointments: 0,
    noShowAppointments: 0,
    noShowRate: null,
  };
  const nullResult = dashboardMetricsResponseSchema.safeParse(withNullRate);
  expect(nullResult.success).toBe(true);

  const invalid = { ...validMetricsPayload, totalAppointments: "dez" };
  expect(dashboardMetricsResponseSchema.safeParse(invalid).success).toBe(false);
});

test("getDashboardMetrics busca endpoint padrão com period=today", async () => {
  let calledUrl = "";
  let authHeader = "";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calledUrl = String(input);
    authHeader = String(
      (init?.headers as Record<string, string>)?.Authorization,
    );
    return Response.json(validMetricsPayload, { status: 200 });
  }) as unknown as typeof fetch;

  const data = await getDashboardMetrics("clinica-modelo");
  expect(calledUrl).toBe(
    "http://api.test/api/organizations/clinica-modelo/dashboard/metrics?period=today",
  );
  expect(authHeader).toBe("Bearer test-jwt-token");
  expect(data.totalAppointments).toBe(10);
  expect(data.noShowRate).toBe(0.1667);
});

test("getDashboardMetrics repassa period=week e period=month", async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json(validMetricsPayload, { status: 200 });
  }) as unknown as typeof fetch;

  await getDashboardMetrics("clinica-modelo", "week");
  await getDashboardMetrics("clinica-modelo", "month");

  expect(urls[0]).toBe(
    "http://api.test/api/organizations/clinica-modelo/dashboard/metrics?period=week",
  );
  expect(urls[1]).toBe(
    "http://api.test/api/organizations/clinica-modelo/dashboard/metrics?period=month",
  );
});

test("getDashboardMetrics lança DashboardApiError se sessão ausente", async () => {
  mockToken = null;

  try {
    await getDashboardMetrics("clinica-modelo");
    expect.unreachable("Deveria ter falhado por falta de sessão");
  } catch (error) {
    expect(error).toBeInstanceOf(DashboardApiError);
    expect((error as InstanceType<typeof DashboardApiError>).code).toBe(
      "UNAUTHENTICATED",
    );
  }
});

test("getDashboardMetrics mapeia respostas de erro HTTP 401 e 404", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { error: "Unauthorized" },
      { status: 401 },
    )) as unknown as typeof fetch;

  await expect(getDashboardMetrics("clinica-modelo")).rejects.toThrow(
    "Entre novamente para continuar.",
  );

  globalThis.fetch = (async () =>
    Response.json(
      { error: "Not found" },
      { status: 404 },
    )) as unknown as typeof fetch;

  await expect(getDashboardMetrics("clinica-sem-acesso")).rejects.toThrow(
    "Você não tem permissão para acessar os dados desta clínica.",
  );
});

test("getDashboardMetrics rejeita resposta inválida do servidor", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { resposta: "invalida" },
      { status: 200 },
    )) as unknown as typeof fetch;

  await expect(getDashboardMetrics("clinica-modelo")).rejects.toThrow(
    "Resposta inválida do servidor ao carregar indicadores.",
  );
});
