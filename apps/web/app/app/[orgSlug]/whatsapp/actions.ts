"use server";

import { revalidatePath } from "next/cache";
import {
  canEditWhatsAppTemplates,
  templateTypeSchema,
  validateTemplateContent,
  type WhatsAppTemplateItem,
} from "@/lib/whatsapp";
import { getAvailableOrganizations } from "@/server/organizations";
import {
  resendWhatsAppMessage,
  saveWhatsAppTemplate,
  WhatsAppApiError,
} from "@/server/whatsapp";

export type ResendMessageResult =
  | { ok: true; status: "QUEUED" }
  | { ok: false; code: string; message: string };

export async function resendMessageAction(
  orgSlug: string,
  messageId: string,
  idempotencyKey: string,
): Promise<ResendMessageResult> {
  if (!messageId || idempotencyKey.trim().length < 8) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Não foi possível identificar a tentativa de reenvio.",
    };
  }
  try {
    const result = await resendWhatsAppMessage(
      orgSlug,
      messageId,
      idempotencyKey.trim(),
    );
    revalidatePath(`/app/${orgSlug}/whatsapp`);
    return { ok: true, status: result.status };
  } catch (error) {
    if (error instanceof WhatsAppApiError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return {
      ok: false,
      code: "UNKNOWN",
      message: "Não foi possível reenviar a mensagem. Tente novamente.",
    };
  }
}

export type SaveTemplateResult =
  | { ok: true; template: WhatsAppTemplateItem }
  | { ok: false; code: string; message: string };

export async function saveTemplateAction(
  orgSlug: string,
  type: string,
  input: { content: string; version: number },
): Promise<SaveTemplateResult> {
  const parsedType = templateTypeSchema.safeParse(type);
  if (!parsedType.success) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Tipo de mensagem inválido.",
    };
  }

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );
  if (!current || !canEditWhatsAppTemplates(current.role)) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Apenas administradores da clínica podem editar estes textos.",
    };
  }

  const validation = validateTemplateContent(parsedType.data, input.content);
  if (!validation.ok) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: validation.issues[0]?.message ?? "Texto inválido.",
    };
  }
  if (!Number.isInteger(input.version) || input.version < 0) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Versão do texto inválida. Recarregue a página.",
    };
  }

  try {
    const template = await saveWhatsAppTemplate(orgSlug, parsedType.data, {
      content: input.content,
      version: input.version,
    });
    revalidatePath(`/app/${orgSlug}/whatsapp`);
    return { ok: true, template };
  } catch (error) {
    if (error instanceof WhatsAppApiError) {
      return { ok: false, code: error.code, message: error.message };
    }
    return {
      ok: false,
      code: "UNKNOWN",
      message: "Não foi possível salvar o texto. Tente novamente.",
    };
  }
}
