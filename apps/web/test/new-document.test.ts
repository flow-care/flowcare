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
  VALID_DOCUMENT_CREATION_TYPES,
  DOCUMENT_CREATION_TYPE_CONFIGS,
  isValidDocumentCreationType,
  resolveTemplateVariables,
  isDocumentFormDirty,
} = await import("../lib/documents");

const {
  createDocumentDraft,
  getDocumentTemplates,
  DocumentsApiError,
  normalizeDocumentType,
} = await import("../server/documents");

const { createDocumentAction, getDocumentTemplatesAction } = await import(
  "../app/app/[orgSlug]/documents/actions"
);

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
// 1. Type validation & fallback selector tests
// ----------------------------------------------------
describe("Document creation type validation & fallback selector", () => {
  test("isValidDocumentCreationType recognizes all 5 supported types", () => {
    expect(isValidDocumentCreationType("prescription")).toBe(true);
    expect(isValidDocumentCreationType("report")).toBe(true);
    expect(isValidDocumentCreationType("certificate")).toBe(true);
    expect(isValidDocumentCreationType("exam")).toBe(true);
    expect(isValidDocumentCreationType("custom")).toBe(true);
  });

  test("isValidDocumentCreationType is case-insensitive", () => {
    expect(isValidDocumentCreationType("PRESCRIPTION")).toBe(true);
    expect(isValidDocumentCreationType("Report")).toBe(true);
    expect(isValidDocumentCreationType("CERTIFICATE")).toBe(true);
    expect(isValidDocumentCreationType("Exam")).toBe(true);
    expect(isValidDocumentCreationType("CUSTOM")).toBe(true);
  });

  test("isValidDocumentCreationType returns false for missing or invalid types", () => {
    expect(isValidDocumentCreationType(undefined)).toBe(false);
    expect(isValidDocumentCreationType(null)).toBe(false);
    expect(isValidDocumentCreationType("")).toBe(false);
    expect(isValidDocumentCreationType("invalid")).toBe(false);
    expect(isValidDocumentCreationType("billing")).toBe(false);
    expect(isValidDocumentCreationType("unknown_type")).toBe(false);
  });

  test("DOCUMENT_CREATION_TYPE_CONFIGS contains valid configs for all 5 types", () => {
    expect(VALID_DOCUMENT_CREATION_TYPES).toHaveLength(5);

    for (const type of VALID_DOCUMENT_CREATION_TYPES) {
      const config = DOCUMENT_CREATION_TYPE_CONFIGS[type];
      expect(config).toBeDefined();
      expect(config.key).toBe(type);
      expect(config.label.length).toBeGreaterThan(0);
      expect(config.defaultTitle.length).toBeGreaterThan(0);
      expect(config.backendType).toBeDefined();
    }

    expect(DOCUMENT_CREATION_TYPE_CONFIGS.prescription.defaultTitle).toBe(
      "Receita Médica",
    );
    expect(DOCUMENT_CREATION_TYPE_CONFIGS.report.defaultTitle).toBe(
      "Laudo Médico",
    );
    expect(DOCUMENT_CREATION_TYPE_CONFIGS.certificate.defaultTitle).toBe(
      "Atestado Médico",
    );
    expect(DOCUMENT_CREATION_TYPE_CONFIGS.exam.defaultTitle).toBe(
      "Solicitação de Exames",
    );
    expect(DOCUMENT_CREATION_TYPE_CONFIGS.custom.defaultTitle).toBe(
      "Documento Clínico",
    );
  });

  test("normalizeDocumentType maps creation types and aliases to backend enum", () => {
    expect(normalizeDocumentType("prescription")).toBe("PRESCRIPTION");
    expect(normalizeDocumentType("report")).toBe("REPORT");
    expect(normalizeDocumentType("certificate")).toBe("CERTIFICATE");
    expect(normalizeDocumentType("exam")).toBe("EXAM_REQUEST");
    expect(normalizeDocumentType("custom")).toBe("REPORT");

    // Preserves uppercase
    expect(normalizeDocumentType("PRESCRIPTION")).toBe("PRESCRIPTION");
    expect(normalizeDocumentType("CERTIFICATE")).toBe("CERTIFICATE");
    expect(normalizeDocumentType("REPORT")).toBe("REPORT");
    expect(normalizeDocumentType("EXAM_REQUEST")).toBe("EXAM_REQUEST");

    // Portuguese aliases
    expect(normalizeDocumentType("receita")).toBe("PRESCRIPTION");
    expect(normalizeDocumentType("laudo")).toBe("REPORT");
    expect(normalizeDocumentType("atestado")).toBe("CERTIFICATE");
  });
});

// ----------------------------------------------------
// 2. Template variable resolution tests
// ----------------------------------------------------
describe("Template variable resolution", () => {
  test("replaces basic dynamic variables {paciente_nome}, {data}, {medico_nome}", () => {
    const template =
      "Atesto que o paciente {paciente_nome} compareceu em consulta na data de {data} com o Dr. {medico_nome}.";
    const resolved = resolveTemplateVariables(template, {
      paciente_nome: "Maria Santos",
      data: "14/10/2026",
      medico_nome: "João da Costa",
    });

    expect(resolved).toBe(
      "Atesto que o paciente Maria Santos compareceu em consulta na data de 14/10/2026 com o Dr. João da Costa.",
    );
  });

  test("replaces double brace formats {{paciente_nome}}, {{data}}, {{medico_nome}}", () => {
    const template =
      "Receita para {{paciente_nome}} emitida em {{data}} por {{medico_nome}}.";
    const resolved = resolveTemplateVariables(template, {
      paciente_nome: "Carlos Eduardo",
      data: "15/10/2026",
      medico_nome: "Dra. Ana Silva",
    });

    expect(resolved).toBe(
      "Receita para Carlos Eduardo emitida em 15/10/2026 por Dra. Ana Silva.",
    );
  });

  test("replaces short alias formats {paciente}, {medico}, {data_atual}", () => {
    const template =
      "Laudo de {paciente} emitido por {medico} no dia {data_atual}.";
    const resolved = resolveTemplateVariables(template, {
      paciente_nome: "Lucia Ferreira",
      data: "16/10/2026",
      medico_nome: "Dr. Pedro",
    });

    expect(resolved).toBe(
      "Laudo de Lucia Ferreira emitido por Dr. Pedro no dia 16/10/2026.",
    );
  });

  test("handles multiple occurrences of same variable throughout content", () => {
    const template =
      "Identificação: {paciente_nome}. Prescreve-se ao Sr(a) {paciente_nome} repouso.";
    const resolved = resolveTemplateVariables(template, {
      paciente_nome: "João Silva",
    });

    expect(resolved).toBe(
      "Identificação: João Silva. Prescreve-se ao Sr(a) João Silva repouso.",
    );
  });

  test("preserves unspecified variables intact without rendering undefined", () => {
    const template =
      "Paciente: {paciente_nome}. Data: {data}. Médico: {medico_nome}.";
    const resolved = resolveTemplateVariables(template, {
      paciente_nome: "Mariana Souza",
    });

    expect(resolved).toBe(
      "Paciente: Mariana Souza. Data: {data}. Médico: {medico_nome}.",
    );
    expect(resolved).not.toContain("undefined");
  });
});

// ----------------------------------------------------
// 3. Dirty form guard & discard confirmation tests
// ----------------------------------------------------
describe("Dirty form guard & discard confirmation", () => {
  test("returns false when form is completely pristine with default title", () => {
    expect(
      isDocumentFormDirty({
        patientId: null,
        title: "Receita Médica",
        defaultTitle: "Receita Médica",
        content: "",
        notes: "",
      }),
    ).toBe(false);
  });

  test("returns true when patient has been selected", () => {
    expect(
      isDocumentFormDirty({
        patientId: "patient-uuid-123",
        title: "Receita Médica",
        defaultTitle: "Receita Médica",
        content: "",
        notes: "",
      }),
    ).toBe(true);
  });

  test("returns true when content is typed", () => {
    expect(
      isDocumentFormDirty({
        patientId: null,
        title: "Receita Médica",
        defaultTitle: "Receita Médica",
        content: "Dipirona 500mg de 6 em 6 horas",
        notes: "",
      }),
    ).toBe(true);
  });

  test("returns true when private notes are typed", () => {
    expect(
      isDocumentFormDirty({
        patientId: null,
        title: "Receita Médica",
        defaultTitle: "Receita Médica",
        content: "",
        notes: "Paciente com histórico de alergia a penicilina",
      }),
    ).toBe(true);
  });

  test("returns true when title is customized away from default", () => {
    expect(
      isDocumentFormDirty({
        patientId: null,
        title: "Receita de Controle Especial",
        defaultTitle: "Receita Médica",
        content: "",
        notes: "",
      }),
    ).toBe(true);
  });
});

// ----------------------------------------------------
// 4. Draft creation payload & Idempotency-Key tests
// ----------------------------------------------------
describe("createDocumentDraft server function", () => {
  test("sends correct POST payload and Idempotency-Key header", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        capturedBody = JSON.parse(init?.body as string) as Record<
          string,
          unknown
        >;

        return new Response(
          JSON.stringify({
            id: "doc-new-123",
            documentId: "doc-new-123",
            organizationId: "org-test",
            patientId: "pt-123",
            authorId: "usr-456",
            type: "PRESCRIPTION",
            title: "Receita Médica",
            status: "DRAFT",
            version: 1,
            patient: { id: "pt-123", fullName: "Maria Santos" },
            author: { id: "usr-456", fullName: "Dr. João" },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const result = await createDocumentDraft("clinica-saude", {
      patientId: "pt-123",
      type: "prescription",
      title: "Receita Médica",
      content: "Amoxicilina 500mg - 1 comprimido de 8/8h por 7 dias.",
      notes: "Nota interna confidencial",
      templateId: "tmpl-789",
      idempotencyKey: "custom-key-doc-456",
    });

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-saude/documents",
    );
    expect(capturedHeaders.Authorization).toBe("Bearer valid-session-jwt");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
    expect(capturedHeaders["Idempotency-Key"]).toBe("custom-key-doc-456");

    expect(capturedBody.patientId).toBe("pt-123");
    expect(capturedBody.type).toBe("PRESCRIPTION");
    expect(capturedBody.title).toBe("Receita Médica");
    expect(capturedBody.content).toBe(
      "Amoxicilina 500mg - 1 comprimido de 8/8h por 7 dias.",
    );
    expect(capturedBody.notes).toBe("Nota interna confidencial");
    expect(capturedBody.templateId).toBe("tmpl-789");

    expect(result.id).toBe("doc-new-123");
    expect(result.status).toBe("DRAFT");
  });

  test("auto-generates idempotencyKey when not explicitly provided", async () => {
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = mock(
      async (_input: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return new Response(
          JSON.stringify({
            id: "doc-auto-key",
            documentId: "doc-auto-key",
            organizationId: "org-test",
            patientId: "pt-123",
            authorId: "usr-456",
            type: "REPORT",
            title: "Laudo Médico",
            status: "DRAFT",
            version: 1,
            patient: { id: "pt-123", fullName: "Maria Santos" },
            author: { id: "usr-456", fullName: "Dr. João" },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    await createDocumentDraft("clinica-saude", {
      patientId: "pt-123",
      type: "report",
      title: "Laudo Médico",
      content: "Exame clínico sem alterações significativas.",
    });

    expect(capturedHeaders["Idempotency-Key"]).toBeDefined();
    expect(capturedHeaders["Idempotency-Key"].length).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------
// 5. Error handling tests
// ----------------------------------------------------
describe("Error handling in documents server layer", () => {
  test("createDocumentDraft throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;

    try {
      await createDocumentDraft("clinica-saude", {
        patientId: "pt-1",
        type: "prescription",
        title: "Receita",
        content: "Texto",
      });
      expect(true).toBe(false); // Should not reach
    } catch (err) {
      expect(err).toBeInstanceOf(DocumentsApiError);
      if (err instanceof DocumentsApiError) {
        expect(err.code).toBe("UNAUTHENTICATED");
      }
    }
  });

  test("createDocumentDraft throws DocumentsApiError with backend message on 400 validation error", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          code: "VALIDATION_ERROR",
          message: "Paciente não encontrado.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    });

    try {
      await createDocumentDraft("clinica-saude", {
        patientId: "nonexistent",
        type: "prescription",
        title: "Receita",
        content: "Texto",
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(DocumentsApiError);
      if (err instanceof DocumentsApiError) {
        expect(err.code).toBe("VALIDATION_ERROR");
        expect(err.message).toBe("Paciente não encontrado.");
      }
    }
  });

  test("createDocumentDraft throws UNAVAILABLE on network failure", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("Network unreachable");
    });

    try {
      await createDocumentDraft("clinica-saude", {
        patientId: "pt-1",
        type: "prescription",
        title: "Receita",
        content: "Texto",
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(DocumentsApiError);
      if (err instanceof DocumentsApiError) {
        expect(err.code).toBe("UNAVAILABLE");
      }
    }
  });

  test("createDocumentAction catches DocumentsApiError and returns failure object", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          code: "VALIDATION_ERROR",
          message: "Título do documento é obrigatório.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await createDocumentAction("clinica-saude", {
      patientId: "pt-1",
      type: "prescription",
      title: "",
      content: "Texto",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Título do documento é obrigatório.");
    expect(result.code).toBe("VALIDATION_ERROR");
  });

  test("createDocumentAction succeeds and returns created document", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          id: "doc-success-123",
          documentId: "doc-success-123",
          organizationId: "org-1",
          patientId: "pt-1",
          authorId: "usr-1",
          type: "CERTIFICATE",
          title: "Atestado Médico",
          status: "DRAFT",
          version: 1,
          patient: { id: "pt-1", fullName: "Carlos" },
          author: { id: "usr-1", fullName: "Dra. Maria" },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await createDocumentAction("clinica-saude", {
      patientId: "pt-1",
      type: "certificate",
      title: "Atestado Médico",
      content: "Atesto repouso de 2 dias.",
    });

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe("doc-success-123");
    expect(result.data?.status).toBe("DRAFT");
  });
});

// ----------------------------------------------------
// 6. Template fetching tests
// ----------------------------------------------------
describe("getDocumentTemplates server function", () => {
  test("fetches templates filtering by normalized type", async () => {
    let capturedUrl = "";

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "tmpl-1",
              title: "Receita Padrão Antibiótico",
              type: "PRESCRIPTION",
              bodyTemplate: "Uso oral: Amoxicilina 500mg {paciente_nome}",
              version: 1,
            },
          ],
          pageInfo: { nextCursor: null, hasNextPage: false },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const templates = await getDocumentTemplates(
      "clinica-saude",
      "prescription",
    );

    expect(capturedUrl).toContain("type=PRESCRIPTION");
    expect(templates).toHaveLength(1);
    expect(templates[0].title).toBe("Receita Padrão Antibiótico");
  });

  test("does not add type filter when type is custom", async () => {
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

    await getDocumentTemplates("clinica-saude", "custom");

    expect(capturedUrl).not.toContain("type=");
  });

  test("getDocumentTemplatesAction handles server error gracefully", async () => {
    globalThis.fetch = mock(async () => {
      return new Response("Internal Server Error", { status: 500 });
    });

    const res = await getDocumentTemplatesAction("clinica-saude", "report");

    expect(res.success).toBe(false);
    expect(res.data).toEqual([]);
    expect(res.error).toBeDefined();
  });
});
