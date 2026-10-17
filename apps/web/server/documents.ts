import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export const documentTypeSchema = z.enum([
  "PRESCRIPTION",
  "CERTIFICATE",
  "REPORT",
  "EXAM_REQUEST",
]);

export const documentStatusSchema = z.enum(["DRAFT", "ISSUED", "VOIDED"]);

export const documentListItemSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  chainVersion: z.number().optional(),
  replacesDocumentId: z.string().nullable().optional(),
  organizationId: z.string(),
  patientId: z.string(),
  authorId: z.string(),
  templateId: z.string().nullable().optional(),
  templateVersion: z.number().nullable().optional(),
  type: documentTypeSchema,
  title: z.string(),
  status: documentStatusSchema,
  version: z.number(),
  revisionId: z.string().nullable().optional(),
  currentRevisionId: z.string().nullable().optional(),
  patient: z.object({
    id: z.string(),
    fullName: z.string(),
  }),
  author: z.object({
    id: z.string(),
    fullName: z.string(),
  }),
  issuedAt: z.string().nullable().optional(),
  voidedAt: z.string().nullable().optional(),
  voidReason: z.string().nullable().optional(),
  voidedById: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const documentPageInfoSchema = z.object({
  limit: z.number(),
  page: z.number(),
  totalCount: z.number(),
  hasNextPage: z.boolean(),
  nextCursor: z.string().nullable().optional(),
});

export const listDocumentsResponseSchema = z.object({
  data: z.array(documentListItemSchema),
  documents: z.array(documentListItemSchema).optional(),
  pageInfo: documentPageInfoSchema,
});

export type DocumentType = z.infer<typeof documentTypeSchema>;
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type DocumentListItem = z.infer<typeof documentListItemSchema>;
export type DocumentPageInfo = z.infer<typeof documentPageInfoSchema>;

export type GetDocumentsQuery = {
  patientId?: string;
  type?: string;
  status?: string;
  cursor?: string;
  limit?: number;
  page?: number;
  search?: string;
};

export type ListDocumentsResult = {
  data: DocumentListItem[];
  pageInfo: DocumentPageInfo;
};

export async function getDocuments(
  orgSlug: string,
  query: GetDocumentsQuery = {},
): Promise<ListDocumentsResult | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { apiBaseUrl } = getServerConfig();
    const searchParams = new URLSearchParams();

    if (query.patientId) searchParams.set("patientId", query.patientId);
    if (query.type) searchParams.set("type", query.type);
    if (query.status) searchParams.set("status", query.status);
    if (query.cursor) searchParams.set("cursor", query.cursor);
    if (query.limit !== undefined) {
      searchParams.set("limit", String(query.limit));
    }
    if (query.page !== undefined) {
      searchParams.set("page", String(query.page));
    }
    if (query.search) searchParams.set("search", query.search);

    const qs = searchParams.toString();
    const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/documents${qs ? `?${qs}` : ""}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const json = await response.json();
    const parsed = listDocumentsResponseSchema.safeParse(json);
    if (!parsed.success) return null;

    return {
      data: parsed.data.data,
      pageInfo: parsed.data.pageInfo,
    };
  } catch {
    return null;
  }
}

export class DocumentsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DocumentsApiError";
  }
}

export const documentTemplateItemSchema = z.object({
  id: z.string(),
  organizationId: z.string().nullable().optional(),
  scope: z.enum(["ORGANIZATION", "GLOBAL"]).optional(),
  isGlobal: z.boolean().optional(),
  title: z.string(),
  type: documentTypeSchema,
  bodyTemplate: z.string(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  version: z.number(),
  selectable: z.boolean().optional(),
  archivedAt: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type DocumentTemplateItem = z.infer<typeof documentTemplateItemSchema>;

export function normalizeDocumentType(type: string): DocumentType {
  const upper = type.toUpperCase();
  if (upper === "PRESCRIPTION" || upper === "RECEITA") return "PRESCRIPTION";
  if (upper === "CERTIFICATE" || upper === "ATESTADO") return "CERTIFICATE";
  if (
    upper === "REPORT" ||
    upper === "LAUDO" ||
    upper === "CUSTOM" ||
    upper === "PERSONALIZADO"
  ) {
    return "REPORT";
  }
  if (
    upper === "EXAM_REQUEST" ||
    upper === "EXAM" ||
    upper === "EXAME" ||
    upper === "PEDIDO_EXAME"
  ) {
    return "EXAM_REQUEST";
  }
  return upper as DocumentType;
}

export async function getDocumentTemplates(
  orgSlug: string,
  type?: string,
): Promise<DocumentTemplateItem[]> {
  const token = await getSessionToken();
  if (!token) {
    throw new DocumentsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams();

  if (type) {
    const lower = type.toLowerCase();
    // For custom, all active templates can be returned or no type filter applied
    if (lower !== "custom") {
      const normalizedType = normalizeDocumentType(type);
      if (normalizedType) {
        searchParams.set("type", normalizedType);
      }
    }
  }

  searchParams.set("status", "ACTIVE");
  searchParams.set("selectableOnly", "true");

  const qs = searchParams.toString();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/templates${
    qs ? `?${qs}` : ""
  }`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DocumentsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de modelos.",
    );
  }

  if (!response.ok) {
    let message = "Erro ao buscar modelos de documentos.";
    let code = "UNKNOWN_ERROR";
    try {
      const errJson = await response.json();
      if (errJson?.message) message = errJson.message;
      if (errJson?.code) code = errJson.code;
    } catch {}
    throw new DocumentsApiError(code, message);
  }

  const json = await response.json();
  const parsed = z
    .object({ data: z.array(documentTemplateItemSchema) })
    .safeParse(json);
  if (!parsed.success) {
    return [];
  }
  return parsed.data.data.filter(
    (item) => item.status !== "ARCHIVED" && item.selectable !== false,
  );
}

export interface CreateDocumentDraftInput {
  patientId: string;
  type: string;
  title: string;
  content: string;
  notes?: string;
  templateId?: string;
  idempotencyKey?: string;
}

export async function createDocumentDraft(
  orgSlug: string,
  body: CreateDocumentDraftInput,
): Promise<DocumentListItem> {
  const token = await getSessionToken();
  if (!token) {
    throw new DocumentsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/documents`;

  const idempotencyKey =
    body.idempotencyKey ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `doc_${Date.now()}`);

  const normalizedType = normalizeDocumentType(body.type);

  const payload: Record<string, unknown> = {
    patientId: body.patientId,
    type: normalizedType,
    title: body.title.trim(),
    content: body.content.trim(),
  };

  if (body.templateId) {
    payload.templateId = body.templateId;
  }

  if (body.notes?.trim()) {
    payload.notes = body.notes.trim();
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DocumentsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de documentos.",
    );
  }

  if (!response.ok) {
    let message = "Não foi possível criar o documento.";
    let code = "UNKNOWN_ERROR";
    let details: unknown;
    try {
      const errJson = await response.json();
      if (errJson?.message) message = errJson.message;
      if (errJson?.code) code = errJson.code;
      if (errJson?.details) details = errJson.details;
    } catch {}
    throw new DocumentsApiError(code, message, details);
  }

  const json = await response.json();
  const parsed = documentListItemSchema.safeParse(json);
  if (parsed.success) {
    return parsed.data;
  }
  return json as DocumentListItem;
}
