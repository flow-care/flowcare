import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export const consultationStatusSchema = z.enum([
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);
export type ConsultationStatus = z.infer<typeof consultationStatusSchema>;

export const anamnesisStatusSchema = z.enum(["PENDING", "DRAFT", "APPROVED"]);
export type AnamnesisStatus = z.infer<typeof anamnesisStatusSchema>;

export const consultationListItemSchema = z.object({
  id: z.string(),
  appointmentId: z.string().nullable(),
  patientId: z.string(),
  professionalId: z.string(),
  scheduledAt: z.string(),
  localScheduledAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  status: consultationStatusSchema,
  anamnesisStatus: anamnesisStatusSchema,
  patient: z.object({
    id: z.string(),
    fullName: z.string(),
  }),
  professional: z.object({
    id: z.string(),
    fullName: z.string(),
    professionalTitle: z.string().nullable(),
    registrationNumber: z.string().nullable(),
  }),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConsultationListItem = z.infer<typeof consultationListItemSchema>;

export const consultationsPageInfoSchema = z.object({
  limit: z.number(),
  page: z.number(),
  totalCount: z.number(),
  hasNextPage: z.boolean(),
  nextCursor: z.string().nullable(),
});
export type ConsultationsPageInfo = z.infer<typeof consultationsPageInfoSchema>;

export const listConsultationsResponseSchema = z.object({
  timeZone: z.string(),
  data: z.array(consultationListItemSchema),
  items: z.array(consultationListItemSchema),
  pageInfo: consultationsPageInfoSchema,
});
export type ListConsultationsResponse = z.infer<
  typeof listConsultationsResponseSchema
>;

export class ConsultationsApiError extends Error {
  constructor(
    readonly code:
      | "UNAUTHENTICATED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}

export function resolvePeriodDates(
  period?: string,
  now: Date = new Date(),
): { startDate?: string; endDate?: string } {
  if (!period) return {};
  const norm = period.toLowerCase().trim();
  const formatYmd = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  const todayStr = formatYmd(now);
  const [yearStr, monthStr, dayStr] = todayStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (norm === "today" || norm === "hoje") {
    return { startDate: todayStr, endDate: todayStr };
  }
  if (
    norm === "week" ||
    norm === "esta-semana" ||
    norm === "esta semana" ||
    norm === "semana"
  ) {
    const utcDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const dayOfWeek = utcDate.getUTCDay();
    const diffToMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(utcDate);
    monday.setUTCDate(utcDate.getUTCDate() - diffToMonday);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return {
      startDate: monday.toISOString().slice(0, 10),
      endDate: sunday.toISOString().slice(0, 10),
    };
  }
  if (norm === "month" || norm === "mes" || norm === "mês") {
    const firstDay = `${yearStr}-${monthStr}-01`;
    const nextMonthFirst = new Date(Date.UTC(year, month, 1, 12, 0, 0));
    const lastDayDate = new Date(
      nextMonthFirst.getTime() - 24 * 60 * 60 * 1000,
    );
    const lastDayStr = lastDayDate.toISOString().slice(0, 10);
    return { startDate: firstDay, endDate: lastDayStr };
  }
  return {};
}

export interface GetConsultationsQuery {
  period?: string;
  status?: string;
  cursor?: string;
  limit?: number;
  page?: number;
}

export async function getConsultations(
  orgSlug: string,
  query: GetConsultationsQuery = {},
): Promise<ListConsultationsResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new ConsultationsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Faça login novamente.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = new URL(
    `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/consultations`,
  );

  const { startDate, endDate } = resolvePeriodDates(query.period);
  if (startDate) url.searchParams.set("startDate", startDate);
  if (endDate) url.searchParams.set("endDate", endDate);
  if (query.period) url.searchParams.set("period", query.period);

  if (query.status && query.status !== "ALL" && query.status !== "all") {
    url.searchParams.set("status", query.status);
  }
  if (query.cursor) {
    url.searchParams.set("cursor", query.cursor);
  }
  if (query.limit) {
    url.searchParams.set("limit", String(query.limit));
  }
  if (query.page) {
    url.searchParams.set("page", String(query.page));
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
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
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de consultas.",
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ConsultationsApiError(
        "UNAUTHENTICATED",
        "Sessão expirada. Faça login novamente.",
      );
    }
    if (response.status === 403) {
      throw new ConsultationsApiError(
        "FORBIDDEN",
        "Acesso restrito à equipe clínica.",
      );
    }
    if (response.status === 404) {
      throw new ConsultationsApiError("NOT_FOUND", "Clínica não encontrada.");
    }
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Não foi possível carregar as consultas da clínica.",
    );
  }

  const data: unknown = await response.json();
  const parsed = listConsultationsResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Resposta inválida do servidor de consultas.",
    );
  }

  return parsed.data;
}

export const consultationPatientSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  birthDate: z.string().nullable().optional(),
  cpf: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  healthInsurance: z.string().nullable().optional(),
  insuranceNumber: z.string().nullable().optional(),
  allergies: z.array(z.string()).optional(),
  clinicalAlerts: z.array(z.string()).optional(),
});
export type ConsultationPatient = z.infer<typeof consultationPatientSchema>;

export const consultationProfessionalSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  professionalTitle: z.string().nullable().optional(),
  registrationNumber: z.string().nullable().optional(),
});
export type ConsultationProfessional = z.infer<
  typeof consultationProfessionalSchema
>;

export const consultationDetailSchema = z.object({
  id: z.string(),
  consultationId: z.string().optional(),
  organizationId: z.string().optional(),
  appointmentId: z.string().nullable().optional(),
  patientId: z.string(),
  professionalId: z.string(),
  scheduledAt: z.string(),
  localScheduledAt: z.string().optional(),
  startedAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  status: consultationStatusSchema,
  anamnesisStatus: anamnesisStatusSchema,
  anamnesisTopicRevisionId: z.string().nullable().optional(),
  chiefComplaint: z.string().nullable().optional(),
  clinicalNotes: z.string().nullable().optional(),
  anamnesisDraft: z.unknown().optional(),
  draftSavedAt: z.string().nullable().optional(),
  draftSavedById: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  approvedById: z.string().nullable().optional(),
  signedBy: z.string().nullable().optional(),
  anamnesisSnapshot: z.unknown().optional(),
  snapshotHash: z.string().nullable().optional(),
  version: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  patient: consultationPatientSchema.optional(),
  professional: consultationProfessionalSchema.optional(),
});
export type ConsultationDetail = z.infer<typeof consultationDetailSchema>;

export async function getConsultationDetails(
  orgSlug: string,
  consultationId: string,
): Promise<ConsultationDetail> {
  const token = await getSessionToken();
  if (!token) {
    throw new ConsultationsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Faça login novamente.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/consultations/${encodeURIComponent(consultationId)}`;

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
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de consultas.",
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ConsultationsApiError(
        "UNAUTHENTICATED",
        "Sessão expirada. Faça login novamente.",
      );
    }
    if (response.status === 403) {
      throw new ConsultationsApiError(
        "FORBIDDEN",
        "Acesso restrito à equipe clínica.",
      );
    }
    if (response.status === 404) {
      throw new ConsultationsApiError(
        "NOT_FOUND",
        "Atendimento não encontrado.",
      );
    }
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Não foi possível carregar os detalhes do atendimento.",
    );
  }

  const data: unknown = await response.json();
  const raw =
    data &&
    typeof data === "object" &&
    "consultation" in data &&
    data.consultation
      ? data.consultation
      : data;
  const parsed = consultationDetailSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Resposta inválida do servidor de consultas.",
    );
  }

  return parsed.data;
}
