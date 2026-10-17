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
