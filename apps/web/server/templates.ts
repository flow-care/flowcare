import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export const templateTypeSchema = z.enum([
  "PRESCRIPTION",
  "CERTIFICATE",
  "REPORT",
  "EXAM_REQUEST",
]);

export const templateStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const templateScopeSchema = z.enum(["ORGANIZATION", "GLOBAL"]);

export const templateItemSchema = z.object({
  id: z.string(),
  organizationId: z.string().nullable().optional(),
  scope: templateScopeSchema.optional(),
  isGlobal: z.boolean().optional(),
  title: z.string(),
  type: templateTypeSchema,
  bodyTemplate: z.string(),
  status: templateStatusSchema,
  version: z.number(),
  selectable: z.boolean().optional(),
  archivedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const templatePageInfoSchema = z.object({
  nextCursor: z.string().nullable().optional(),
  hasNextPage: z.boolean().optional(),
});

export const listTemplatesResponseSchema = z.object({
  data: z.array(templateItemSchema),
  pageInfo: templatePageInfoSchema.optional(),
});

export type TemplateType = z.infer<typeof templateTypeSchema>;
export type TemplateStatus = z.infer<typeof templateStatusSchema>;
export type TemplateScope = z.infer<typeof templateScopeSchema>;
export type TemplateItem = z.infer<typeof templateItemSchema>;
export type TemplatePageInfo = z.infer<typeof templatePageInfoSchema>;

export interface GetTemplatesQuery {
  type?: string;
  status?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface ListTemplatesResult {
  data: TemplateItem[];
  pageInfo: {
    nextCursor: string | null;
    hasNextPage: boolean;
  };
}

export class TemplatesApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "TemplatesApiError";
  }
}

export function normalizeTemplateType(type?: string): TemplateType | undefined {
  if (!type) return undefined;
  const upper = type.toUpperCase().trim();
  if (upper === "ALL" || upper === "TODOS") return undefined;
  if (upper === "PRESCRIPTION" || upper === "RECEITA") return "PRESCRIPTION";
  if (upper === "CERTIFICATE" || upper === "ATESTADO") return "CERTIFICATE";
  if (
    upper === "REPORT" ||
    upper === "LAUDO" ||
    upper === "CUSTOM" ||
    upper === "LIVRE" ||
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
  return undefined;
}

export async function getTemplatesList(
  orgSlug: string,
  query: GetTemplatesQuery = {},
): Promise<ListTemplatesResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new TemplatesApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams();

  if (query.type) {
    const normalized = normalizeTemplateType(query.type);
    if (normalized) {
      searchParams.set("type", normalized);
    }
  }

  const statusParam = query.status
    ? query.status.toUpperCase().trim()
    : "ACTIVE";
  if (statusParam === "ARCHIVED" || statusParam === "ARQUIVADOS") {
    searchParams.set("status", "ARCHIVED");
    searchParams.set("includeArchived", "true");
  } else if (statusParam === "ACTIVE" || statusParam === "ATIVOS") {
    searchParams.set("status", "ACTIVE");
  } else if (statusParam === "ALL" || statusParam === "TODOS") {
    searchParams.set("includeArchived", "true");
  } else {
    searchParams.set("status", "ACTIVE");
  }

  if (query.search?.trim()) {
    searchParams.set("search", query.search.trim());
  }

  if (query.limit !== undefined) {
    searchParams.set("limit", String(query.limit));
  }

  if (query.cursor) {
    searchParams.set("cursor", query.cursor);
  }

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
    throw new TemplatesApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de modelos.",
    );
  }

  if (!response.ok) {
    let message = "Erro ao buscar modelos de documentos.";
    let code = "UNKNOWN_ERROR";
    let details: unknown;
    try {
      const errJson = await response.json();
      if (errJson?.message) message = errJson.message;
      if (errJson?.code) code = errJson.code;
      if (errJson?.details) details = errJson.details;
    } catch {}
    throw new TemplatesApiError(code, message, details);
  }

  const json = await response.json();
  const parsed = listTemplatesResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      data: [],
      pageInfo: { nextCursor: null, hasNextPage: false },
    };
  }

  return {
    data: parsed.data.data,
    pageInfo: {
      nextCursor: parsed.data.pageInfo?.nextCursor ?? null,
      hasNextPage: parsed.data.pageInfo?.hasNextPage ?? false,
    },
  };
}

export async function archiveTemplate(
  orgSlug: string,
  templateId: string,
): Promise<{ archived: boolean }> {
  const token = await getSessionToken();
  if (!token) {
    throw new TemplatesApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/document-templates/${encodeURIComponent(templateId)}/archive`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TemplatesApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor para arquivar o modelo.",
    );
  }

  if (!response.ok) {
    let message = "Não foi possível arquivar o modelo de documento.";
    let code = "UNKNOWN_ERROR";
    let details: unknown;
    try {
      const errJson = await response.json();
      if (errJson?.message) message = errJson.message;
      if (errJson?.code) code = errJson.code;
      if (errJson?.details) details = errJson.details;
    } catch {}
    throw new TemplatesApiError(code, message, details);
  }

  return { archived: true };
}

export async function unarchiveTemplate(
  orgSlug: string,
  templateId: string,
): Promise<{ unarchived: boolean }> {
  const token = await getSessionToken();
  if (!token) {
    throw new TemplatesApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/document-templates/${encodeURIComponent(templateId)}/unarchive`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TemplatesApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor para restaurar o modelo.",
    );
  }

  if (!response.ok) {
    let message = "Não foi possível restaurar o modelo de documento.";
    let code = "UNKNOWN_ERROR";
    let details: unknown;
    try {
      const errJson = await response.json();
      if (errJson?.message) message = errJson.message;
      if (errJson?.code) code = errJson.code;
      if (errJson?.details) details = errJson.details;
    } catch {}
    throw new TemplatesApiError(code, message, details);
  }

  return { unarchived: true };
}
