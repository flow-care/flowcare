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
}> = [
  {
    id: "org-1",
    name: "Clínica Vida",
    slug: "clinica-vida",
    role: "ADMIN",
  },
];

const { getOrganizationRoles, RolesApiError } = await import("../server/roles");

const {
  MVP_ROLES,
  MVP_ROLE_DEFINITIONS,
  formatMemberCount,
  getMvpRoleCards,
  organizationRolesResponseSchema,
} = await import("../lib/roles");

const { RolesView } = await import(
  "../app/app/[orgSlug]/settings/roles/roles-view"
);

const {
  RolesSettingsForbidden,
  RolesSettingsError,
  default: RolesSettingsPage,
} = await import("../app/app/[orgSlug]/settings/roles/page");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
  mockPush.mockClear();
  mockOrganizations = [
    {
      id: "org-1",
      name: "Clínica Vida",
      slug: "clinica-vida",
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
    return Response.json(sampleRolesResponse);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

const sampleRolesResponse = {
  systemRoles: [
    {
      role: "ADMIN",
      name: "Administrador",
      description: "Gerencia clínica, equipe, agenda, operação e consumo.",
      capabilities: [
        "organizations:read",
        "patients:read",
        "patients:write",
        "team:read",
        "team:manage",
        "roles:read",
        "audit:read",
      ],
      memberCount: 3,
      isSystem: true as const,
    },
    {
      role: "ADMIN_PROFESSIONAL",
      name: "Administrador e Profissional",
      description: "Reúne administração e atuação clínica na clínica.",
      capabilities: [
        "organizations:read",
        "patients:read",
        "consultations:read",
        "consultations:write",
        "documents:issue",
        "team:manage",
        "roles:read",
      ],
      memberCount: 1,
      isSystem: true as const,
    },
    {
      role: "PROFESSIONAL",
      name: "Profissional de Saúde",
      description: "Atua em atendimentos, prontuários e documentos clínicos.",
      capabilities: [
        "organizations:read",
        "patients:read",
        "consultations:read",
        "consultations:write",
        "documents:issue",
      ],
      memberCount: 5,
      isSystem: true as const,
    },
    {
      role: "RECEPTIONIST",
      name: "Recepcionista",
      description:
        "Cuida do cadastro de pacientes, agenda, fila e mensagens logísticas.",
      capabilities: [
        "organizations:read",
        "patients:read",
        "patients:write",
        "appointments:read",
        "appointments:write",
        "reception:read",
        "reception:write",
      ],
      memberCount: 2,
      isSystem: true as const,
    },
  ],
  customRoles: [],
  roles: [],
  data: [],
};

describe("Roles List & Matrix (#324) - Server Layer", () => {
  test("getOrganizationRoles throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(getOrganizationRoles("clinica-vida")).rejects.toThrow(RolesApiError);
  });

  test("getOrganizationRoles fetches GET /organizations/:orgSlug/roles with auth header", async () => {
    let capturedUrl = "";
    let capturedAuth = "";

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization;
      return Response.json(sampleRolesResponse);
    }) as unknown as typeof fetch;

    const data = await getOrganizationRoles("clinica-vida");
    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-vida/roles",
    );
    expect(capturedAuth).toBe("Bearer valid-session-jwt");
    expect(data.systemRoles).toHaveLength(4);
    expect(data.systemRoles[0].role).toBe("ADMIN");
    expect(data.systemRoles[0].memberCount).toBe(3);
  });

  test("getOrganizationRoles handles 403 Forbidden with clean error", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Acesso restrito a administradores.",
          },
        },
        { status: 403 },
      );
    }) as unknown as typeof fetch;

    await expect(getOrganizationRoles("clinica-vida")).rejects.toMatchObject({
      name: "RolesApiError",
      code: "FORBIDDEN",
    });
  });

  test("getOrganizationRoles handles 404 Not Found", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Clínica não encontrada." } },
        { status: 404 },
      );
    }) as unknown as typeof fetch;

    await expect(getOrganizationRoles("clinica-vida")).rejects.toMatchObject({
      name: "RolesApiError",
      code: "NOT_FOUND",
    });
  });

  test("getOrganizationRoles handles network failure gracefully", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Connection refused");
    }) as unknown as typeof fetch;

    await expect(getOrganizationRoles("clinica-vida")).rejects.toMatchObject({
      name: "RolesApiError",
      code: "UNAVAILABLE",
    });
  });
});

describe("Roles List & Matrix (#324) - Role Protection & RBAC (403)", () => {
  test("RolesSettingsForbidden renders 403 access restricted view", () => {
    const html = renderToStaticMarkup(
      createElement(RolesSettingsForbidden, { orgSlug: "clinica-vida" }),
    );

    expect(html).toContain("403 — Acesso Restrito");
    expect(html).toContain("Acesso restrito a administradores da clínica");
    expect(html).toContain("Voltar ao Dashboard");
    expect(html).toContain("/app/clinica-vida/dashboard");
  });

  test("Non-admin roles (PROFESSIONAL, RECEPTIONIST) see 403 restricted page", async () => {
    for (const nonAdminRole of ["PROFESSIONAL", "RECEPTIONIST"] as const) {
      mockOrganizations = [
        {
          id: "org-1",
          name: "Clínica Vida",
          slug: "clinica-vida",
          role: nonAdminRole,
        },
      ];

      const pageElement = await RolesSettingsPage({
        params: Promise.resolve({ orgSlug: "clinica-vida" }),
      });
      const html = renderToStaticMarkup(pageElement);

      expect(html).toContain("403 — Acesso Restrito");
      expect(html).toContain("Acesso restrito a administradores da clínica");
    }
  });

  test("ADMIN and ADMIN_PROFESSIONAL are authorized and can access", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (
        urlStr.endsWith("/organizations") ||
        urlStr.includes("/organizations?")
      ) {
        return Response.json({ data: mockOrganizations });
      }
      return Response.json(sampleRolesResponse);
    }) as unknown as typeof fetch;

    for (const adminRole of ["ADMIN", "ADMIN_PROFESSIONAL"] as const) {
      mockOrganizations = [
        {
          id: "org-1",
          name: "Clínica Vida",
          slug: "clinica-vida",
          role: adminRole,
        },
      ];

      const pageElement = await RolesSettingsPage({
        params: Promise.resolve({ orgSlug: "clinica-vida" }),
      });
      const html = renderToStaticMarkup(pageElement);

      expect(html).not.toContain("403 — Acesso Restrito");
      expect(html).toContain("Papéis de Acesso");
    }
  });

  test("RolesSettingsPage falls back to 403 when API returns FORBIDDEN", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (
        urlStr.endsWith("/organizations") ||
        urlStr.includes("/organizations?")
      ) {
        return Response.json({ data: mockOrganizations });
      }
      return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
    }) as unknown as typeof fetch;

    const pageElement = await RolesSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-vida" }),
    });
    const html = renderToStaticMarkup(pageElement);

    expect(html).toContain("403 — Acesso Restrito");
    expect(html).toContain("Acesso restrito a administradores da clínica");
  });
});

describe("Roles List & Matrix (#324) - 4 MVP Roles Presence & Definitions", () => {
  test("MVP_ROLES constant defines all 4 official MVP roles in correct order", () => {
    expect(MVP_ROLES).toEqual([
      "ADMIN",
      "ADMIN_PROFESSIONAL",
      "PROFESSIONAL",
      "RECEPTIONIST",
    ]);
  });

  test("MVP_ROLE_DEFINITIONS has configurations for all MVP roles", () => {
    for (const role of MVP_ROLES) {
      expect(MVP_ROLE_DEFINITIONS[role]).toBeDefined();
      expect(MVP_ROLE_DEFINITIONS[role].title.length).toBeGreaterThan(0);
      expect(
        MVP_ROLE_DEFINITIONS[role].groupedCapabilities.length,
      ).toBeGreaterThan(0);
    }
  });

  test("organizationRolesResponseSchema parses and normalizes roles data", () => {
    const parsed = organizationRolesResponseSchema.parse(sampleRolesResponse);
    expect(parsed.systemRoles).toHaveLength(4);
    expect(parsed.customRoles).toEqual([]);
  });

  test("Renders header with title and subtitle", () => {
    const html = renderToStaticMarkup(
      createElement(RolesView, {
        orgSlug: "clinica-vida",
        rolesData: sampleRolesResponse,
      }),
    );

    expect(html).toContain("Papéis de Acesso");
    expect(html).toContain(
      "Matriz de permissões e perfis de acesso da clínica",
    );
  });

  test("Renders compliance callout notice for fixed MVP roles (#325)", () => {
    const html = renderToStaticMarkup(
      createElement(RolesView, {
        orgSlug: "clinica-vida",
        rolesData: sampleRolesResponse,
      }),
    );

    expect(html).toContain(
      "Os papéis de acesso são fixos no MVP conforme diretrizes de conformidade. A customização de papéis personalizados estará disponível em breve (#325).",
    );
  });

  test("Renders all 4 official MVP roles with exact titles and product descriptions", () => {
    const html = renderToStaticMarkup(
      createElement(RolesView, {
        orgSlug: "clinica-vida",
        rolesData: sampleRolesResponse,
      }),
    );

    // 1. ADMIN ("Administrador Geral")
    expect(html).toContain("Administrador Geral");
    expect(html).toContain(
      "Gestão completa da clínica, equipe, configurações institucionais, LGPD e trilha de auditoria.",
    );

    // 2. ADMIN_PROFESSIONAL ("Administrador e Médico")
    expect(html).toContain("Administrador e Médico");
    expect(html).toContain(
      "Gestão administrativa plena + atendimento clínico, gravação de anamnese e emissão de documentos.",
    );

    // 3. PROFESSIONAL ("Profissional Clínico")
    expect(html).toContain("Profissional Clínico");
    expect(html).toContain(
      "Atendimentos, gravação e revisão de anamnese, emissão de receitas, atestados e laudos, acesso ao prontuário.",
    );

    // 4. RECEPTIONIST ("Recepcionista")
    expect(html).toContain("Recepcionista");
    expect(html).toContain(
      "Gestão da agenda de consultas, fila de recepção, confirmação manual e cadastro de pacientes.",
    );
  });

  test("Renders distinct color styling badges for all 4 roles", () => {
    const html = renderToStaticMarkup(
      createElement(RolesView, {
        orgSlug: "clinica-vida",
        rolesData: sampleRolesResponse,
      }),
    );

    expect(html).toContain("text-indigo-700");
    expect(html).toContain("text-blue-700");
    expect(html).toContain("text-emerald-700");
    expect(html).toContain("text-amber-700");
  });
});

describe("Roles List & Matrix (#324) - Member Counts & Organization Isolation", () => {
  test("formatMemberCount formats singular and plural counts accurately", () => {
    expect(formatMemberCount(1)).toBe("1 membro ativo");
    expect(formatMemberCount(0)).toBe("0 membros ativos");
    expect(formatMemberCount(3)).toBe("3 membros ativos");
    expect(formatMemberCount(12)).toBe("12 membros ativos");
  });

  test("Displays member count badges corresponding to active organization data", () => {
    const html = renderToStaticMarkup(
      createElement(RolesView, {
        orgSlug: "clinica-vida",
        rolesData: sampleRolesResponse,
      }),
    );

    expect(html).toContain("3 membros ativos");
    expect(html).toContain("1 membro ativo");
    expect(html).toContain("5 membros ativos");
    expect(html).toContain("2 membros ativos");
  });

  test("Defaults to 0 membros ativos when role has no active members", () => {
    const emptyRolesData = {
      systemRoles: [
        {
          role: "ADMIN",
          name: "Administrador",
          description: "Desc",
          capabilities: [],
          memberCount: 0,
          isSystem: true as const,
        },
      ],
      customRoles: [],
      roles: [],
      data: [],
    };

    const cards = getMvpRoleCards(emptyRolesData);
    const receptionistCard = cards.find((c) => c.role === "RECEPTIONIST");
    expect(receptionistCard?.memberCount).toBe(0);

    const html = renderToStaticMarkup(
      createElement(RolesView, {
        orgSlug: "clinica-vida",
        rolesData: emptyRolesData,
      }),
    );

    expect(html).toContain("0 membros ativos");
  });
});

describe("Roles List & Matrix (#324) - Capabilities Display", () => {
  test("Displays grouped capabilities with check icons for each role", () => {
    const html = renderToStaticMarkup(
      createElement(RolesView, {
        orgSlug: "clinica-vida",
        rolesData: sampleRolesResponse,
      }),
    );

    // Group categories
    expect(html).toContain("Administração &amp; Equipe");
    expect(html).toContain("Atendimento Clínico &amp; Prontuário");
    expect(html).toContain("Recepção &amp; Agenda");

    // Key capabilities
    expect(html).toContain(
      "Gestão completa de membros da equipe e papéis de acesso",
    );
    expect(html).toContain("Trilha de auditoria e conformidade LGPD");
    expect(html).toContain("Gravação e revisão de anamnese assistida por IA");
    expect(html).toContain(
      "Gestão da agenda de consultas e calendário da clínica",
    );
    expect(html).toContain(
      "Disparo de mensagens logísticas e avisos via WhatsApp",
    );
  });
});

describe("Roles List & Matrix (#324) - Strictly Read-Only in MVP", () => {
  test("Does NOT contain any buttons or links to create, edit, or delete roles", () => {
    const html = renderToStaticMarkup(
      createElement(RolesView, {
        orgSlug: "clinica-vida",
        rolesData: sampleRolesResponse,
      }),
    );

    // Ensure no creation buttons
    expect(html).not.toContain("Criar papel");
    expect(html).not.toContain("Novo papel");
    expect(html).not.toContain("Adicionar papel");

    // Ensure no editing triggers
    expect(html).not.toContain("Editar papel");
    expect(html).not.toContain("Editar permissões");
    expect(html).not.toContain("Alterar papel");

    // Ensure no deletion triggers
    expect(html).not.toContain("Excluir papel");
    expect(html).not.toContain("Remover papel");

    // Ensure no button elements in view
    expect(html).not.toContain("<button");
  });
});

describe("Roles List & Matrix (#324) - Error Handling & Retry", () => {
  test("RolesSettingsError renders error state with retry button", () => {
    const html = renderToStaticMarkup(
      createElement(RolesSettingsError, {
        orgSlug: "clinica-vida",
        errorMessage: "Falha de conexão com a API",
      }),
    );

    expect(html).toContain("Não foi possível carregar os papéis de acesso");
    expect(html).toContain("Falha de conexão com a API");
    expect(html).toContain("Tentar novamente");
    expect(html).toContain("/app/clinica-vida/settings/roles");
  });

  test("RolesSettingsPage displays error card when data fetch fails", async () => {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (
        urlStr.endsWith("/organizations") ||
        urlStr.includes("/organizations?")
      ) {
        return Response.json({ data: mockOrganizations });
      }
      return Response.json(
        { error: { message: "Internal server error" } },
        { status: 500 },
      );
    }) as unknown as typeof fetch;

    const pageElement = await RolesSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-vida" }),
    });
    const html = renderToStaticMarkup(pageElement);

    expect(html).toContain("Não foi possível carregar os papéis de acesso");
    expect(html).toContain("Tentar novamente");
  });
});
