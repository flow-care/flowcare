import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

import { canOpenSection } from "@/lib/app-navigation";
import {
  formatDocumentDate,
  formatDocumentStatus,
  formatDocumentType,
} from "@/lib/documents";
import {
  documentListItemSchema,
  listDocumentsResponseSchema,
} from "@/server/documents";

describe("clinical documents permissions", () => {
  test("allows clinical roles to access documents", () => {
    expect(canOpenSection("PROFESSIONAL", "documents")).toBe(true);
    expect(canOpenSection("ADMIN_PROFESSIONAL", "documents")).toBe(true);
  });

  test("blocks non-clinical roles from accessing documents", () => {
    expect(canOpenSection("ADMIN", "documents")).toBe(true);
    expect(canOpenSection("RECEPTIONIST", "documents")).toBe(false);
  });
});

describe("clinical documents formatting", () => {
  test("formats document types correctly", () => {
    expect(formatDocumentType("PRESCRIPTION")).toBe("Receita");
    expect(formatDocumentType("CERTIFICATE")).toBe("Atestado");
    expect(formatDocumentType("REPORT")).toBe("Laudo");
    expect(formatDocumentType("EXAM_REQUEST")).toBe("Solicitação de exames");
    expect(formatDocumentType("UNKNOWN")).toBe("UNKNOWN");
  });

  test("formats document statuses correctly", () => {
    expect(formatDocumentStatus("DRAFT")).toBe("Rascunho");
    expect(formatDocumentStatus("ISSUED")).toBe("Emitido");
    expect(formatDocumentStatus("VOIDED")).toBe("Anulado");
    expect(formatDocumentStatus("UNKNOWN")).toBe("UNKNOWN");
  });

  test("formats dates consistently or returns hyphen on invalid/null dates", () => {
    expect(formatDocumentDate(null)).toBe("-");
    expect(formatDocumentDate(undefined)).toBe("-");
    expect(formatDocumentDate("invalid-date")).toBe("-");

    const formatted = formatDocumentDate("2026-10-14T14:30:00.000Z");
    expect(formatted).not.toBe("-");
    expect(formatted).toContain("14/10/2026");
  });
});

describe("clinical documents schemas", () => {
  const validDoc = {
    id: "doc-1",
    documentId: "doc-1",
    organizationId: "org-1",
    patientId: "patient-1",
    authorId: "author-1",
    type: "PRESCRIPTION",
    title: "Receita de Amoxicilina",
    status: "ISSUED",
    version: 1,
    patient: {
      id: "patient-1",
      fullName: "Maria da Silva",
    },
    author: {
      id: "author-1",
      fullName: "Dr. João Santos",
    },
    issuedAt: "2026-10-14T14:30:00.000Z",
    createdAt: "2026-10-14T14:00:00.000Z",
    updatedAt: "2026-10-14T14:30:00.000Z",
  };

  test("validates a clinical document list item", () => {
    const parsed = documentListItemSchema.safeParse(validDoc);
    expect(parsed.success).toBe(true);
  });

  test("validates paginated documents response", () => {
    const responsePayload = {
      data: [validDoc],
      documents: [validDoc],
      pageInfo: {
        limit: 20,
        page: 1,
        totalCount: 1,
        hasNextPage: false,
        nextCursor: null,
      },
    };

    const parsed = listDocumentsResponseSchema.safeParse(responsePayload);
    expect(parsed.success).toBe(true);
  });

  test("rejects payload with invalid document status", () => {
    const invalidDoc = {
      ...validDoc,
      status: "INVALID_STATUS",
    };
    const parsed = documentListItemSchema.safeParse(invalidDoc);
    expect(parsed.success).toBe(false);
  });
});
