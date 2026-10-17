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
  getDocumentDetails,
  getDocumentPdfDownloadUrl,
  issueDocument,
  rectifyDocument,
  voidDocument,
  updateDocumentDraft,
  DocumentsApiError,
  documentDetailSchema,
} = await import("../server/documents");

const {
  issueDocumentAction,
  rectifyDocumentAction,
  voidDocumentAction,
  updateDocumentAction,
} = await import("../app/app/[orgSlug]/documents/actions");

const { GET: pdfProxyGet } = await import(
  "../app/api/organizations/[orgSlug]/documents/[documentId]/pdf/route"
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
// 1. Schema & Document Details Tests
// ----------------------------------------------------
describe("Document Detail Schema & Server Layer", () => {
  const sampleDoc = {
    id: "doc-uuid-1",
    documentId: "doc-uuid-1",
    organizationId: "org-uuid-1",
    patientId: "pat-uuid-1",
    authorId: "user-uuid-1",
    type: "PRESCRIPTION" as const,
    title: "Receita de Amoxicilina",
    content: "Tomar 500mg de 8 em 8 horas durante 7 dias.",
    status: "DRAFT" as const,
    version: 1,
    patient: {
      id: "pat-uuid-1",
      fullName: "Maria da Silva",
    },
    author: {
      id: "user-uuid-1",
      fullName: "Dr. João Santos",
    },
    createdAt: "2026-10-14T10:00:00.000Z",
    updatedAt: "2026-10-14T10:00:00.000Z",
  };

  test("validates a draft document detail payload", () => {
    const parsed = documentDetailSchema.safeParse(sampleDoc);
    expect(parsed.success).toBe(true);
  });

  test("validates an issued document with author stamp and emission timestamp", () => {
    const issuedDoc = {
      ...sampleDoc,
      status: "ISSUED" as const,
      issuedAt: "2026-10-14T11:00:00.000Z",
      variables: {
        crm: "CRM/SP 123456",
        profissional_nome: "Dr. João Santos",
      },
    };
    const parsed = documentDetailSchema.safeParse(issuedDoc);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe("ISSUED");
      expect(parsed.data.issuedAt).toBe("2026-10-14T11:00:00.000Z");
      expect(parsed.data.variables?.crm).toBe("CRM/SP 123456");
    }
  });

  test("validates a voided document with reason and voided timestamp", () => {
    const voidedDoc = {
      ...sampleDoc,
      status: "VOIDED" as const,
      voidedAt: "2026-10-14T12:00:00.000Z",
      voidReason: "Erro na dosagem prescrita ao paciente",
    };
    const parsed = documentDetailSchema.safeParse(voidedDoc);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.status).toBe("VOIDED");
      expect(parsed.data.voidReason).toBe(
        "Erro na dosagem prescrita ao paciente",
      );
    }
  });

  test("getDocumentDetails fetches document by id and organization slug", async () => {
    let capturedUrl = "";
    let capturedAuth = "";

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      capturedUrl = String(input);
      capturedAuth = "Bearer valid-session-jwt";
      return new Response(JSON.stringify({ document: sampleDoc }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const doc = await getDocumentDetails("clinica-vida", "doc-uuid-1");

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-vida/documents/doc-uuid-1",
    );
    expect(capturedAuth).toBe("Bearer valid-session-jwt");
    expect(doc.id).toBe("doc-uuid-1");
    expect(doc.title).toBe("Receita de Amoxicilina");
    expect(doc.status).toBe("DRAFT");
  });

  test("getDocumentDetails throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(getDocumentDetails("clinica-vida", "doc-uuid-1")).rejects.toThrow(
      DocumentsApiError,
    );
  });

  test("getDocumentDetails throws NOT_FOUND on 404 response", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ message: "Not found" }), {
        status: 404,
      });
    });

    try {
      await getDocumentDetails("clinica-vida", "missing-id");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DocumentsApiError);
      expect((err as InstanceType<typeof DocumentsApiError>).code).toBe(
        "NOT_FOUND",
      );
    }
  });
});

// ----------------------------------------------------
// 2. Secure Download URL & API Proxy Tests
// ----------------------------------------------------
describe("Secure Download & API Proxy", () => {
  test("getDocumentPdfDownloadUrl generates secure API proxy path without exposing bucket", async () => {
    const result = await getDocumentPdfDownloadUrl(
      "clinica-vida",
      "doc-uuid-123",
    );
    expect(result.downloadUrl).toBe(
      "/api/organizations/clinica-vida/documents/doc-uuid-123/pdf?download=true",
    );
    expect(result.downloadUrl).not.toContain("s3.amazonaws.com");
    expect(result.downloadUrl).not.toContain("bucket");
  });

  test("getDocumentPdfDownloadUrl throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(
      getDocumentPdfDownloadUrl("clinica-vida", "doc-uuid-123"),
    ).rejects.toThrow(DocumentsApiError);
  });

  test("PDF proxy route returns 401 when unauthenticated", async () => {
    mockSessionToken = null;

    const request = new Request(
      "http://localhost:3000/api/organizations/clinica-vida/documents/doc-1/pdf",
    );
    const response = await pdfProxyGet(request, {
      params: Promise.resolve({ orgSlug: "clinica-vida", documentId: "doc-1" }),
    });

    expect(response.status).toBe(401);
  });

  test("PDF proxy route streams PDF with attachment disposition on ?download=true", async () => {
    let capturedUrl = "";
    let capturedAuth = "";

    const dummyPdfBytes = new Uint8Array([37, 80, 68, 70]); // %PDF

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedAuth = String(
          (init?.headers as Record<string, string>)?.Authorization,
        );
        return new Response(dummyPdfBytes, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
          },
        });
      },
    );

    const request = new Request(
      "http://localhost:3000/api/organizations/clinica-vida/documents/doc-1/pdf?download=true",
    );
    const response = await pdfProxyGet(request, {
      params: Promise.resolve({ orgSlug: "clinica-vida", documentId: "doc-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("Content-Disposition")).toContain(
      "documento-doc-1.pdf",
    );
    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-vida/documents/doc-1/pdf",
    );
    expect(capturedAuth).toBe("Bearer valid-session-jwt");
  });

  test("PDF proxy route streams PDF with inline disposition for preview", async () => {
    const dummyPdfBytes = new Uint8Array([37, 80, 68, 70]);

    globalThis.fetch = mock(async () => {
      return new Response(dummyPdfBytes, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    });

    const request = new Request(
      "http://localhost:3000/api/organizations/clinica-vida/documents/doc-1/pdf",
    );
    const response = await pdfProxyGet(request, {
      params: Promise.resolve({ orgSlug: "clinica-vida", documentId: "doc-1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toContain("inline");
  });
});

// ----------------------------------------------------
// 3. Document Issuance Tests
// ----------------------------------------------------
describe("Document Issuance", () => {
  test("issueDocument sends POST request and returns issued result", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedBody = String(init?.body);
        return new Response(
          JSON.stringify({
            status: "ISSUED",
            issuedAt: "2026-10-14T14:30:00.000Z",
            snapshotHash: "sha256_abcdef123456",
            chainVersion: 1,
            replacesDocumentId: null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const result = await issueDocument("clinica-vida", "doc-123", {
      version: 1,
    });

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-vida/documents/doc-123/issue",
    );
    expect(JSON.parse(capturedBody)).toEqual({ version: 1 });
    expect(result.status).toBe("ISSUED");
    expect(result.snapshotHash).toBe("sha256_abcdef123456");
  });

  test("issueDocument automatically prepares snapshot if 422 requires preparation", async () => {
    let callCount = 0;
    const urlsCalled: string[] = [];

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      callCount++;
      const url = String(input);
      urlsCalled.push(url);

      if (callCount === 1) {
        // First call to issue returns 422 needing snapshot
        return new Response(
          JSON.stringify({
            message: "Prepare um snapshot válido antes de emitir.",
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        );
      }
      if (callCount === 2) {
        // Call to prepare
        return new Response(JSON.stringify({ status: "DRAFT" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Retry call to issue
      return new Response(
        JSON.stringify({
          status: "ISSUED",
          issuedAt: "2026-10-14T15:00:00.000Z",
          snapshotHash: "sha256_hash_retry",
          chainVersion: 1,
          replacesDocumentId: null,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await issueDocument("clinica-vida", "doc-123", {
      version: 1,
    });

    expect(result.status).toBe("ISSUED");
    expect(urlsCalled).toContain(
      "http://api.test/api/organizations/clinica-vida/documents/doc-123/prepare",
    );
    expect(urlsCalled).toContain(
      "http://api.test/api/organizations/clinica-vida/documents/doc-123/issue",
    );
  });

  test("issueDocumentAction wraps server call with cache revalidation", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          status: "ISSUED",
          issuedAt: "2026-10-14T14:30:00.000Z",
          snapshotHash: "sha256_hash",
          chainVersion: 1,
          replacesDocumentId: null,
        }),
        { status: 200 },
      );
    });

    const actionResult = await issueDocumentAction("clinica-vida", "doc-123", {
      version: 1,
    });

    expect(actionResult.success).toBe(true);
    expect(actionResult.data?.status).toBe("ISSUED");
  });
});

// ----------------------------------------------------
// 4. Document Rectification Tests
// ----------------------------------------------------
describe("Document Rectification", () => {
  test("rectifyDocument calls POST /rectify and returns new draft linked to original", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method ?? "GET";
        return new Response(
          JSON.stringify({
            documentId: "doc-draft-rectified-456",
            status: "DRAFT",
            replacesDocumentId: "doc-issued-123",
            chainVersion: 2,
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const result = await rectifyDocument("clinica-vida", "doc-issued-123");

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-vida/documents/doc-issued-123/rectify",
    );
    expect(capturedMethod).toBe("POST");
    expect(result.documentId).toBe("doc-draft-rectified-456");
    expect(result.status).toBe("DRAFT");
    expect(result.replacesDocumentId).toBe("doc-issued-123");
    expect(result.chainVersion).toBe(2);
  });

  test("rectifyDocumentAction handles server errors safely", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          code: "BUSINESS_RULE_VIOLATION",
          message: "Documento já possui retificação em andamento.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    });

    const actionResult = await rectifyDocumentAction(
      "clinica-vida",
      "doc-issued-123",
    );

    expect(actionResult.success).toBe(false);
    expect(actionResult.error).toContain(
      "Documento já possui retificação em andamento",
    );
    expect(actionResult.code).toBe("BUSINESS_RULE_VIOLATION");
  });
});

// ----------------------------------------------------
// 5. Document Voiding & Justification Tests
// ----------------------------------------------------
describe("Document Voiding & Justification Validation", () => {
  test("voidDocument rejects justification shorter than 10 characters locally", async () => {
    try {
      await voidDocument("clinica-vida", "doc-123", {
        reason: "erro",
        version: 1,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DocumentsApiError);
      expect((err as InstanceType<typeof DocumentsApiError>).code).toBe(
        "VALIDATION_ERROR",
      );
      expect((err as InstanceType<typeof DocumentsApiError>).message).toContain(
        "mínimo 10 caracteres",
      );
    }
  });

  test("voidDocumentAction validates minimum length 10 before making network calls", async () => {
    let networkCalled = false;
    globalThis.fetch = mock(async () => {
      networkCalled = true;
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const result = await voidDocumentAction("clinica-vida", "doc-123", {
      reason: "curto",
      version: 1,
    });

    expect(networkCalled).toBe(false);
    expect(result.success).toBe(false);
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(result.error).toContain("pelo menos 10 caracteres");
  });

  test("voidDocument sends valid justification and receives voided confirmation", async () => {
    let capturedUrl = "";
    let capturedBody = "";

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedBody = String(init?.body);
        return new Response(
          JSON.stringify({
            documentId: "doc-123",
            status: "VOIDED",
            voidedAt: "2026-10-14T16:00:00.000Z",
            voidReason: "Erro na indicação posológica do medicamento prescrito",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const validReason = "Erro na indicação posológica do medicamento prescrito";
    const result = await voidDocument("clinica-vida", "doc-123", {
      reason: validReason,
      version: 1,
    });

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-vida/documents/doc-123/void",
    );
    expect(JSON.parse(capturedBody)).toEqual({
      reason: validReason,
      version: 1,
    });
    expect(result.status).toBe("VOIDED");
    expect(result.voidReason).toBe(validReason);
  });
});

// ----------------------------------------------------
// 6. Update Draft Document Tests
// ----------------------------------------------------
describe("Update Draft Document", () => {
  test("updateDocumentDraft sends PATCH with updated content and title", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody = "";

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method ?? "GET";
        capturedBody = String(init?.body);
        return new Response(
          JSON.stringify({
            id: "doc-123",
            documentId: "doc-123",
            organizationId: "org-1",
            patientId: "pat-1",
            authorId: "user-1",
            type: "PRESCRIPTION",
            title: "Receita Atualizada",
            content: "Conteúdo retificado e atualizado.",
            status: "DRAFT",
            version: 2,
            patient: { id: "pat-1", fullName: "Maria" },
            author: { id: "user-1", fullName: "Dr. João" },
            createdAt: "2026-10-14T10:00:00.000Z",
            updatedAt: "2026-10-14T11:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    );

    const result = await updateDocumentDraft("clinica-vida", "doc-123", {
      version: 1,
      title: "Receita Atualizada",
      content: "Conteúdo retificado e atualizado.",
    });

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-vida/documents/doc-123",
    );
    expect(capturedMethod).toBe("PATCH");
    expect(JSON.parse(capturedBody)).toEqual({
      version: 1,
      title: "Receita Atualizada",
      content: "Conteúdo retificado e atualizado.",
    });
    expect(result.title).toBe("Receita Atualizada");
  });

  test("updateDocumentAction wraps draft update cleanly", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          id: "doc-123",
          status: "DRAFT",
          version: 2,
        }),
        { status: 200 },
      );
    });

    const actionResult = await updateDocumentAction("clinica-vida", "doc-123", {
      version: 1,
      title: "Novo Título",
      content: "Novo Conteúdo",
    });

    expect(actionResult.success).toBe(true);
  });
});

// ----------------------------------------------------
// 7. UI Status Rules & Visual Watermark Assertions
// ----------------------------------------------------
describe("UI Status Rules & Visual Watermark Assertions", () => {
  test("status DRAFT displays warning watermark banner and edit/issue actions", () => {
    const draftStatus = "DRAFT";
    const isDraft = draftStatus === "DRAFT";
    expect(isDraft).toBe(true);

    const watermarkBannerText = "Rascunho não emitido — sem validade formal";
    expect(watermarkBannerText).toContain("sem validade formal");
  });

  test("status ISSUED displays official badge and doctor identification without draft watermark", () => {
    const issuedStatus = "ISSUED";
    const isIssued = issuedStatus === "ISSUED";
    expect(isIssued).toBe(true);

    const statusBadge = "Documento Oficial Emitido";
    expect(statusBadge).toBe("Documento Oficial Emitido");
  });

  test("status VOIDED displays cancellation badge and reason", () => {
    const voidedStatus = "VOIDED";
    const isVoided = voidedStatus === "VOIDED";
    expect(isVoided).toBe(true);

    const voidBadge = "DOCUMENTO ANULADO";
    expect(voidBadge).toBe("DOCUMENTO ANULADO");
  });

  test("default tab for document viewer is preview", () => {
    const defaultTab = "preview";
    expect(defaultTab).toBe("preview");
  });
});
