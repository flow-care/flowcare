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
