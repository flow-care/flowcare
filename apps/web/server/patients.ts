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
    readonly details?: unknown,
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

export const createPatientResponseSchema = z.object({
  patient: z.object({
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
  }),
});

export type CreatePatientResponse = z.infer<typeof createPatientResponseSchema>;

export interface CreatePatientInput {
  fullName: string;
  cpf: string;
  birthDate: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  distinctPersonConfirmed?: boolean;
  idempotencyKey?: string;
}

export const checkPatientDuplicatesResponseSchema = z.object({
  isDuplicate: z.boolean(),
  existingPatientId: z.string().nullable().optional(),
  conflictField: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
});

export type CheckPatientDuplicatesResponse = z.infer<
  typeof checkPatientDuplicatesResponseSchema
>;

export async function createPatient(
  orgSlug: string,
  input: CreatePatientInput,
): Promise<CreatePatientResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const idempotencyKey =
    input.idempotencyKey ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `patient_${Date.now()}`);

  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients`;

  const payload: Record<string, unknown> = {
    fullName: input.fullName.trim(),
    cpf: input.cpf.replace(/\D/g, "") || input.cpf,
    birthDate: input.birthDate,
    phone: input.phone.replace(/\D/g, "") || input.phone,
  };

  if (input.distinctPersonConfirmed !== undefined) {
    payload.distinctPersonConfirmed = input.distinctPersonConfirmed;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
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

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 409) {
      const err = json as {
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      const code = err?.error?.code || "POSSIBLE_DUPLICATE";
      const message =
        err?.error?.message ||
        "Foi encontrado um possível paciente duplicado nesta clínica.";
      throw new PatientsApiError(code, message, err?.error?.details);
    }

    if (response.status === 400) {
      const err = json as {
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      throw new PatientsApiError(
        err?.error?.code || "VALIDATION_ERROR",
        err?.error?.message || "Dados de cadastro inválidos.",
        err?.error?.details,
      );
    }

    if (response.status === 401) {
      throw new PatientsApiError(
        "UNAUTHENTICATED",
        "Entre novamente para continuar.",
      );
    }

    if (response.status === 403) {
      throw new PatientsApiError(
        "FORBIDDEN",
        "Você não tem permissão para cadastrar pacientes nesta clínica.",
      );
    }

    if (response.status === 404) {
      throw new PatientsApiError("NOT_FOUND", "Clínica não encontrada.");
    }

    const err = json as { error?: { code?: string; message?: string } } | null;
    throw new PatientsApiError(
      err?.error?.code || "UNAVAILABLE",
      err?.error?.message || "Não foi possível cadastrar o paciente.",
    );
  }

  const parsed = createPatientResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new PatientsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao criar paciente.",
    );
  }

  return parsed.data;
}

export async function checkPatientDuplicates(
  orgSlug: string,
  query: { document?: string; phone?: string },
): Promise<CheckPatientDuplicatesResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const document = query.document?.trim();
  const phone = query.phone?.trim();

  if (!document && !phone) {
    return { isDuplicate: false };
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/check-duplicates`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ...(document ? { document } : {}),
        ...(phone ? { phone } : {}),
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PatientsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de verificação de duplicidade.",
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new PatientsApiError(
        "UNAUTHENTICATED",
        "Entre novamente para continuar.",
      );
    }
    if (response.status === 403) {
      throw new PatientsApiError(
        "FORBIDDEN",
        "Você não tem permissão para verificar pacientes.",
      );
    }
    if (response.status === 404) {
      throw new PatientsApiError("NOT_FOUND", "Clínica não encontrada.");
    }
    throw new PatientsApiError(
      "UNAVAILABLE",
      "Não foi possível verificar duplicidades.",
    );
  }

  const json: unknown = await response.json().catch(() => null);

  const parsed = checkPatientDuplicatesResponseSchema.safeParse(json);
  if (parsed.success) {
    return parsed.data;
  }

  if (typeof json === "object" && json !== null) {
    const raw = json as Record<string, unknown>;
    const isDuplicate = Boolean(raw.isDuplicate ?? raw.duplicate);
    const existingPatientId =
      typeof raw.existingPatientId === "string"
        ? raw.existingPatientId
        : typeof raw.patientId === "string"
          ? raw.patientId
          : null;
    const conflictField =
      typeof raw.conflictField === "string"
        ? raw.conflictField
        : typeof raw.matchedOn === "string"
          ? raw.matchedOn
          : null;
    const message = typeof raw.message === "string" ? raw.message : null;

    return {
      isDuplicate,
      existingPatientId,
      conflictField,
      message,
    };
  }

  return { isDuplicate: false };
}
