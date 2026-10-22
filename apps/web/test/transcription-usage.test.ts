import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockPush }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

let mockOrganizations: Array<{
  id: string;
  name: string;
  slug: string;
  role: "ADMIN" | "ADMIN_PROFESSIONAL" | "PROFESSIONAL" | "RECEPTIONIST";
}> | null = [
  { id: "org-1", name: "Clínica Teste", slug: "clinica-teste", role: "ADMIN" },
];

const { getTranscriptionUsage, UsageApiError } = await import(
  "../server/usage"
);

const {
  formatUsageDuration,
  formatMinutesExact,
  formatConsultationsCount,
  formatFailedAttemptsCount,
  calculateUsagePercentage,
  formatPercentage,
  formatMonthLabel,
  getRecentMonthOptions,
  resolveProfessionalSpecialty,
  EXPLANATORY_USAGE_NOTICE,
} = await import("../lib/usage");

const { UsageView } = await import(
  "../app/app/[orgSlug]/settings/usage/usage-view"
);

const { UsageSettingsForbidden, UsageSettingsError } = await import(
  "../app/app/[orgSlug]/settings/usage/usage-states"
);

const { default: UsageSettingsPage } = await import(
  "../app/app/[orgSlug]/settings/usage/page"
);

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
  mockPush.mockClear();
  mockOrganizations = [
    {
      id: "org-1",
      name: "Clínica Teste",
      slug: "clinica-teste",
      role: "ADMIN",
    },
  ];
  globalThis.fetch = (async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (
      urlStr.endsWith("/organizations") ||
      urlStr.includes("/organizations?")
    ) {
      return Response.json({ data: mockOrganizations });
    }
    return Response.json(sampleUsageResponse);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

const sampleUsageResponse = {
  month: "2026-10",
  timeZone: "America/Sao_Paulo",
  periodStart: "2026-10-01T03:00:00.000Z",
  periodEnd: "2026-11-01T03:00:00.000Z",
  processedSeconds: 8520, // 142 min
  processedMinutes: 142.0,
  successfulAudioCount: 38,
  transcribedConsultations: 38,
  failedAudioCount: 2,
  byProfessional: [
    {
      professionalId: "prof-1",
      professionalName: "Dra. Beatriz Cardiologista",
      specialty: "Cardiologia",
      processedSeconds: 5112, // 60%
      processedMinutes: 85.2,
      successfulAudioCount: 23,
    },
    {
      professionalId: "prof-2",
      professionalName: "Dr. Carlos Clínico",
      specialty: null,
      processedSeconds: 3408, // 40%
      processedMinutes: 56.8,
      successfulAudioCount: 15,
    },
  ],
};

describe("Transcription Usage - Server Layer (#312)", () => {
  test("getTranscriptionUsage throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(getTranscriptionUsage("clinica-teste")).rejects.toThrow(
      "Entre novamente para continuar.",
    );
  });

  test("getTranscriptionUsage calls GET /organizations/:orgSlug/settings/usage with bearer token and query month", async () => {
    let capturedUrl = "";
    let capturedAuth = "";

    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedUrl = String(url);
      capturedAuth =
        (init?.headers as Record<string, string>)?.Authorization || "";

      return new Response(JSON.stringify(sampleUsageResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await getTranscriptionUsage("clinica-teste", {
      month: "2026-10",
    });

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-teste/settings/usage?month=2026-10",
    );
    expect(capturedAuth).toBe("Bearer valid-session-jwt");
    expect(result.month).toBe("2026-10");
    expect(result.processedSeconds).toBe(8520);
    expect(result.transcribedConsultations).toBe(38);
    expect(result.failedAudioCount).toBe(2);
    expect(result.byProfessional.length).toBe(2);
  });

  test("getTranscriptionUsage handles 403 Forbidden properly", async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "FORBIDDEN",
            message: "Acesso restrito a administradores da clínica.",
          },
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    await expect(getTranscriptionUsage("clinica-teste")).rejects.toThrow(
      UsageApiError,
    );
  });

  test("getTranscriptionUsage handles 400 Validation Error properly", async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Mês inválido.",
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    await expect(
      getTranscriptionUsage("clinica-teste", { month: "invalid-month" }),
    ).rejects.toThrow("Mês inválido.");
  });

  test("getTranscriptionUsage handles 404 Not Found properly", async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: { code: "NOT_FOUND", message: "Clínica não encontrada." },
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    await expect(getTranscriptionUsage("non-existent")).rejects.toThrow(
      "Clínica não encontrada.",
    );
  });

  test("getTranscriptionUsage handles network failure with UNAVAILABLE", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Network offline");
    }) as typeof fetch;

    await expect(getTranscriptionUsage("clinica-teste")).rejects.toThrow(
      "Não foi possível carregar as métricas de consumo de transcrição. Tente novamente.",
    );
  });
});

describe("Usage Calculations & Utility Formatters (#312)", () => {
  test("formatUsageDuration formats seconds into canonical minutes or hours/minutes", () => {
    expect(formatUsageDuration(0)).toBe("0 min");
    expect(formatUsageDuration(-10)).toBe("0 min");
    expect(formatUsageDuration(2700)).toBe("45 min"); // 45m
    expect(formatUsageDuration(3600)).toBe("1h"); // 60m
    expect(formatUsageDuration(3660)).toBe("1h 1min"); // 61m
    expect(formatUsageDuration(8520)).toBe("2h 22min"); // 142m
  });

  test("formatMinutesExact formats minute floats with Brazilian decimal separator", () => {
    expect(formatMinutesExact(0)).toBe("0 min");
    expect(formatMinutesExact(10)).toBe("10 min");
    expect(formatMinutesExact(1.08)).toBe("1,08 min");
    expect(formatMinutesExact(142.5)).toBe("142,5 min");
  });

  test("formatConsultationsCount pluralizes properly in Portuguese", () => {
    expect(formatConsultationsCount(0)).toBe("0 consultas");
    expect(formatConsultationsCount(1)).toBe("1 consulta");
    expect(formatConsultationsCount(38)).toBe("38 consultas");
  });

  test("formatFailedAttemptsCount displays count and exempt guarantee label", () => {
    expect(formatFailedAttemptsCount(0)).toBe("0 falhas — sem cobrança");
    expect(formatFailedAttemptsCount(1)).toBe("1 falha — sem cobrança");
    expect(formatFailedAttemptsCount(2)).toBe("2 falhas — sem cobrança");
  });

  test("calculateUsagePercentage and formatPercentage compute and format proportion safely", () => {
    expect(calculateUsagePercentage(5112, 8520)).toBe(60);
    expect(calculateUsagePercentage(3408, 8520)).toBe(40);
    expect(calculateUsagePercentage(0, 8520)).toBe(0);
    expect(calculateUsagePercentage(100, 0)).toBe(0);
    expect(formatPercentage(60)).toBe("60,0%");
    expect(formatPercentage(40)).toBe("40,0%");
  });

  test("breakdown sum by doctor matches total clinic processed seconds", () => {
    const sumByProf = sampleUsageResponse.byProfessional.reduce(
      (sum, p) => sum + p.processedSeconds,
      0,
    );
    expect(sumByProf).toBe(sampleUsageResponse.processedSeconds);
  });

  test("formatMonthLabel formats YYYY-MM to Portuguese month name and year", () => {
    expect(formatMonthLabel("2026-10")).toBe("Outubro de 2026");
    expect(formatMonthLabel("2026-01")).toBe("Janeiro de 2026");
    expect(formatMonthLabel("2026-12")).toBe("Dezembro de 2026");
  });

  test("getRecentMonthOptions returns recent months array", () => {
    const options = getRecentMonthOptions(new Date("2026-10-17T12:00:00Z"), 6);
    expect(options.length).toBe(6);
    expect(options[0].value).toBe("2026-10");
    expect(options[0].label).toBe("Outubro de 2026");
    expect(options[1].value).toBe("2026-09");
  });

  test("resolveProfessionalSpecialty returns custom specialty, placeholder for unassigned, or default", () => {
    expect(
      resolveProfessionalSpecialty({
        professionalId: "p1",
        professionalName: "Dr. A",
        specialty: "Neurologia",
        processedSeconds: 10,
        processedMinutes: 0.17,
        successfulAudioCount: 1,
      }),
    ).toBe("Neurologia");

    expect(
      resolveProfessionalSpecialty({
        professionalId: "unassigned",
        professionalName: "Não atribuído",
        specialty: null,
        processedSeconds: 10,
        processedMinutes: 0.17,
        successfulAudioCount: 1,
      }),
    ).toBe("—");

    expect(
      resolveProfessionalSpecialty({
        professionalId: "p2",
        professionalName: "Dr. B",
        specialty: null,
        processedSeconds: 10,
        processedMinutes: 0.17,
        successfulAudioCount: 1,
      }),
    ).toBe("Profissional Clínico");
  });

  test("EXPLANATORY_USAGE_NOTICE matches product specification exactly", () => {
    expect(EXPLANATORY_USAGE_NOTICE).toBe(
      "O consumo é contabilizado pela soma dos segundos de áudio processados com sucesso divididos por 60. Falhas e interrupções técnicas são isentas de cobrança.",
    );
  });
});

describe("Client View Component (UsageView) (#312)", () => {
  test("UsageView renders header, subtitle, and month selector", () => {
    const html = renderToStaticMarkup(
      createElement(UsageView, {
        orgSlug: "clinica-teste",
        data: sampleUsageResponse,
      }),
    );

    expect(html).toContain("Consumo de Transcrições");
    expect(html).toContain(
      "Acompanhamento de minutos processados por inteligência artificial",
    );
    expect(html).toContain('data-slot="select-trigger"');
  });

  test("UsageView renders 3 KPI Summary Cards with exact metrics", () => {
    const html = renderToStaticMarkup(
      createElement(UsageView, {
        orgSlug: "clinica-teste",
        data: sampleUsageResponse,
      }),
    );

    // KPI 1: Minutos Totais
    expect(html).toContain("Minutos Totais");
    expect(html).toContain("2h 22min");

    // KPI 2: Consultas Transcritas
    expect(html).toContain("Consultas Transcritas");
    expect(html).toContain("38 consultas");

    // KPI 3: Falhas Isentas
    expect(html).toContain("Falhas Isentas");
    expect(html).toContain("2 falhas — sem cobrança");
  });

  test("Decision #197 / docs/METRICS_MVP compliance: NO cost in R$ is displayed anywhere", () => {
    const html = renderToStaticMarkup(
      createElement(UsageView, {
        orgSlug: "clinica-teste",
        data: sampleUsageResponse,
      }),
    );

    expect(html).not.toContain("R$");
    expect(html).not.toContain("BRL");
    expect(html).not.toContain("reais");
    expect(html).not.toContain("preço");
    expect(html).not.toContain("tarifa");
  });

  test("UsageView renders explanatory banner card and tooltip notice", () => {
    const html = renderToStaticMarkup(
      createElement(UsageView, {
        orgSlug: "clinica-teste",
        data: sampleUsageResponse,
      }),
    );

    expect(html).toContain(
      "O consumo é contabilizado pela soma dos segundos de áudio processados com sucesso divididos por 60. Falhas e interrupções técnicas são isentas de cobrança.",
    );
  });

  test("UsageView renders breakdown table with professional name, specialty, minutes, percentage, and consultations count", () => {
    const html = renderToStaticMarkup(
      createElement(UsageView, {
        orgSlug: "clinica-teste",
        data: sampleUsageResponse,
      }),
    );

    expect(html).toContain("Detalhamento por profissional");
    expect(html).toContain("Dra. Beatriz Cardiologista");
    expect(html).toContain("Cardiologia");
    expect(html).toContain("Dr. Carlos Clínico");
    expect(html).toContain("Profissional Clínico");
    expect(html).toContain("60,0%");
    expect(html).toContain("40,0%");
    expect(html).toContain("23 atendimentos");
    expect(html).toContain("15 atendimentos");
  });

  test("UsageView renders clean empty state when month has no audio processing", () => {
    const emptyResponse = {
      month: "2026-10",
      timeZone: "America/Sao_Paulo",
      periodStart: "2026-10-01T03:00:00.000Z",
      periodEnd: "2026-11-01T03:00:00.000Z",
      processedSeconds: 0,
      processedMinutes: 0,
      successfulAudioCount: 0,
      transcribedConsultations: 0,
      failedAudioCount: 0,
      byProfessional: [],
    };

    const html = renderToStaticMarkup(
      createElement(UsageView, {
        orgSlug: "clinica-teste",
        data: emptyResponse,
      }),
    );

    expect(html).toContain(
      "Nenhum processamento de áudio registrado neste período",
    );
    expect(html).toContain("0 min");
    expect(html).toContain("0 consultas");
    expect(html).toContain("0 falhas — sem cobrança");
  });
});

describe("Page Layer & Role Protection (#312)", () => {
  test("UsageSettingsForbidden renders 403 status and message for non-admin roles", () => {
    const html = renderToStaticMarkup(
      createElement(UsageSettingsForbidden, { orgSlug: "clinica-teste" }),
    );

    expect(html).toContain("403 — Acesso Restrito");
    expect(html).toContain("Acesso restrito a administradores da clínica");
    expect(html).toContain("/app/clinica-teste/dashboard");
  });

  test("UsageSettingsError renders error message with retry button", () => {
    const html = renderToStaticMarkup(
      createElement(UsageSettingsError, {
        orgSlug: "clinica-teste",
        errorMessage: "Falha de conexão com a API",
      }),
    );

    expect(html).toContain(
      "Não foi possível carregar o consumo de transcrições",
    );
    expect(html).toContain("Falha de conexão com a API");
    expect(html).toContain("Tentar novamente");
    expect(html).toContain("/app/clinica-teste/settings/usage");
  });

  test("UsageSettingsPage blocks unauthorized roles (PROFESSIONAL and RECEPTIONIST)", async () => {
    mockOrganizations = [
      {
        id: "org-1",
        name: "Clínica Teste",
        slug: "clinica-teste",
        role: "PROFESSIONAL",
      },
    ];

    const element = await UsageSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-teste" }),
    });

    const html = renderToStaticMarkup(element);
    expect(html).toContain("403 — Acesso Restrito");
    expect(html).toContain("Acesso restrito a administradores da clínica");

    // Test RECEPTIONIST role
    mockOrganizations = [
      {
        id: "org-1",
        name: "Clínica Teste",
        slug: "clinica-teste",
        role: "RECEPTIONIST",
      },
    ];

    const elementRecep = await UsageSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-teste" }),
    });
    const htmlRecep = renderToStaticMarkup(elementRecep);
    expect(htmlRecep).toContain("403 — Acesso Restrito");
  });

  test("UsageSettingsPage allows ADMIN and ADMIN_PROFESSIONAL roles", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (
        urlStr.endsWith("/organizations") ||
        urlStr.includes("/organizations?")
      ) {
        return Response.json({ data: mockOrganizations });
      }
      return new Response(JSON.stringify(sampleUsageResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    // Test ADMIN role
    mockOrganizations = [
      {
        id: "org-1",
        name: "Clínica Teste",
        slug: "clinica-teste",
        role: "ADMIN",
      },
    ];

    const elementAdmin = await UsageSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-teste" }),
      searchParams: Promise.resolve({ month: "2026-10" }),
    });
    const htmlAdmin = renderToStaticMarkup(elementAdmin);
    expect(htmlAdmin).toContain("Consumo de Transcrições");
    expect(htmlAdmin).toContain("2h 22min");

    // Test ADMIN_PROFESSIONAL role
    mockOrganizations = [
      {
        id: "org-1",
        name: "Clínica Teste",
        slug: "clinica-teste",
        role: "ADMIN_PROFESSIONAL",
      },
    ];

    const elementAdminProf = await UsageSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-teste" }),
      searchParams: Promise.resolve({ month: "2026-10" }),
    });
    const htmlAdminProf = renderToStaticMarkup(elementAdminProf);
    expect(htmlAdminProf).toContain("Consumo de Transcrições");
    expect(htmlAdminProf).toContain("2h 22min");
  });

  test("UsageSettingsPage handles API error by rendering UsageSettingsError", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (
        urlStr.endsWith("/organizations") ||
        urlStr.includes("/organizations?")
      ) {
        return Response.json({ data: mockOrganizations });
      }
      return new Response(
        JSON.stringify({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Falha interna no servidor",
          },
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as typeof fetch;

    mockOrganizations = [
      {
        id: "org-1",
        name: "Clínica Teste",
        slug: "clinica-teste",
        role: "ADMIN",
      },
    ];

    const element = await UsageSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-teste" }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain(
      "Não foi possível carregar o consumo de transcrições",
    );
    expect(html).toContain("Tentar novamente");
  });
});
