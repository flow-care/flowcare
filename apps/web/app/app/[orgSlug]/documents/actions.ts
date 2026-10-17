"use server";

import { revalidatePath } from "next/cache";
import {
  type CreateDocumentDraftInput,
  createDocumentDraft as createDocumentDraftServer,
  type DocumentListItem,
  DocumentsApiError,
  type DocumentTemplateItem,
  getDocumentTemplates as getDocumentTemplatesServer,
} from "@/server/documents";
import { getPatients, type PatientItem } from "@/server/patients";

export interface CreateDocumentActionResult {
  success: boolean;
  data?: DocumentListItem;
  error?: string;
  code?: string;
}

export async function createDocumentAction(
  orgSlug: string,
  input: CreateDocumentDraftInput,
): Promise<CreateDocumentActionResult> {
  try {
    const result = await createDocumentDraftServer(orgSlug, input);
    revalidatePath(`/app/${orgSlug}/documents`);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof DocumentsApiError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível criar o documento.",
    };
  }
}

export async function getDocumentTemplatesAction(
  orgSlug: string,
  type?: string,
): Promise<{ success: boolean; data: DocumentTemplateItem[]; error?: string }> {
  try {
    const templates = await getDocumentTemplatesServer(orgSlug, type);
    return { success: true, data: templates };
  } catch (error) {
    return {
      success: false,
      data: [],
      error:
        error instanceof Error
          ? error.message
          : "Erro ao carregar modelos de documentos.",
    };
  }
}

export async function searchPatientsAction(
  orgSlug: string,
  search: string,
): Promise<PatientItem[]> {
  try {
    if (!search?.trim()) return [];
    const response = await getPatients(orgSlug, {
      search: search.trim(),
      limit: 10,
    });
    return response.data;
  } catch {
    return [];
  }
}

export interface IssueDocumentActionResult {
  success: boolean;
  data?: {
    status: "ISSUED";
    issuedAt: string;
    snapshotHash: string;
    chainVersion: number;
    replacesDocumentId: string | null;
  };
  error?: string;
  code?: string;
}

export async function issueDocumentAction(
  orgSlug: string,
  documentId: string,
  payload: { version: number },
): Promise<IssueDocumentActionResult> {
  try {
    const { issueDocument } = await import("@/server/documents");
    const result = await issueDocument(orgSlug, documentId, payload);
    revalidatePath(`/app/${orgSlug}/documents`);
    revalidatePath(`/app/${orgSlug}/documents/${documentId}`);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof DocumentsApiError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível emitir o documento.",
    };
  }
}

export interface RectifyDocumentActionResult {
  success: boolean;
  data?: {
    documentId: string;
    status: "DRAFT";
    replacesDocumentId: string;
    chainVersion: number;
  };
  error?: string;
  code?: string;
}

export async function rectifyDocumentAction(
  orgSlug: string,
  documentId: string,
): Promise<RectifyDocumentActionResult> {
  try {
    const { rectifyDocument } = await import("@/server/documents");
    const result = await rectifyDocument(orgSlug, documentId);
    revalidatePath(`/app/${orgSlug}/documents`);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof DocumentsApiError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível retificar o documento.",
    };
  }
}

export interface VoidDocumentActionResult {
  success: boolean;
  data?: {
    documentId?: string;
    status: "VOIDED";
    voidedAt: string;
    voidReason: string;
  };
  error?: string;
  code?: string;
}

export async function voidDocumentAction(
  orgSlug: string,
  documentId: string,
  payload: { reason: string; version: number },
): Promise<VoidDocumentActionResult> {
  if (!payload.reason || payload.reason.trim().length < 10) {
    return {
      success: false,
      error: "A justificativa deve conter pelo menos 10 caracteres.",
      code: "VALIDATION_ERROR",
    };
  }

  try {
    const { voidDocument } = await import("@/server/documents");
    const result = await voidDocument(orgSlug, documentId, payload);
    revalidatePath(`/app/${orgSlug}/documents`);
    revalidatePath(`/app/${orgSlug}/documents/${documentId}`);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof DocumentsApiError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível anular o documento.",
    };
  }
}

export async function updateDocumentAction(
  orgSlug: string,
  documentId: string,
  payload: {
    version: number;
    title?: string;
    content?: string;
    notes?: string;
    templateId?: string | null;
  },
): Promise<{
  success: boolean;
  error?: string;
  code?: string;
}> {
  try {
    const { updateDocumentDraft } = await import("@/server/documents");
    await updateDocumentDraft(orgSlug, documentId, payload);
    revalidatePath(`/app/${orgSlug}/documents`);
    revalidatePath(`/app/${orgSlug}/documents/${documentId}`);
    return { success: true };
  } catch (error) {
    if (error instanceof DocumentsApiError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o documento.",
    };
  }
}
