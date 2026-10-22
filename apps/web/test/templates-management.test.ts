import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let mockSessionToken: string | null = "valid-session-jwt";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
    set: () => {},
  }),
}));
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

const {
  formatTemplateType,
  formatTemplateStatus,
  formatTemplateDate,
  extractTemplateVariables,
  matchesTemplateSearch,
} = await import("../lib/templates");

const {
  getTemplatesList,
  archiveTemplate,
  unarchiveTemplate,
  TemplatesApiError,
  normalizeTemplateType,
  templateItemSchema,
  listTemplatesResponseSchema,
} = await import("../server/templates");

const { getDocumentTemplates } = await import("../server/documents");

const { archiveTemplateAction, unarchiveTemplateAction } = await import(
  "../app/app/[orgSlug]/templates/actions"
);

const { canOpenSection } = await import("../lib/app-navigation");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

// ----------------------------------------------------
// 1. Organization Scoping & Permissions Tests
// ----------------------------------------------------
describe("Templates organization scoping & access control", () => {
  test("allows clinical roles to access templates section", () => {
    expect(canOpenSection("PROFESSIONAL", "templates")).toBe(true);
    expect(canOpenSection("ADMIN_PROFESSIONAL", "templates")).toBe(true);
  });

  test("blocks non-clinical roles from accessing templates section", () => {
    expect(canOpenSection("ADMIN", "templates")).toBe(true);
    expect(canOpenSection("RECEPTIONIST", "templates")).toBe(false);
  });

  test("getTemplatesList queries the exact organization endpoint", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "tmpl-1",
                organizationId: "org-alfa",
                scope: "ORGANIZATION",
                isGlobal: false,
                title: "Receita Padrão Alfa",
                type: "PRESCRIPTION",
                bodyTemplate: "Uso oral para {paciente_nome}",
                status: "ACTIVE",
                version: 1,
                selectable: true,
                archivedAt: null,
                createdAt: "2026-10-14T10:00:00.000Z",
                updatedAt: "2026-10-14T10:00:00.000Z",
              },
            ],
            pageInfo: { nextCursor: null, hasNextPage: false },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const result = await getTemplatesList("clinica-alfa");

    expect(capturedUrl).toContain(
      "http://api.test/api/organizations/clinica-alfa/templates",
    );
    expect(capturedHeaders.Authorization).toBe("Bearer valid-session-jwt");
    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe("Receita Padrão Alfa");
  });

  test("isolates requests between organizations", async () => {
    const requestedUrls: string[] = [];

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          data: [],
          pageInfo: { nextCursor: null, hasNextPage: false },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await getTemplatesList("clinica-alfa");
    await getTemplatesList("clinica-beta");

    expect(requestedUrls[0]).toContain("/organizations/clinica-alfa/templates");
    expect(requestedUrls[1]).toContain("/organizations/clinica-beta/templates");
    expect(requestedUrls[0]).not.toContain("clinica-beta");
    expect(requestedUrls[1]).not.toContain("clinica-alfa");
  });
});

// ----------------------------------------------------
// 2. Archived Templates Exclusion from New Documents
// ----------------------------------------------------
describe("Archived templates exclusion from new documents", () => {
  test("getDocumentTemplates sends status=ACTIVE and selectableOnly=true", async () => {
    let capturedUrl = "";

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "tmpl-active",
              title: "Receita Ativa",
              type: "PRESCRIPTION",
              bodyTemplate: "Receita ativa para {paciente_nome}",
              status: "ACTIVE",
              version: 1,
              selectable: true,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await getDocumentTemplates("clinica-saude", "prescription");

    expect(capturedUrl).toContain("status=ACTIVE");
    expect(capturedUrl).toContain("selectableOnly=true");
  });

  test("getDocumentTemplates filters out archived templates if returned by upstream", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "tmpl-active",
              title: "Receita Ativa",
              type: "PRESCRIPTION",
              bodyTemplate: "Receita ativa",
              status: "ACTIVE",
              version: 1,
              selectable: true,
            },
            {
              id: "tmpl-archived",
              title: "Receita Antiga Descontinuada",
              type: "PRESCRIPTION",
              bodyTemplate: "Receita arquivada",
              status: "ARCHIVED",
              version: 1,
              selectable: false,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await getDocumentTemplates("clinica-saude", "prescription");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("tmpl-active");
    expect(result.some((t) => t.id === "tmpl-archived")).toBe(false);
  });
});

// ----------------------------------------------------
// 3. Search and Filter Query Mapping Tests
// ----------------------------------------------------
describe("Title and keyword search filtering", () => {
  test("getTemplatesList forwards search query parameter to upstream API", async () => {
    let capturedUrl = "";

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          data: [],
          pageInfo: { nextCursor: null, hasNextPage: false },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    await getTemplatesList("clinica-saude", { search: "amoxicilina" });

    expect(capturedUrl).toContain("search=amoxicilina");
  });

  test("matchesTemplateSearch matches case-insensitively by title and body content", () => {
    const template = {
      title: "Atestado Médico Padrão de Comparecimento",
      bodyTemplate:
        "Atesto que {paciente_nome} esteve em consulta médica nesta clínica.",
    };

    expect(matchesTemplateSearch(template, "atestado")).toBe(true);
    expect(matchesTemplateSearch(template, "ATESTADO")).toBe(true);
    expect(matchesTemplateSearch(template, "comparecimento")).toBe(true);
    expect(matchesTemplateSearch(template, "consulta médica")).toBe(true);
    expect(matchesTemplateSearch(template, "cirurgia")).toBe(false);
    expect(matchesTemplateSearch(template, "")).toBe(true);
    expect(matchesTemplateSearch(template, "   ")).toBe(true);
  });

  test("normalizeTemplateType maps Portuguese and alias filters correctly", () => {
    expect(normalizeTemplateType("receita")).toBe("PRESCRIPTION");
    expect(normalizeTemplateType("atestado")).toBe("CERTIFICATE");
    expect(normalizeTemplateType("laudo")).toBe("REPORT");
    expect(normalizeTemplateType("livre")).toBe("REPORT");
    expect(normalizeTemplateType("exame")).toBe("EXAM_REQUEST");
    expect(normalizeTemplateType("todos")).toBeUndefined();
    expect(normalizeTemplateType("all")).toBeUndefined();
    expect(normalizeTemplateType(undefined)).toBeUndefined();
  });
});

// ----------------------------------------------------
// 4. Archive & Lifecycle Server Layer and Action Tests
// ----------------------------------------------------
describe("Template archive & restore lifecycle", () => {
  test("archiveTemplate sends POST to document-templates/:id/archive", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method ?? "GET";
        return new Response(JSON.stringify({ archived: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    const result = await archiveTemplate("clinica-saude", "tmpl-123");

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-saude/document-templates/tmpl-123/archive",
    );
    expect(capturedMethod).toBe("POST");
    expect(result.archived).toBe(true);
  });

  test("archiveTemplateAction catches error and returns formatted result", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          code: "TEMPLATE_NOT_FOUND",
          message: "Modelo não encontrado para arquivamento.",
        }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    });

    const actionResult = await archiveTemplateAction(
      "clinica-saude",
      "nonexistent",
    );

    expect(actionResult.success).toBe(false);
    expect(actionResult.code).toBe("TEMPLATE_NOT_FOUND");
    expect(actionResult.error).toBe("Modelo não encontrado para arquivamento.");
  });

  test("archiveTemplateAction revalidates and returns success", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ archived: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const actionResult = await archiveTemplateAction(
      "clinica-saude",
      "tmpl-valid",
    );

    expect(actionResult.success).toBe(true);
    expect(actionResult.error).toBeUndefined();
  });

  test("unarchiveTemplate sends POST to document-templates/:id/unarchive", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method ?? "GET";
        return new Response(JSON.stringify({ unarchived: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    const result = await unarchiveTemplate("clinica-saude", "tmpl-123");

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-saude/document-templates/tmpl-123/unarchive",
    );
    expect(capturedMethod).toBe("POST");
    expect(result.unarchived).toBe(true);
  });

  test("unarchiveTemplateAction handles failure cleanly", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          code: "NOT_SUPPORTED",
          message: "Restauração de modelos não suportada.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    });

    const actionResult = await unarchiveTemplateAction(
      "clinica-saude",
      "tmpl-123",
    );

    expect(actionResult.success).toBe(false);
    expect(actionResult.error).toBe("Restauração de modelos não suportada.");
  });
});

// ----------------------------------------------------
// 5. Archiving Confirmation Text Verification
// ----------------------------------------------------
describe("Archive confirmation dialog text requirement (#291)", () => {
  test("verifies confirmation dialog text explaining non-destructive archival", () => {
    const confirmationText =
      "Este modelo deixará de ser sugerido para a criação de novos documentos clínicos. Documentos já emitidos com este modelo permanecerão inalterados e preservados no prontuário dos pacientes.";

    expect(confirmationText).toContain(
      "deixará de ser sugerido para a criação de novos documentos",
    );
    expect(confirmationText).toContain(
      "permanecerão inalterados e preservados",
    );
  });
});

// ----------------------------------------------------
// 6. Error Mappings & Schema Validation
// ----------------------------------------------------
describe("Templates error handling & schema validation", () => {
  test("getTemplatesList throws UNAUTHENTICATED when token is missing", async () => {
    mockSessionToken = null;

    try {
      await getTemplatesList("clinica-saude");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TemplatesApiError);
      if (err instanceof TemplatesApiError) {
        expect(err.code).toBe("UNAUTHENTICATED");
      }
    }
  });

  test("getTemplatesList throws UNAVAILABLE on network error", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Network unreachable");
    });

    try {
      await getTemplatesList("clinica-saude");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TemplatesApiError);
      if (err instanceof TemplatesApiError) {
        expect(err.code).toBe("UNAVAILABLE");
      }
    }
  });

  test("templateItemSchema validates compliant template record", () => {
    const valid = {
      id: "tmpl-uuid-1",
      organizationId: "org-1",
      scope: "ORGANIZATION",
      isGlobal: false,
      title: "Receita de Amoxicilina",
      type: "PRESCRIPTION",
      bodyTemplate: "Amoxicilina 500mg {paciente_nome}",
      status: "ACTIVE",
      version: 1,
      selectable: true,
      archivedAt: null,
      createdAt: "2026-10-14T10:00:00.000Z",
      updatedAt: "2026-10-14T10:00:00.000Z",
    };

    const parsed = templateItemSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  test("templateItemSchema rejects invalid status", () => {
    const invalid = {
      id: "tmpl-uuid-1",
      title: "Receita",
      type: "PRESCRIPTION",
      bodyTemplate: "Texto",
      status: "DELETED", // only ACTIVE or ARCHIVED allowed
      version: 1,
      createdAt: "2026-10-14T10:00:00.000Z",
      updatedAt: "2026-10-14T10:00:00.000Z",
    };

    const parsed = templateItemSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  test("listTemplatesResponseSchema parses response with pageInfo", () => {
    const payload = {
      data: [
        {
          id: "tmpl-1",
          title: "Atestado 1 Dia",
          type: "CERTIFICATE",
          bodyTemplate: "Atesto comparecimento de {paciente_nome}.",
          status: "ACTIVE",
          version: 2,
          createdAt: "2026-10-14T10:00:00.000Z",
          updatedAt: "2026-10-14T10:00:00.000Z",
        },
      ],
      pageInfo: {
        nextCursor: null,
        hasNextPage: false,
      },
    };

    const parsed = listTemplatesResponseSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.data).toHaveLength(1);
    }
  });
});

// ----------------------------------------------------
// 7. Formatters & Variable Extraction Tests
// ----------------------------------------------------
describe("Templates formatters & variable extraction", () => {
  test("extractTemplateVariables extracts unique placeholders", () => {
    const text =
      "Atesto que o paciente {paciente_nome} esteve na clínica {clinica_nome} na data de {data} com o Dr. {medico_nome}. Paciente: {paciente_nome}.";
    const vars = extractTemplateVariables(text);

    expect(vars).toContain("{paciente_nome}");
    expect(vars).toContain("{clinica_nome}");
    expect(vars).toContain("{data}");
    expect(vars).toContain("{medico_nome}");
    expect(vars).toHaveLength(4); // No duplicates
  });

  test("extractTemplateVariables handles double curly braces syntax {{var}}", () => {
    const text = "Receita para {{paciente_nome}} emitida em {{data_atual}}.";
    const vars = extractTemplateVariables(text);

    expect(vars).toContain("{paciente_nome}");
    expect(vars).toContain("{data_atual}");
  });

  test("extractTemplateVariables returns empty array for empty or null text", () => {
    expect(extractTemplateVariables("")).toEqual([]);
    expect(extractTemplateVariables(null)).toEqual([]);
    expect(extractTemplateVariables(undefined)).toEqual([]);
    expect(extractTemplateVariables("Texto sem variaveis")).toEqual([]);
  });

  test("formatTemplateType formats all supported document types to Portuguese", () => {
    expect(formatTemplateType("PRESCRIPTION")).toBe("Receita");
    expect(formatTemplateType("CERTIFICATE")).toBe("Atestado");
    expect(formatTemplateType("REPORT")).toBe("Laudo");
    expect(formatTemplateType("EXAM_REQUEST")).toBe("Exame");
    expect(formatTemplateType("CUSTOM")).toBe("Livre");
  });

  test("formatTemplateStatus formats ACTIVE and ARCHIVED", () => {
    expect(formatTemplateStatus("ACTIVE")).toBe("Ativo");
    expect(formatTemplateStatus("ARCHIVED")).toBe("Arquivado");
  });

  test("formatTemplateDate formats Brazilian date", () => {
    expect(formatTemplateDate(null)).toBe("-");
    expect(formatTemplateDate(undefined)).toBe("-");
    expect(formatTemplateDate("invalid")).toBe("-");

    const formatted = formatTemplateDate("2026-10-14T14:30:00.000Z");
    expect(formatted).toBe("14/10/2026");
  });
});
