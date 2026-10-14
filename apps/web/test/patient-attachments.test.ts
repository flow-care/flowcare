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
  formatAttachmentCategory,
  formatFileSize,
  formatAttachmentDate,
  ATTACHMENT_CATEGORIES,
} = await import("../components/flowcare/patients/patient-attachments-view");

const {
  getPatientAttachments,
  getAttachmentDownloadUrl,
  archivePatientAttachment,
  uploadPatientAttachment,
  validateAttachmentFile,
  PATIENT_ATTACHMENT_MAX_BYTES,
  ALLOWED_ATTACHMENT_EXTENSIONS,
  PatientsApiError,
} = await import("../server/patients");

const {
  archivePatientAttachmentAction,
  getAttachmentDownloadUrlAction,
  uploadPatientAttachmentAction,
} = await import("../app/app/[orgSlug]/patients/actions");

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

describe("Patient Attachments - Helpers & Formatting", () => {
  test("formatAttachmentCategory maps various category inputs to standard Portuguese labels", () => {
    expect(formatAttachmentCategory("Laudo")).toBe("Laudo");
    expect(formatAttachmentCategory("laudo")).toBe("Laudo");
    expect(formatAttachmentCategory("REPORT")).toBe("Laudo");
    expect(formatAttachmentCategory("report")).toBe("Laudo");

    expect(formatAttachmentCategory("Imagem")).toBe("Imagem");
    expect(formatAttachmentCategory("image")).toBe("Imagem");

    expect(formatAttachmentCategory("Receita externa")).toBe("Receita externa");
    expect(formatAttachmentCategory("receita_externa")).toBe("Receita externa");
    expect(formatAttachmentCategory("external_prescription")).toBe(
      "Receita externa",
    );

    expect(formatAttachmentCategory("Outro")).toBe("Outro");
    expect(formatAttachmentCategory("other")).toBe("Outro");
    expect(formatAttachmentCategory(null)).toBe("Outro");
    expect(formatAttachmentCategory(undefined)).toBe("Outro");
    expect(formatAttachmentCategory("")).toBe("Outro");
  });

  test("ATTACHMENT_CATEGORIES contains the four required category badges", () => {
    expect(ATTACHMENT_CATEGORIES).toEqual([
      "Laudo",
      "Imagem",
      "Receita externa",
      "Outro",
    ]);
  });

  test("formatFileSize formats bytes to human readable B, KB, MB", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(150 * 1024)).toBe("150.0 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(25 * 1024 * 1024)).toBe("25.0 MB");
  });

  test("formatAttachmentDate formats date correctly", () => {
    const formatted = formatAttachmentDate("2026-10-14T14:30:00.000Z");
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe("Patient Attachments - Client/Server File Validation", () => {
  test("validateAttachmentFile accepts valid PDF, JPG, JPEG, and PNG files under 25MB", () => {
    expect(
      validateAttachmentFile({
        name: "hemograma.pdf",
        size: 1024 * 1024,
      }),
    ).toEqual({ valid: true });

    expect(
      validateAttachmentFile({
        name: "raio-x.jpg",
        size: 2 * 1024 * 1024,
      }),
    ).toEqual({ valid: true });

    expect(
      validateAttachmentFile({
        name: "foto.jpeg",
        size: 5 * 1024 * 1024,
      }),
    ).toEqual({ valid: true });

    expect(
      validateAttachmentFile({
        name: "tomografia.png",
        size: 25 * 1024 * 1024,
      }),
    ).toEqual({ valid: true });
  });

  test("validateAttachmentFile rejects forbidden extensions", () => {
    const invalidFiles = [
      "script.exe",
      "trojan.bat",
      "archive.zip",
      "notes.txt",
      "video.mp4",
      "data.csv",
      "noextension",
    ];

    for (const name of invalidFiles) {
      const res = validateAttachmentFile({ name, size: 1024 });
      expect(res.valid).toBe(false);
      expect(res.error).toBeDefined();
    }
  });

  test("validateAttachmentFile rejects files exceeding 25MB limit", () => {
    const res = validateAttachmentFile({
      name: "huge-scan.pdf",
      size: 25 * 1024 * 1024 + 1,
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("25MB");
  });

  test("validateAttachmentFile rejects empty files (size <= 0)", () => {
    const res = validateAttachmentFile({
      name: "empty.pdf",
      size: 0,
    });
    expect(res.valid).toBe(false);
    expect(res.error).toContain("vazio");
  });

  test("PATIENT_ATTACHMENT_MAX_BYTES equals 25MB", () => {
    expect(PATIENT_ATTACHMENT_MAX_BYTES).toBe(25 * 1024 * 1024);
  });

  test("ALLOWED_ATTACHMENT_EXTENSIONS contains .pdf, .jpg, .jpeg, .png", () => {
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toEqual([
      ".pdf",
      ".jpg",
      ".jpeg",
      ".png",
    ]);
  });
});

describe("Patient Attachments - Server Layer (patients.ts)", () => {
  test("getPatientAttachments queries attachments with category and includeArchived filters", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return Response.json({
        data: [
          {
            id: "att-1",
            attachmentId: "att-1",
            fileName: "laudo.pdf",
            contentType: "application/pdf",
            sizeBytes: 2048,
            category: "Laudo",
            createdAt: "2026-10-14T10:00:00.000Z",
          },
        ],
      });
    }) as unknown as typeof fetch;

    const res = await getPatientAttachments("clinica-vida", "pat-1", {
      category: "Laudo",
      includeArchived: true,
    });

    expect(capturedUrl).toContain(
      "/organizations/clinica-vida/patients/pat-1/attachments",
    );
    expect(capturedUrl).toContain("category=Laudo");
    expect(capturedUrl).toContain("includeArchived=true");
    expect(res.data).toHaveLength(1);
    expect(res.isRestricted).toBe(false);
  });

  test("getPatientAttachments handles 403 Forbidden with isRestricted: true", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 403 });
    }) as unknown as typeof fetch;

    const res = await getPatientAttachments("clinica-vida", "pat-1");
    expect(res.isRestricted).toBe(true);
    expect(res.data).toHaveLength(0);
  });

  test("getPatientAttachments throws NOT_FOUND on 404", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    expect(getPatientAttachments("clinica-vida", "pat-999")).rejects.toThrow(
      PatientsApiError,
    );
  });

  test("getAttachmentDownloadUrl retrieves presigned download URL", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? "GET";
      return Response.json({
        attachmentId: "att-123",
        downloadUrl: "https://storage.test/presigned-token-url?signature=abc",
        expiresInSeconds: 900,
        expiresAt: "2026-10-14T15:00:00.000Z",
      });
    }) as unknown as typeof fetch;

    const res = await getAttachmentDownloadUrl(
      "clinica-vida",
      "pat-1",
      "att-123",
    );

    expect(capturedUrl).toContain(
      "/organizations/clinica-vida/patients/pat-1/attachments/att-123/download-url",
    );
    expect(capturedMethod).toBe("GET");
    expect(res.downloadUrl).toBe(
      "https://storage.test/presigned-token-url?signature=abc",
    );
    expect(res.attachmentId).toBe("att-123");
    expect(res.expiresInSeconds).toBe(900);
  });

  test("getAttachmentDownloadUrl throws error on unauthenticated or 403/404/503", async () => {
    mockSessionToken = null;
    expect(
      getAttachmentDownloadUrl("clinica-vida", "pat-1", "att-1"),
    ).rejects.toThrow(PatientsApiError);

    mockSessionToken = "valid-session-jwt";

    // 403
    globalThis.fetch = (async () =>
      new Response(null, { status: 403 })) as unknown as typeof fetch;
    expect(
      getAttachmentDownloadUrl("clinica-vida", "pat-1", "att-1"),
    ).rejects.toThrow(PatientsApiError);

    // 404
    globalThis.fetch = (async () =>
      new Response(null, { status: 404 })) as unknown as typeof fetch;
    expect(
      getAttachmentDownloadUrl("clinica-vida", "pat-1", "att-1"),
    ).rejects.toThrow(PatientsApiError);

    // 503
    globalThis.fetch = (async () =>
      new Response(null, { status: 503 })) as unknown as typeof fetch;
    expect(
      getAttachmentDownloadUrl("clinica-vida", "pat-1", "att-1"),
    ).rejects.toThrow(PatientsApiError);
  });

  test("archivePatientAttachment sends DELETE request and returns archived status", async () => {
    let capturedMethod = "";
    let capturedBody = "";

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedMethod = init?.method ?? "";
      capturedBody = (init?.body as string) ?? "";
      return Response.json({
        archived: true,
        attachment: {
          id: "att-123",
          status: "ARCHIVED",
          archivedAt: "2026-10-14T14:30:00.000Z",
        },
      });
    }) as unknown as typeof fetch;

    const res = await archivePatientAttachment(
      "clinica-vida",
      "pat-1",
      "att-123",
      "Arquivo duplicado",
    );

    expect(capturedMethod).toBe("DELETE");
    expect(capturedBody).toContain("Arquivo duplicado");
    expect(res.archived).toBe(true);
    expect(res.attachment.id).toBe("att-123");
  });

  test("uploadPatientAttachment validates file locally before dispatching to API", async () => {
    const formData = new FormData();
    const invalidFile = new File(["bad data"], "malicious.exe", {
      type: "application/x-msdownload",
    });
    formData.append("file", invalidFile);

    expect(
      uploadPatientAttachment("clinica-vida", "pat-1", formData),
    ).rejects.toThrow(PatientsApiError);
  });

  test("uploadPatientAttachment sends multipart/form-data and returns created attachment", async () => {
    let capturedMethod = "";

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedMethod = init?.method ?? "";
      return Response.json(
        {
          attachmentId: "att-new",
          attachment: {
            id: "att-new",
            fileName: "exame-sangue.pdf",
            contentType: "application/pdf",
            sizeBytes: 1024,
            category: "Laudo",
            createdAt: "2026-10-14T14:00:00.000Z",
          },
        },
        { status: 201 },
      );
    }) as unknown as typeof fetch;

    const formData = new FormData();
    const validPdf = new File(["dummy pdf content"], "exame-sangue.pdf", {
      type: "application/pdf",
    });
    formData.append("file", validPdf);
    formData.append("category", "Laudo");

    const res = await uploadPatientAttachment(
      "clinica-vida",
      "pat-1",
      formData,
    );

    expect(capturedMethod).toBe("POST");
    expect(res.success).toBe(true);
    expect(res.attachment?.id).toBe("att-new");
    expect(res.attachment?.fileName).toBe("exame-sangue.pdf");
  });

  test("uploadPatientAttachment maps 413 Payload Too Large and 503 Storage Unavailable", async () => {
    const formData = new FormData();
    formData.append(
      "file",
      new File(["pdf content"], "doc.pdf", { type: "application/pdf" }),
    );

    // 413
    globalThis.fetch = (async () =>
      new Response(null, { status: 413 })) as unknown as typeof fetch;
    expect(
      uploadPatientAttachment("clinica-vida", "pat-1", formData),
    ).rejects.toThrow(PatientsApiError);

    // 503
    globalThis.fetch = (async () =>
      new Response(null, { status: 503 })) as unknown as typeof fetch;
    expect(
      uploadPatientAttachment("clinica-vida", "pat-1", formData),
    ).rejects.toThrow(PatientsApiError);
  });
});

describe("Patient Attachments - Server Actions (actions.ts)", () => {
  test("archivePatientAttachmentAction succeeds and returns attachmentId", async () => {
    globalThis.fetch = (async () => {
      return Response.json({
        archived: true,
        attachment: { id: "att-1" },
      });
    }) as unknown as typeof fetch;

    const result = await archivePatientAttachmentAction(
      "clinica-vida",
      "pat-1",
      "att-1",
    );

    expect(result.success).toBe(true);
    expect(result.attachmentId).toBe("att-1");
  });

  test("archivePatientAttachmentAction returns error when backend rejects", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    const result = await archivePatientAttachmentAction(
      "clinica-vida",
      "pat-1",
      "att-missing",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.code).toBe("NOT_FOUND");
  });

  test("getAttachmentDownloadUrlAction returns downloadUrl", async () => {
    globalThis.fetch = (async () => {
      return Response.json({
        attachmentId: "att-1",
        downloadUrl: "https://storage.test/download-link",
      });
    }) as unknown as typeof fetch;

    const result = await getAttachmentDownloadUrlAction(
      "clinica-vida",
      "pat-1",
      "att-1",
    );

    expect(result.success).toBe(true);
    expect(result.downloadUrl).toBe("https://storage.test/download-link");
  });

  test("uploadPatientAttachmentAction uploads valid file successfully", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          attachment: {
            id: "att-success",
            fileName: "receita.png",
          },
        },
        { status: 201 },
      );
    }) as unknown as typeof fetch;

    const form = new FormData();
    form.append(
      "file",
      new File(["image bytes"], "receita.png", { type: "image/png" }),
    );

    const result = await uploadPatientAttachmentAction(
      "clinica-vida",
      "pat-1",
      form,
    );

    expect(result.success).toBe(true);
    expect(result.attachment?.id).toBe("att-success");
  });

  test("uploadPatientAttachmentAction returns validation error for disallowed extension", async () => {
    const form = new FormData();
    form.append(
      "file",
      new File(["script"], "virus.bat", { type: "text/plain" }),
    );

    const result = await uploadPatientAttachmentAction(
      "clinica-vida",
      "pat-1",
      form,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("não permitido");
  });
});
