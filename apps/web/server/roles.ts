import "server-only";

import {
  type OrganizationRolesData,
  organizationRolesResponseSchema,
} from "../lib/roles";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export class RolesApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RolesApiError";
  }
}

export async function getOrganizationRoles(
  orgSlug: string,
): Promise<OrganizationRolesData> {
  const token = await getSessionToken();
  if (!token) {
    throw new RolesApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/roles`;

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
    throw new RolesApiError(
      "UNAVAILABLE",
      "Não foi possível carregar os papéis da clínica. Tente novamente.",
    );
  }

  if (!response.ok) {
    let errorCode = "UNAVAILABLE";
    let errorMessage = "Não foi possível carregar os papéis da clínica.";

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
      throw new RolesApiError(
        "UNAUTHENTICATED",
        "Entre novamente para continuar.",
      );
    }
    if (response.status === 403) {
      throw new RolesApiError(
        "FORBIDDEN",
        errorMessage || "Acesso restrito a administradores da clínica.",
      );
    }
    if (response.status === 404) {
      throw new RolesApiError("NOT_FOUND", "Clínica não encontrada.");
    }

    throw new RolesApiError(errorCode, errorMessage);
  }

  const json = await response.json();
  const parsed = organizationRolesResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new RolesApiError(
      "PARSE_ERROR",
      "Os dados de papéis retornados pelo servidor são inválidos.",
    );
  }

  return parsed.data;
}
