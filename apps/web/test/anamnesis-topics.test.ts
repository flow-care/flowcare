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

const {
  isMandatoryTopic,
  normalizeTopicKey,
  reorderTopics,
  mergeWithDefaultTopics,
  DEFAULT_ANAMNESIS_TOPICS,
  anamnesisTopicSchema,
  updateDoctorAnamnesisTopicsPayloadSchema,
} = await import("../lib/anamnesis-topics");

const {
  getDoctorAnamnesisTopics,
  updateDoctorAnamnesisTopics,
  AnamnesisTopicsApiError,
} = await import("../server/anamnesis-topics");

const { updateAnamnesisTopicsAction } = await import(
  "../app/app/[orgSlug]/settings/anamnesis/actions"
);

const { AnamnesisTopicsForm } = await import(
  "../app/app/[orgSlug]/settings/anamnesis/anamnesis-topics-form"
);

const {
  AnamnesisForbidden,
  AnamnesisError,
  default: AnamnesisSettingsPage,
} = await import("../app/app/[orgSlug]/settings/anamnesis/page");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
  mockPush.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

describe("Anamnesis Topics - Domain & Helpers (#311)", () => {
  test("isMandatoryTopic recognizes chief_complaint and conduct as strictly mandatory", () => {
    expect(isMandatoryTopic("chief_complaint")).toBe(true);
    expect(isMandatoryTopic("conduct")).toBe(true);
    expect(isMandatoryTopic("hda")).toBe(false);
    expect(isMandatoryTopic("antecedents")).toBe(false);
    expect(isMandatoryTopic("physical_exam")).toBe(false);
    expect(isMandatoryTopic("custom_vaccines")).toBe(false);
  });

  test("reorderTopics updates numerical order sequence correctly", () => {
    const initial = [
      { key: "t1", label: "Tópico 1", required: false, active: true, order: 0 },
      { key: "t2", label: "Tópico 2", required: false, active: true, order: 1 },
      { key: "t3", label: "Tópico 3", required: false, active: true, order: 2 },
    ];

    // Move index 2 (t3) to index 0
    const reordered = reorderTopics(initial, 2, 0);
    expect(reordered.map((t) => t.key)).toEqual(["t3", "t1", "t2"]);
    expect(reordered.map((t) => t.order)).toEqual([0, 1, 2]);

    // Out of bounds check
    expect(reorderTopics(initial, -1, 2)).toEqual(initial);
    expect(reorderTopics(initial, 0, 99)).toEqual(initial);
    expect(reorderTopics(initial, 1, 1)).toEqual(initial);
  });

  test("normalizeTopicKey generates valid snake_case keys for custom topics", () => {
    expect(normalizeTopicKey("Histórico Vacinal")).toBe("historico_vacinal");
    expect(normalizeTopicKey("Hábitos de Vida")).toBe("habitos_de_vida");
    expect(normalizeTopicKey("Exames Complementares")).toBe(
      "exames_complementares",
    );
    expect(normalizeTopicKey("  Alergias e Reações  ")).toBe(
      "alergias_e_reacoes",
    );
    // Non-letter starter receives topico_ prefix
    expect(normalizeTopicKey("123 Teste")).toMatch(/^topico_/);
  });

  test("mergeWithDefaultTopics preserves mandatory topics protection", () => {
    // Empty list receives all default topics with chief_complaint and conduct marked mandatory
    const mergedEmpty = mergeWithDefaultTopics([]);
    expect(mergedEmpty.length).toBe(5);
    expect(mergedEmpty.find((t) => t.key === "chief_complaint")?.required).toBe(
      true,
    );
    expect(mergedEmpty.find((t) => t.key === "conduct")?.required).toBe(true);

    // If an incoming list omitted conduct, mergeWithDefaultTopics restores it
    const missingConduct = [
      {
        key: "chief_complaint",
        label: "Queixa Principal",
        required: true,
        active: true,
        order: 0,
      },
      { key: "hda", label: "HDA", required: false, active: true, order: 1 },
    ];
    const restored = mergeWithDefaultTopics(missingConduct);
    expect(restored.some((t) => t.key === "conduct")).toBe(true);
    expect(restored.find((t) => t.key === "conduct")?.required).toBe(true);
  });

  test("anamnesisTopicSchema validates key pattern and limits", () => {
    const valid = anamnesisTopicSchema.safeParse({
      key: "historico_vacinal",
      label: "Histórico Vacinal",
      order: 0,
      active: true,
      required: false,
    });
    expect(valid.success).toBe(true);

    const invalidKey = anamnesisTopicSchema.safeParse({
      key: "123_invalid",
      label: "Inválido",
      order: 0,
    });
    expect(invalidKey.success).toBe(false);

    const emptyLabel = anamnesisTopicSchema.safeParse({
      key: "valido",
      label: "   ",
      order: 0,
    });
    expect(emptyLabel.success).toBe(false);

    const payloadResult = updateDoctorAnamnesisTopicsPayloadSchema.safeParse({
      version: 1,
      topics: [
        {
          key: "chief_complaint",
          label: "Queixa Principal",
          order: 0,
          active: true,
          required: true,
        },
      ],
    });
    expect(payloadResult.success).toBe(true);
  });
});

describe("Anamnesis Topics - Server Layer (#311)", () => {
  test("getDoctorAnamnesisTopics calls GET endpoint and returns topics with defaults", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return Response.json({
        professionalId: "prof-123",
        version: 1,
        revisionId: "rev-1",
        topics: [
          {
            key: "chief_complaint",
            label: "Queixa Principal",
            active: true,
            required: true,
            order: 0,
          },
          {
            key: "conduct",
            label: "Conduta",
            active: true,
            required: true,
            order: 1,
          },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await getDoctorAnamnesisTopics("clinica-vida", "prof-123");

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-vida/professionals/prof-123/anamnesis-topics",
    );
    expect(capturedHeaders.Authorization).toBe("Bearer valid-session-jwt");
    expect(result.professionalId).toBe("prof-123");
    expect(result.version).toBe(1);
    expect(result.topics.some((t) => t.key === "chief_complaint")).toBe(true);
  });

  test("getDoctorAnamnesisTopics handles 401 UNAUTHENTICATED error", async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ error: { code: "UNAUTHENTICATED" } }),
        {
          status: 401,
        },
      );
    }) as unknown as typeof fetch;

    await expect(
      getDoctorAnamnesisTopics("clinica-vida", "prof-123"),
    ).rejects.toThrow(AnamnesisTopicsApiError);
  });

  test("updateDoctorAnamnesisTopics blocks removal or deactivation of mandatory topics", async () => {
    // Missing chief_complaint
    await expect(
      updateDoctorAnamnesisTopics("clinica-vida", "prof-123", {
        version: 1,
        topics: [
          {
            key: "conduct",
            label: "Conduta",
            active: true,
            order: 0,
          },
        ],
      }),
    ).rejects.toThrow("Queixa Principal");

    // Deactivated conduct
    await expect(
      updateDoctorAnamnesisTopics("clinica-vida", "prof-123", {
        version: 1,
        topics: [
          {
            key: "chief_complaint",
            label: "Queixa Principal",
            active: true,
            order: 0,
          },
          {
            key: "conduct",
            label: "Conduta",
            active: false,
            order: 1,
          },
        ],
      }),
    ).rejects.toThrow("Conduta");
  });

  test("updateDoctorAnamnesisTopics sends valid payload to PUT endpoint", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = init?.body as string;
      return Response.json({
        professionalId: "prof-123",
        version: 2,
        revisionId: "rev-2",
        topics: [
          {
            key: "chief_complaint",
            label: "Queixa Principal",
            active: true,
            required: true,
            order: 0,
          },
          {
            key: "antecedents",
            label: "Antecedentes",
            active: true,
            required: false,
            order: 1,
          },
          {
            key: "conduct",
            label: "Conduta",
            active: true,
            required: true,
            order: 2,
          },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await updateDoctorAnamnesisTopics(
      "clinica-vida",
      "prof-123",
      {
        version: 1,
        topics: [
          {
            key: "chief_complaint",
            label: "Queixa Principal",
            active: true,
            order: 0,
          },
          {
            key: "antecedents",
            label: "Antecedentes",
            active: true,
            order: 1,
          },
          {
            key: "conduct",
            label: "Conduta",
            active: true,
            order: 2,
          },
        ],
      },
    );

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-vida/professionals/prof-123/anamnesis-topics",
    );
    const parsedBody = JSON.parse(capturedBody);
    expect(parsedBody.version).toBe(1);
    expect(parsedBody.topics.map((t: { key: string }) => t.key)).toEqual([
      "chief_complaint",
      "antecedents",
      "conduct",
    ]);
    expect(result.version).toBe(2);
  });

  test("updateAnamnesisTopicsAction executes server action safely", async () => {
    globalThis.fetch = (async () => {
      return Response.json({
        professionalId: "prof-123",
        version: 2,
        revisionId: "rev-2",
        topics: [
          {
            key: "chief_complaint",
            label: "Queixa Principal",
            active: true,
            required: true,
            order: 0,
          },
          {
            key: "conduct",
            label: "Conduta",
            active: true,
            required: true,
            order: 1,
          },
        ],
      });
    }) as unknown as typeof fetch;

    const actionResult = await updateAnamnesisTopicsAction(
      "clinica-vida",
      "prof-123",
      {
        version: 1,
        topics: [
          {
            key: "chief_complaint",
            label: "Queixa Principal",
            active: true,
            order: 0,
          },
          {
            key: "conduct",
            label: "Conduta",
            active: true,
            order: 1,
          },
        ],
      },
    );

    expect(actionResult.ok).toBe(true);
    if (actionResult.ok) {
      expect(actionResult.data.version).toBe(2);
    }
  });
});

describe("Anamnesis Topics - Form UI Component (#311)", () => {
  const sampleProfessionals = [
    {
      id: "mem-1",
      userId: "doc-1",
      name: "Dr. Roberto Silva",
      email: "roberto@clinica.com",
      role: "PROFESSIONAL",
    },
    {
      id: "mem-2",
      userId: "doc-2",
      name: "Dra. Ana Santos",
      email: "ana@clinica.com",
      role: "ADMIN_PROFESSIONAL",
    },
  ];

  test("renders AI guidance informational callout on future consultations notice", () => {
    const html = renderToStaticMarkup(
      createElement(AnamnesisTopicsForm, {
        orgSlug: "clinica-vida",
        professionals: sampleProfessionals,
        selectedProfessionalId: "doc-1",
        initialTopics: DEFAULT_ANAMNESIS_TOPICS,
        initialVersion: 1,
        currentUserId: "doc-1",
        currentUserRole: "PROFESSIONAL",
      }),
    );

    expect(html).toContain("Configuração assistida por IA");
    expect(html).toContain(
      "A estrutura configurada orienta as sugestões geradas por IA para este médico. Atendimentos já aprovados permanecem inalterados.",
    );
  });

  test("renders professional selector and doctor names", () => {
    const html = renderToStaticMarkup(
      createElement(AnamnesisTopicsForm, {
        orgSlug: "clinica-vida",
        professionals: sampleProfessionals,
        selectedProfessionalId: "doc-1",
        initialTopics: DEFAULT_ANAMNESIS_TOPICS,
        initialVersion: 1,
        currentUserId: "doc-1",
        currentUserRole: "PROFESSIONAL",
      }),
    );

    expect(html).toContain("Profissional Médico");
    expect(html).toContain("Dr. Roberto Silva");
  });

  test("renders mandatory topic lock badges and prevents removal", () => {
    const html = renderToStaticMarkup(
      createElement(AnamnesisTopicsForm, {
        orgSlug: "clinica-vida",
        professionals: sampleProfessionals,
        selectedProfessionalId: "doc-1",
        initialTopics: DEFAULT_ANAMNESIS_TOPICS,
        initialVersion: 1,
        currentUserId: "doc-1",
        currentUserRole: "PROFESSIONAL",
      }),
    );

    // Mandatory badges
    expect(html).toContain("Queixa Principal");
    expect(html).toContain("Conduta e Hipótese Diagnóstica");
    expect(html).toContain("Obrigatório");

    // Order numbers 1 to 5 rendered
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
    expect(html).toContain(">3<");
    expect(html).toContain(">4<");
    expect(html).toContain(">5<");

    // Buttons
    expect(html).toContain("Adicionar tópico customizado");
    expect(html).toContain("Salvar Estrutura");
  });
});

describe("Anamnesis Topics - Page & Access Control (#311)", () => {
  test("AnamnesisForbidden renders 403 message for unauthorized roles (e.g. RECEPTIONIST)", () => {
    const html = renderToStaticMarkup(
      createElement(AnamnesisForbidden, {
        orgSlug: "clinica-vida",
      }),
    );

    expect(html).toContain("403 — Acesso Restrito");
    expect(html).toContain(
      "Acesso restrito a profissionais clínicos e administradores",
    );
    expect(html).toContain("Voltar ao Dashboard");
  });

  test("AnamnesisError renders retry button and error feedback", () => {
    const html = renderToStaticMarkup(
      createElement(AnamnesisError, {
        orgSlug: "clinica-vida",
        errorMessage: "Falha de conexão com a API de anamnese",
      }),
    );

    expect(html).toContain(
      "Não foi possível carregar as preferências de anamnese",
    );
    expect(html).toContain("Falha de conexão com a API de anamnese");
    expect(html).toContain("Tentar novamente");
  });

  test("AnamnesisSettingsPage blocks RECEPTIONIST with 403", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/organizations") || url.includes("/organizations?")) {
        return Response.json({
          data: [
            {
              id: "org-1",
              name: "Clínica Vida",
              slug: "clinica-vida",
              role: "RECEPTIONIST",
            },
          ],
        });
      }
      if (url.endsWith("/me/profile")) {
        return Response.json({
          id: "user-rec",
          email: "rec@clinica.com",
          fullName: "Recepção",
        });
      }
      return Response.json({});
    }) as unknown as typeof fetch;

    const pageElement = await AnamnesisSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-vida" }),
    });

    const html = renderToStaticMarkup(pageElement);
    expect(html).toContain("403 — Acesso Restrito");
    expect(html).toContain(
      "Acesso restrito a profissionais clínicos e administradores",
    );
  });

  test("AnamnesisSettingsPage loads for clinical role (PROFESSIONAL)", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/organizations") || url.includes("/organizations?")) {
        return Response.json({
          data: [
            {
              id: "org-1",
              name: "Clínica Vida",
              slug: "clinica-vida",
              role: "PROFESSIONAL",
            },
          ],
        });
      }
      if (url.endsWith("/me/profile")) {
        return Response.json({
          id: "user-doc",
          email: "doc@clinica.com",
          fullName: "Dr. André Médico",
        });
      }
      if (url.includes("/members")) {
        return Response.json({
          data: [
            {
              id: "mem-1",
              userId: "user-doc",
              userName: "Dr. André Médico",
              email: "doc@clinica.com",
              role: "PROFESSIONAL",
              status: "ACTIVE",
            },
          ],
        });
      }
      if (url.includes("/anamnesis-topics")) {
        return Response.json({
          professionalId: "user-doc",
          version: 1,
          revisionId: "rev-1",
          topics: [
            {
              key: "chief_complaint",
              label: "Queixa Principal",
              active: true,
              required: true,
              order: 0,
            },
            {
              key: "conduct",
              label: "Conduta",
              active: true,
              required: true,
              order: 1,
            },
          ],
        });
      }
      return Response.json({});
    }) as unknown as typeof fetch;

    const pageElement = await AnamnesisSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-vida" }),
    });

    const html = renderToStaticMarkup(pageElement);
    expect(html).toContain("Tópicos de Anamnese por Médico");
    expect(html).toContain("Configure a ordem e os tópicos clínicos");
    expect(html).toContain("Dr. André Médico");
  });
});
