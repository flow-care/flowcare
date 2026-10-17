import "server-only";

import { z } from "zod";
import { extractTopicsFromDraft } from "@/components/flowcare/consultations/anamnesis-review-utils";
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
      | "UNAVAILABLE"
      | "CONFLICT"
      | "VALIDATION_ERROR",
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

export const audioPresignedUrlInputSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024),
});
export type AudioPresignedUrlInput = z.infer<
  typeof audioPresignedUrlInputSchema
>;

export const audioPresignedUrlResponseSchema = z.object({
  audioId: z.string(),
  uploadUrl: z.string(),
  expiresInSeconds: z.number().optional(),
  status: z.string().optional(),
});
export type AudioPresignedUrlResponse = z.infer<
  typeof audioPresignedUrlResponseSchema
>;

export async function getAudioPresignedUrl(
  orgSlug: string,
  consultationId: string,
  body: { fileName: string; contentType: string; sizeBytes: number },
): Promise<AudioPresignedUrlResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new ConsultationsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Faça login novamente.",
    );
  }

  if (body.sizeBytes > 50 * 1024 * 1024) {
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "O arquivo de áudio excede o limite máximo permitido de 50MB.",
    );
  }

  let mappedContentType = body.contentType.toLowerCase();
  const lowerName = body.fileName.toLowerCase();
  if (mappedContentType.includes("webm") || lowerName.endsWith(".webm")) {
    mappedContentType = "audio/webm";
  } else if (
    mappedContentType.includes("mpeg") ||
    mappedContentType.includes("mp3") ||
    lowerName.endsWith(".mp3")
  ) {
    mappedContentType = "audio/mpeg";
  } else if (
    mappedContentType.includes("mp4") ||
    mappedContentType.includes("m4a") ||
    lowerName.endsWith(".m4a")
  ) {
    mappedContentType = "audio/mp4";
  } else if (mappedContentType.includes("wav") || lowerName.endsWith(".wav")) {
    mappedContentType = "audio/webm";
  } else {
    mappedContentType = "audio/webm";
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/consultations/${encodeURIComponent(consultationId)}/audio/upload-url`;

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
        contentType: mappedContentType,
        sizeBytes: body.sizeBytes,
        consentConfirmed: true,
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor para obter o link de envio do áudio.",
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
    let errorMsg = "Não foi possível preparar o envio do áudio.";
    try {
      const errData = (await response.json()) as { message?: string };
      if (errData?.message) errorMsg = errData.message;
    } catch {
      // Ignore json parse error
    }
    throw new ConsultationsApiError("UNAVAILABLE", errorMsg);
  }

  const data: unknown = await response.json();
  const parsed = audioPresignedUrlResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Resposta inválida do servidor ao preparar envio do áudio.",
    );
  }

  return parsed.data;
}

export async function completeAudioUpload(
  orgSlug: string,
  consultationId: string,
  audioId: string,
): Promise<{ audioId: string; status: "UPLOADED" }> {
  const token = await getSessionToken();
  if (!token) {
    throw new ConsultationsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Faça login novamente.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/consultations/${encodeURIComponent(consultationId)}/audio/${encodeURIComponent(audioId)}/complete`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
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
      "Não foi possível conectar ao servidor para concluir o envio do áudio.",
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
      throw new ConsultationsApiError("NOT_FOUND", "Áudio não encontrado.");
    }
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Não foi possível finalizar o envio do áudio.",
    );
  }

  return (await response.json()) as { audioId: string; status: "UPLOADED" };
}

export const startTranscriptionJobPayloadSchema = z.object({
  audioUrl: z.string().optional(),
  storageKey: z.string().optional(),
  consentConfirmed: z.boolean(),
  idempotencyKey: z.string().optional(),
});
export type StartTranscriptionJobPayload = z.infer<
  typeof startTranscriptionJobPayloadSchema
>;

export const transcriptionJobResponseSchema = z.object({
  jobId: z.string(),
  status: z.enum(["QUEUED", "PROCESSING", "COMPLETED", "FAILED"]),
});
export type TranscriptionJobResponse = z.infer<
  typeof transcriptionJobResponseSchema
>;

export async function startTranscriptionJob(
  orgSlug: string,
  consultationId: string,
  payload: {
    audioUrl?: string;
    storageKey?: string;
    consentConfirmed: boolean;
    idempotencyKey?: string;
  },
): Promise<TranscriptionJobResponse> {
  if (!payload.consentConfirmed) {
    throw new ConsultationsApiError(
      "FORBIDDEN",
      "Consentimento formal do paciente é obrigatório para iniciar a transcrição.",
    );
  }

  const token = await getSessionToken();
  if (!token) {
    throw new ConsultationsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Faça login novamente.",
    );
  }

  const idempotencyKey = payload.idempotencyKey?.trim() || crypto.randomUUID();

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/consultations/${encodeURIComponent(consultationId)}/transcribe`;

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
      body: JSON.stringify({
        audioUrl: payload.audioUrl,
        storageKey: payload.storageKey,
        consentConfirmed: true,
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao serviço de transcrição.",
    );
  }

  if (!response.ok && response.status !== 202) {
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
    let errorMsg = "Não foi possível iniciar o processamento da transcrição.";
    try {
      const errData = (await response.json()) as { message?: string };
      if (errData?.message) errorMsg = errData.message;
    } catch {
      // Ignore
    }
    throw new ConsultationsApiError("UNAVAILABLE", errorMsg);
  }

  const data: unknown = await response.json();
  const parsed = transcriptionJobResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Resposta inválida do serviço de transcrição.",
    );
  }

  return parsed.data;
}

export interface TranscriptionStatusResult {
  jobId: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  error?: string;
}

export async function getTranscriptionStatus(
  orgSlug: string,
  consultationId: string,
): Promise<TranscriptionStatusResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new ConsultationsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Faça login novamente.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/consultations/${encodeURIComponent(consultationId)}/transcription`;

  let response: Response | null = null;
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
    // Continue to fallback check
  }

  if (response?.ok) {
    const data: unknown = await response.json();
    const parsed = transcriptionJobResponseSchema.safeParse(data);
    if (parsed.success) {
      return parsed.data;
    }
  }

  // Fallback: check consultation details to determine status
  const details = await getConsultationDetails(orgSlug, consultationId);
  if (
    details.anamnesisStatus === "DRAFT" ||
    details.anamnesisStatus === "APPROVED" ||
    Boolean(details.anamnesisDraft)
  ) {
    return {
      jobId: details.id,
      status: "COMPLETED",
    };
  }

  if (details.status === "CANCELLED") {
    return {
      jobId: details.id,
      status: "FAILED",
      error: "Atendimento cancelado.",
    };
  }

  return {
    jobId: details.id,
    status: "PROCESSING",
  };
}

export const anamnesisDraftDataSchema = z.object({
  consultationId: z.string(),
  version: z.number(),
  status: consultationStatusSchema,
  anamnesisStatus: anamnesisStatusSchema,
  chiefComplaint: z.string().nullable().optional(),
  clinicalNotes: z.string().nullable().optional(),
  topics: z.record(z.string(), z.string()),
  draftSavedAt: z.string().nullable().optional(),
  draftSavedById: z.string().nullable().optional(),
  approvedAt: z.string().nullable().optional(),
  approvedById: z.string().nullable().optional(),
  signedBy: z.string().nullable().optional(),
  snapshotHash: z.string().nullable().optional(),
  anamnesisSnapshot: z.unknown().optional(),
  patient: consultationPatientSchema.optional(),
  professional: consultationProfessionalSchema.optional(),
});
export type AnamnesisDraftData = z.infer<typeof anamnesisDraftDataSchema>;

export { extractTopicsFromDraft };

export async function getAnamnesisDraft(
  orgSlug: string,
  consultationId: string,
): Promise<AnamnesisDraftData> {
  const details = await getConsultationDetails(orgSlug, consultationId);
  const topics = extractTopicsFromDraft(
    details.anamnesisDraft,
    details.anamnesisSnapshot,
    details.chiefComplaint,
    details.clinicalNotes,
  );

  return {
    consultationId: details.id,
    version: details.version ?? 0,
    status: details.status,
    anamnesisStatus: details.anamnesisStatus,
    chiefComplaint: details.chiefComplaint ?? null,
    clinicalNotes: details.clinicalNotes ?? null,
    topics,
    draftSavedAt: details.draftSavedAt ?? null,
    draftSavedById: details.draftSavedById ?? null,
    approvedAt: details.approvedAt ?? null,
    approvedById: details.approvedById ?? null,
    signedBy: details.signedBy ?? null,
    snapshotHash: details.snapshotHash ?? null,
    anamnesisSnapshot: details.anamnesisSnapshot ?? null,
    patient: details.patient,
    professional: details.professional,
  };
}

export interface UpdateAnamnesisDraftPayload {
  content: Record<string, string> | string;
  version: number;
  chiefComplaint?: string;
  clinicalNotes?: string;
}

export async function updateAnamnesisDraft(
  orgSlug: string,
  consultationId: string,
  payload: UpdateAnamnesisDraftPayload,
): Promise<ConsultationDetail> {
  const token = await getSessionToken();
  if (!token) {
    throw new ConsultationsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Faça login novamente.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/consultations/${encodeURIComponent(consultationId)}/anamnesis/draft`;

  let topics: Record<string, string | null> = {};
  let chiefComplaint = payload.chiefComplaint;
  let clinicalNotes = payload.clinicalNotes;

  if (typeof payload.content === "string") {
    topics = { content: payload.content };
  } else if (payload.content && typeof payload.content === "object") {
    topics = { ...payload.content };
    if (
      !chiefComplaint &&
      (payload.content.chief_complaint ||
        payload.content.chiefComplaint ||
        payload.content.queixa_principal)
    ) {
      chiefComplaint =
        payload.content.chief_complaint ||
        payload.content.chiefComplaint ||
        payload.content.queixa_principal;
    }
    if (
      !clinicalNotes &&
      (payload.content.conduct ||
        payload.content.conduta ||
        payload.content.clinical_notes ||
        payload.content.clinicalNotes)
    ) {
      clinicalNotes =
        payload.content.conduct ||
        payload.content.conduta ||
        payload.content.clinical_notes ||
        payload.content.clinicalNotes;
    }
  }

  const requestBody = {
    version: payload.version,
    topics,
    ...(chiefComplaint !== undefined ? { chiefComplaint } : {}),
    ...(clinicalNotes !== undefined ? { clinicalNotes } : {}),
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
      body: JSON.stringify(requestBody),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor para salvar o rascunho da anamnese.",
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
        "Acesso restrito à equipe clínica autorizada.",
      );
    }
    if (response.status === 404) {
      throw new ConsultationsApiError(
        "NOT_FOUND",
        "Atendimento não encontrado.",
      );
    }
    if (response.status === 409) {
      let errorMsg =
        "O rascunho da anamnese foi alterado por outra sessão. Recarregue antes de salvar.";
      try {
        const errJson = (await response.json()) as { message?: string };
        if (errJson?.message) errorMsg = errJson.message;
      } catch {}
      throw new ConsultationsApiError("CONFLICT", errorMsg);
    }
    if (response.status === 400) {
      let errorMsg = "Dados inválidos para o rascunho da anamnese.";
      try {
        const errJson = (await response.json()) as { message?: string };
        if (errJson?.message) errorMsg = errJson.message;
      } catch {}
      throw new ConsultationsApiError("VALIDATION_ERROR", errorMsg);
    }
    let errorMsg = "Não foi possível salvar o rascunho da anamnese.";
    try {
      const errJson = (await response.json()) as { message?: string };
      if (errJson?.message) errorMsg = errJson.message;
    } catch {}
    throw new ConsultationsApiError("UNAVAILABLE", errorMsg);
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
      "Resposta inválida do servidor ao salvar rascunho.",
    );
  }
  return parsed.data;
}

export interface ApproveAnamnesisPayload {
  version: number;
  content?: Record<string, string> | string;
  chiefComplaint?: string;
  clinicalNotes?: string;
}

export const approveAnamnesisResponseSchema = z.object({
  status: z.literal("APPROVED"),
  signedBy: z.string(),
  approvedAt: z.string(),
  consultationId: z.string(),
  version: z.number(),
  snapshotHash: z.string(),
  snapshot: z.unknown().optional(),
  consultation: consultationDetailSchema.optional(),
});
export type ApproveAnamnesisResponse = z.infer<
  typeof approveAnamnesisResponseSchema
>;

export async function approveAnamnesis(
  orgSlug: string,
  consultationId: string,
  payload: ApproveAnamnesisPayload,
): Promise<ApproveAnamnesisResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new ConsultationsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Faça login novamente.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/consultations/${encodeURIComponent(consultationId)}/anamnesis/approve`;

  let topics: Record<string, string | null> | undefined;
  let chiefComplaint = payload.chiefComplaint;
  let clinicalNotes = payload.clinicalNotes;

  if (payload.content) {
    if (typeof payload.content === "string") {
      topics = { content: payload.content };
    } else if (typeof payload.content === "object") {
      topics = { ...payload.content };
      if (
        !chiefComplaint &&
        (payload.content.chief_complaint ||
          payload.content.chiefComplaint ||
          payload.content.queixa_principal)
      ) {
        chiefComplaint =
          payload.content.chief_complaint ||
          payload.content.chiefComplaint ||
          payload.content.queixa_principal;
      }
      if (
        !clinicalNotes &&
        (payload.content.conduct ||
          payload.content.conduta ||
          payload.content.clinical_notes ||
          payload.content.clinicalNotes)
      ) {
        clinicalNotes =
          payload.content.conduct ||
          payload.content.conduta ||
          payload.content.clinical_notes ||
          payload.content.clinicalNotes;
      }
    }
  }

  const requestBody = {
    version: payload.version,
    ...(topics !== undefined ? { topics } : {}),
    ...(chiefComplaint !== undefined ? { chiefComplaint } : {}),
    ...(clinicalNotes !== undefined ? { clinicalNotes } : {}),
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor para aprovar a anamnese.",
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
        "Acesso restrito à equipe clínica autorizada.",
      );
    }
    if (response.status === 404) {
      throw new ConsultationsApiError(
        "NOT_FOUND",
        "Atendimento não encontrado.",
      );
    }
    if (response.status === 409) {
      let errorMsg =
        "A consulta foi alterada por outra sessão. Recarregue antes de aprovar.";
      try {
        const errJson = (await response.json()) as { message?: string };
        if (errJson?.message) errorMsg = errJson.message;
      } catch {}
      throw new ConsultationsApiError("CONFLICT", errorMsg);
    }
    if (response.status === 400) {
      let errorMsg =
        "Tópicos obrigatórios da anamnese devem estar preenchidos antes da aprovação.";
      try {
        const errJson = (await response.json()) as { message?: string };
        if (errJson?.message) errorMsg = errJson.message;
      } catch {}
      throw new ConsultationsApiError("VALIDATION_ERROR", errorMsg);
    }
    let errorMsg = "Não foi possível aprovar a anamnese.";
    try {
      const errJson = (await response.json()) as { message?: string };
      if (errJson?.message) errorMsg = errJson.message;
    } catch {}
    throw new ConsultationsApiError("UNAVAILABLE", errorMsg);
  }

  const data: unknown = await response.json();
  const parsed = approveAnamnesisResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new ConsultationsApiError(
      "UNAVAILABLE",
      "Resposta inválida do servidor ao aprovar a anamnese.",
    );
  }
  return parsed.data;
}
