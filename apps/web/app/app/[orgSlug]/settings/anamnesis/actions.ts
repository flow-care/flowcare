"use server";

import { revalidatePath } from "next/cache";
import type {
  DoctorAnamnesisTopicsResponse,
  UpdateDoctorAnamnesisTopicsPayload,
} from "@/lib/anamnesis-topics";
import type { ActionResult } from "@/lib/auth";
import {
  AnamnesisTopicsApiError,
  updateDoctorAnamnesisTopics,
} from "@/server/anamnesis-topics";

export async function updateAnamnesisTopicsAction(
  orgSlug: string,
  professionalId: string,
  payload: UpdateDoctorAnamnesisTopicsPayload,
): Promise<ActionResult<DoctorAnamnesisTopicsResponse>> {
  if (!orgSlug?.trim() || !professionalId?.trim()) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Identificador da organização ou do profissional inválido.",
      },
    };
  }

  if (
    !payload ||
    !Array.isArray(payload.topics) ||
    payload.topics.length === 0
  ) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "A lista de tópicos não pode estar vazia.",
      },
    };
  }

  try {
    const result = await updateDoctorAnamnesisTopics(
      orgSlug,
      professionalId,
      payload,
    );
    revalidatePath(`/app/${encodeURIComponent(orgSlug)}/settings/anamnesis`);
    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof AnamnesisTopicsApiError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message },
      };
    }
    return {
      ok: false,
      error: {
        code: "UNAVAILABLE",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível salvar a estrutura de tópicos de anamnese.",
      },
    };
  }
}
