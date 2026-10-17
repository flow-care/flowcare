"use server";

import { revalidatePath } from "next/cache";
import {
  type UpdateProfilePayload,
  validateProfilePhoto,
} from "@/lib/account-profile";
import {
  AccountApiError,
  updateProfile,
  uploadProfilePhoto,
} from "@/server/account";

export type ActionResult<T = unknown> =
  | { ok: true; data: T; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

export async function updateProfileAction(
  payload: UpdateProfilePayload,
): Promise<ActionResult> {
  try {
    if (!payload.fullName || payload.fullName.trim().length < 3) {
      return {
        ok: false,
        message: "Nome completo deve ter pelo menos 3 caracteres.",
        fieldErrors: {
          fullName: "Nome completo deve ter pelo menos 3 caracteres.",
        },
      };
    }

    const updated = await updateProfile(payload);
    revalidatePath("/account/profile");
    revalidatePath("/app", "layout");
    revalidatePath("/", "layout");
    return {
      ok: true,
      data: updated,
      message: "Dados pessoais atualizados com sucesso!",
    };
  } catch (error) {
    if (error instanceof AccountApiError) {
      return { ok: false, message: error.message };
    }
    return {
      ok: false,
      message: "Não foi possível salvar as alterações. Tente novamente.",
    };
  }
}

export async function uploadProfilePhotoAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return {
        ok: false,
        message: "Nenhuma foto foi selecionada.",
      };
    }

    const validation = validateProfilePhoto(file);
    if (!validation.valid) {
      return {
        ok: false,
        message: validation.error || "Arquivo de foto inválido.",
      };
    }

    const updated = await uploadProfilePhoto(formData);
    revalidatePath("/account/profile");
    revalidatePath("/app", "layout");
    revalidatePath("/", "layout");
    return {
      ok: true,
      data: updated,
      message: "Foto de perfil atualizada com sucesso!",
    };
  } catch (error) {
    if (error instanceof AccountApiError) {
      return { ok: false, message: error.message };
    }
    return {
      ok: false,
      message: "Não foi possível enviar a foto. Tente novamente.",
    };
  }
}
