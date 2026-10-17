import "server-only";

import {
  type DoctorAnamnesisTopicsResponse,
  doctorAnamnesisTopicsResponseSchema,
  isMandatoryTopic,
  mergeWithDefaultTopics,
  type UpdateDoctorAnamnesisTopicsPayload,
} from "@/lib/anamnesis-topics";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export class AnamnesisTopicsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AnamnesisTopicsApiError";
  }
}

export async function getDoctorAnamnesisTopics(
  orgSlug: string,
  professionalId: string,
): Promise<DoctorAnamnesisTopicsResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new AnamnesisTopicsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/professionals/${encodeURIComponent(professionalId)}/anamnesis-topics`;

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
    throw new AnamnesisTopicsApiError(
      "UNAVAILABLE",
      "Não foi possível carregar os tópicos de anamnese. Verifique sua conexão e tente novamente.",
    );
  }

  if (!response.ok) {
    let errorCode = "UNAVAILABLE";
    let errorMessage = "Não foi possível carregar os tópicos de anamnese.";

    try {
      const errorJson = (await response.json()) as {
        error?: { code?: string; message?: string };
        message?: string;
      };
      if (errorJson?.error?.code) {
        errorCode = errorJson.error.code;
      }
      if (errorJson?.error?.message) {
        errorMessage = errorJson.error.message;
      } else if (errorJson?.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      // Ignore JSON parse error and fallback
    }

    if (response.status === 401) {
      throw new AnamnesisTopicsApiError(
        "UNAUTHENTICATED",
        "Entre novamente para continuar.",
      );
    }
    if (response.status === 403) {
      throw new AnamnesisTopicsApiError(
        "PERMISSION_DENIED",
        errorMessage ||
          "Você não tem permissão para visualizar estas configurações de anamnese.",
      );
    }
    if (response.status === 404) {
      throw new AnamnesisTopicsApiError(
        "NOT_FOUND",
        errorMessage || "Profissional ou organização não encontrado.",
      );
    }

    throw new AnamnesisTopicsApiError(errorCode, errorMessage);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AnamnesisTopicsApiError(
      "UNAVAILABLE",
      "Resposta inválida do serviço de anamnese.",
    );
  }

  const parsed = doctorAnamnesisTopicsResponseSchema.safeParse(data);
  if (!parsed.success) {
    // If the backend returns partial or empty list, merge with defaults
    return {
      professionalId,
      version: 0,
      revisionId: null,
      topics: mergeWithDefaultTopics([]),
    };
  }

  return {
    ...parsed.data,
    topics: mergeWithDefaultTopics(parsed.data.topics),
  };
}

export async function updateDoctorAnamnesisTopics(
  orgSlug: string,
  professionalId: string,
  payload: UpdateDoctorAnamnesisTopicsPayload,
): Promise<DoctorAnamnesisTopicsResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new AnamnesisTopicsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  // Client and server side mandatory topic check
  const chiefComplaint = payload.topics.find(
    (t) => t.key === "chief_complaint",
  );
  const conduct = payload.topics.find((t) => t.key === "conduct");

  if (!chiefComplaint || chiefComplaint.active === false) {
    throw new AnamnesisTopicsApiError(
      "VALIDATION_ERROR",
      "O tópico obrigatório 'Queixa Principal' não pode ser removido ou desativado.",
    );
  }

  if (!conduct || conduct.active === false) {
    throw new AnamnesisTopicsApiError(
      "VALIDATION_ERROR",
      "O tópico obrigatório 'Conduta' não pode ser removido ou desativado.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/professionals/${encodeURIComponent(professionalId)}/anamnesis-topics`;

  const body = {
    version: payload.version ?? 0,
    topics: payload.topics.map((t) => ({
      key: t.key,
      label: t.label.trim(),
      active: isMandatoryTopic(t.key) ? true : (t.active ?? true),
    })),
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AnamnesisTopicsApiError(
      "UNAVAILABLE",
      "Não foi possível salvar os tópicos de anamnese. Verifique sua conexão e tente novamente.",
    );
  }

  if (!response.ok) {
    let errorCode = "UNAVAILABLE";
    let errorMessage = "Não foi possível salvar os tópicos de anamnese.";

    try {
      const errorJson = (await response.json()) as {
        error?: { code?: string; message?: string };
        message?: string;
      };
      if (errorJson?.error?.code) {
        errorCode = errorJson.error.code;
      }
      if (errorJson?.error?.message) {
        errorMessage = errorJson.error.message;
      } else if (errorJson?.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      // Ignore JSON parse error
    }

    if (response.status === 401) {
      throw new AnamnesisTopicsApiError(
        "UNAUTHENTICATED",
        "Entre novamente para continuar.",
      );
    }
    if (response.status === 403) {
      throw new AnamnesisTopicsApiError(
        "PERMISSION_DENIED",
        errorMessage ||
          "Configuração disponível apenas ao próprio profissional.",
      );
    }
    if (response.status === 409) {
      throw new AnamnesisTopicsApiError(
        "VERSION_CONFLICT",
        "A configuração foi alterada em outro acesso. Recarregue e tente novamente.",
      );
    }
    if (response.status === 400) {
      throw new AnamnesisTopicsApiError(
        "VALIDATION_ERROR",
        errorMessage || "Dados de tópicos inválidos.",
      );
    }

    throw new AnamnesisTopicsApiError(errorCode, errorMessage);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new AnamnesisTopicsApiError(
      "UNAVAILABLE",
      "Resposta inválida do serviço de anamnese ao salvar.",
    );
  }

  const parsed = doctorAnamnesisTopicsResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new AnamnesisTopicsApiError(
      "UNAVAILABLE",
      "Resposta incompatível do serviço de anamnese.",
    );
  }

  return {
    ...parsed.data,
    topics: mergeWithDefaultTopics(parsed.data.topics),
  };
}
