"use server";

import { revalidatePath } from "next/cache";
import {
  archiveTemplate as archiveTemplateServer,
  TemplatesApiError,
  unarchiveTemplate as unarchiveTemplateServer,
} from "@/server/templates";

export interface TemplateActionResult {
  success: boolean;
  error?: string;
  code?: string;
}

export async function archiveTemplateAction(
  orgSlug: string,
  templateId: string,
): Promise<TemplateActionResult> {
  try {
    await archiveTemplateServer(orgSlug, templateId);
    revalidatePath(`/app/${orgSlug}/templates`);
    return { success: true };
  } catch (error) {
    if (error instanceof TemplatesApiError) {
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
          : "Não foi possível arquivar o modelo de documento.",
    };
  }
}

export async function unarchiveTemplateAction(
  orgSlug: string,
  templateId: string,
): Promise<TemplateActionResult> {
  try {
    await unarchiveTemplateServer(orgSlug, templateId);
    revalidatePath(`/app/${orgSlug}/templates`);
    return { success: true };
  } catch (error) {
    if (error instanceof TemplatesApiError) {
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
          : "Não foi possível restaurar o modelo de documento.",
    };
  }
}
