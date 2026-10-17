import "server-only";

import type { ClinicUsageQuery, ClinicUsageResponse } from "../lib/usage";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export class UsageApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UsageApiError";
  }
}

export async function getTranscriptionUsage(
  orgSlug: string,
  query?: ClinicUsageQuery,
): Promise<ClinicUsageResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new UsageApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams();

  if (query?.month?.trim()) {
    searchParams.set("month", query.month.trim());
  }

  const queryString = searchParams.toString();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/settings/usage${queryString ? `?${queryString}` : ""}`;

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
    throw new UsageApiError(
      "UNAVAILABLE",
      "Não foi possível carregar as métricas de consumo de transcrição. Tente novamente.",
    );
  }

  if (!response.ok) {
    let errorCode = "UNAVAILABLE";
    let errorMessage =
      "Não foi possível carregar as métricas de consumo da clínica.";

    try {
      const errorJson = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      if (errorJson?.error?.code) {
        errorCode = errorJson.error.code;
      }
      if (errorJson?.error?.message) {
        errorMessage = errorJson.error.message;
      }
    } catch {
      // Fallback
    }

    if (response.status === 401) {
      throw new UsageApiError(
        "UNAUTHENTICATED",
        "Entre novamente para continuar.",
      );
    }
    if (response.status === 403) {
      throw new UsageApiError(
        "FORBIDDEN",
        errorMessage || "Acesso restrito a administradores da clínica.",
      );
    }
    if (response.status === 404) {
      throw new UsageApiError("NOT_FOUND", "Clínica não encontrada.");
    }
    if (response.status === 400) {
      throw new UsageApiError(
        "VALIDATION_ERROR",
        errorMessage || "Parâmetros de busca inválidos.",
      );
    }

    throw new UsageApiError(errorCode, errorMessage);
  }

  const json = (await response.json()) as ClinicUsageResponse;
  return {
    month: json.month,
    timeZone: json.timeZone,
    periodStart: json.periodStart,
    periodEnd: json.periodEnd,
    processedSeconds: json.processedSeconds ?? 0,
    processedMinutes: json.processedMinutes ?? 0,
    successfulAudioCount: json.successfulAudioCount ?? 0,
    transcribedConsultations: json.transcribedConsultations ?? 0,
    failedAudioCount: json.failedAudioCount ?? 0,
    byProfessional: Array.isArray(json.byProfessional)
      ? json.byProfessional
      : [],
  };
}
