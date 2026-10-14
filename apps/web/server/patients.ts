import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export const patientItemSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  cpf: z.string(),
  birthDate: z.string(),
  phone: z.string(),
  email: z.string().nullable().optional(),
  healthInsurance: z.string().nullable().optional(),
  insuranceNumber: z.string().nullable().optional(),
  version: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type PatientItem = z.infer<typeof patientItemSchema>;

export const listPatientsResponseSchema = z.object({
  data: z.array(patientItemSchema),
  pageInfo: z.object({
    nextCursor: z.string().nullable(),
    hasNextPage: z.boolean(),
  }),
});

export type ListPatientsResponse = z.infer<typeof listPatientsResponseSchema>;

export interface GetPatientsQuery {
  search?: string;
  cursor?: string;
  limit?: number;
}

export class PatientsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PatientsApiError";
  }
}

export async function getPatients(
  orgSlug: string,
  query: GetPatientsQuery = {},
): Promise<ListPatientsResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams();

  if (query.search?.trim()) {
    searchParams.set("search", query.search.trim());
  }
  if (query.cursor) {
    searchParams.set("cursor", query.cursor);
  }
  if (query.limit && Number.isInteger(query.limit)) {
    searchParams.set("limit", String(query.limit));
  }

  const queryString = searchParams.toString();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients${
    queryString ? `?${queryString}` : ""
  }`;

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
    throw new PatientsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de pacientes.",
    );
  }

  if (!response.ok) {
    const code =
      response.status === 401
        ? "UNAUTHENTICATED"
        : response.status === 403
          ? "FORBIDDEN"
          : response.status === 404
            ? "NOT_FOUND"
            : "UNAVAILABLE";
    throw new PatientsApiError(
      code,
      code === "FORBIDDEN"
        ? "Você não tem permissão para visualizar os pacientes desta clínica."
        : code === "NOT_FOUND"
          ? "Clínica não encontrada."
          : "Não foi possível carregar os pacientes.",
    );
  }

  const data: unknown = await response.json().catch(() => null);
  const parsed = listPatientsResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new PatientsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor de pacientes.",
    );
  }

  return parsed.data;
}
