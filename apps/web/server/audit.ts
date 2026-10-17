import "server-only";

import type { ListAuditLogsResponse } from "../lib/audit";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export class AuditApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuditApiError";
  }
}

export interface AuditLogsQueryParams {
  action?: string;
  targetType?: string;
  targetId?: string;
  actorUserId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export async function getAuditLogs(
  orgSlug: string,
  query?: AuditLogsQueryParams,
): Promise<ListAuditLogsResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new AuditApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams();

  if (query?.action?.trim()) {
    searchParams.set("action", query.action.trim());
  }
  if (query?.targetType?.trim()) {
    searchParams.set("targetType", query.targetType.trim());
  }
  if (query?.targetId?.trim()) {
    searchParams.set("targetId", query.targetId.trim());
  }
  if (query?.actorUserId?.trim()) {
    searchParams.set("actorUserId", query.actorUserId.trim());
  }
  if (query?.startDate?.trim()) {
    searchParams.set("startDate", query.startDate.trim());
  }
  if (query?.endDate?.trim()) {
    searchParams.set("endDate", query.endDate.trim());
  }
  if (query?.page && query.page >= 1) {
    searchParams.set("page", String(query.page));
  }
  if (query?.limit && query.limit >= 1 && query.limit <= 100) {
    searchParams.set("limit", String(query.limit));
  }

  const queryString = searchParams.toString();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/audit-logs${queryString ? `?${queryString}` : ""}`;

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
    throw new AuditApiError(
      "UNAVAILABLE",
      "Não foi possível carregar a trilha de auditoria. Tente novamente.",
    );
  }

  if (!response.ok) {
    let errorCode = "UNAVAILABLE";
    let errorMessage =
      "Não foi possível carregar a trilha de auditoria da clínica.";

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
      // Fallback to status-based code
    }

    if (response.status === 401) {
      throw new AuditApiError(
        "UNAUTHENTICATED",
        "Entre novamente para continuar.",
      );
    }
    if (response.status === 403) {
      throw new AuditApiError(
        "FORBIDDEN",
        errorMessage || "Acesso restrito a administradores da clínica.",
      );
    }
    if (response.status === 404) {
      throw new AuditApiError("NOT_FOUND", "Clínica não encontrada.");
    }
    if (response.status === 400) {
      throw new AuditApiError(
        "VALIDATION_ERROR",
        errorMessage || "Parâmetros de busca inválidos.",
      );
    }

    throw new AuditApiError(errorCode, errorMessage);
  }

  const json = (await response.json()) as ListAuditLogsResponse;
  const data = Array.isArray(json?.data) ? json.data : [];
  const pagination = json?.pagination ??
    json?.pageInfo ?? {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      totalCount: data.length,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    };

  return {
    data,
    pagination,
    pageInfo: pagination,
  };
}
