import "server-only";

import type { z } from "zod";
import {
  qrTtlMs,
  type WhatsAppConnectionStatus,
  type WhatsAppMessageStatus,
  type WhatsAppMessagesPage,
  type WhatsAppStatus,
  type WhatsAppTemplateItem,
  type WhatsAppTemplateType,
  whatsappMessagesResponseSchema,
  whatsappReconnectSchema,
  whatsappResendSchema,
  whatsappStatusSchema,
  whatsappTemplateItemSchema,
  whatsappTemplatesResponseSchema,
} from "@/lib/whatsapp";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export type WhatsAppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "MESSAGE_STATE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "VERSION_CONFLICT"
  | "INVALID_TEMPLATE_STRUCTURE"
  | "INVALID_TEMPLATE_VARIABLE"
  | "COMMUNICATION_PROVIDER_UNAVAILABLE"
  | "INVALID_RESPONSE"
  | "UNAVAILABLE";

export class WhatsAppApiError extends Error {
  constructor(
    readonly code: WhatsAppErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<WhatsAppErrorCode>([
  "VALIDATION_ERROR",
  "MESSAGE_STATE_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "VERSION_CONFLICT",
  "INVALID_TEMPLATE_STRUCTURE",
  "INVALID_TEMPLATE_VARIABLE",
  "COMMUNICATION_PROVIDER_UNAVAILABLE",
]);

const FRIENDLY_MESSAGES: Partial<Record<WhatsAppErrorCode, string>> = {
  MESSAGE_STATE_CONFLICT: "Esta mensagem não pode mais ser reenviada.",
  IDEMPOTENCY_CONFLICT:
    "Esta tentativa já foi usada em outra mensagem. Tente novamente.",
  VERSION_CONFLICT:
    "O texto foi alterado por outra pessoa. Recarregue a página e tente novamente.",
  COMMUNICATION_PROVIDER_UNAVAILABLE:
    "O serviço de WhatsApp está indisponível no momento. Tente novamente em instantes.",
};

interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Never logs or echoes response bodies: QR codes and session data pass
 * through here, and upstream bodies may contain provider details.
 */
async function request<T>(
  orgSlug: string,
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const token = await getSessionToken();
  if (!token) {
    throw new WhatsAppApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
      401,
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/communications${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...options.headers,
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
  } catch {
    throw new WhatsAppApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor. Tente novamente.",
    );
  }

  if (!response.ok) throw await toApiError(response);

  const json: unknown = await response.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new WhatsAppApiError(
      "INVALID_RESPONSE",
      "Resposta inválida recebida do servidor.",
    );
  }
  return parsed.data;
}

async function toApiError(response: Response): Promise<WhatsAppApiError> {
  const status = response.status;
  if (status === 401) {
    return new WhatsAppApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
      status,
    );
  }
  if (status === 403) {
    return new WhatsAppApiError(
      "FORBIDDEN",
      "Você não tem permissão para realizar esta ação.",
      status,
    );
  }
  if (status === 404) {
    return new WhatsAppApiError(
      "NOT_FOUND",
      "Registro não encontrado.",
      status,
    );
  }

  let code = "";
  let message = "";
  if (status < 500) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: unknown; message?: unknown };
    } | null;
    if (typeof body?.error?.code === "string") code = body.error.code;
    if (typeof body?.error?.message === "string") message = body.error.message;
  }

  if (status === 503 || code === "COMMUNICATION_PROVIDER_UNAVAILABLE") {
    return new WhatsAppApiError(
      "COMMUNICATION_PROVIDER_UNAVAILABLE",
      FRIENDLY_MESSAGES.COMMUNICATION_PROVIDER_UNAVAILABLE ?? "",
      status,
    );
  }
  if (KNOWN_CODES.has(code)) {
    const known = code as WhatsAppErrorCode;
    return new WhatsAppApiError(
      known,
      FRIENDLY_MESSAGES[known] ||
        message ||
        "Não foi possível concluir a operação.",
      status,
    );
  }
  return new WhatsAppApiError(
    "UNAVAILABLE",
    "Não foi possível concluir a operação. Tente novamente.",
    status,
  );
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export async function getWhatsAppStatus(
  orgSlug: string,
): Promise<WhatsAppStatus> {
  return request(orgSlug, "/whatsapp/status", whatsappStatusSchema);
}

export interface WhatsAppQrSession {
  status: WhatsAppConnectionStatus;
  phoneNumber: string | null;
  qrCode: string | null;
  /** Milliseconds of validity left, computed on the server. */
  qrExpiresInMs: number;
}

export async function requestWhatsAppQr(
  orgSlug: string,
): Promise<WhatsAppQrSession> {
  const session = await request(
    orgSlug,
    "/whatsapp/reconnect",
    whatsappReconnectSchema,
    { method: "POST", timeoutMs: 20_000 },
  );
  return {
    status: session.status,
    phoneNumber: session.phoneNumber,
    qrCode: session.qrCode,
    qrExpiresInMs: session.qrCode ? qrTtlMs(session.qrExpiresAt) : 0,
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface ListWhatsAppMessagesQuery {
  status?: WhatsAppMessageStatus;
  from?: string;
  cursor?: string;
  limit?: number;
}

export async function listWhatsAppMessages(
  orgSlug: string,
  query: ListWhatsAppMessagesQuery = {},
): Promise<WhatsAppMessagesPage> {
  const search = new URLSearchParams();
  if (query.status) search.set("status", query.status);
  if (query.from) search.set("from", query.from);
  if (query.cursor) search.set("cursor", query.cursor);
  if (query.limit) search.set("limit", String(query.limit));
  const qs = search.toString();
  return request(
    orgSlug,
    `/messages${qs ? `?${qs}` : ""}`,
    whatsappMessagesResponseSchema,
  );
}

export async function resendWhatsAppMessage(
  orgSlug: string,
  messageId: string,
  idempotencyKey: string,
): Promise<{ status: "QUEUED" }> {
  const result = await request(
    orgSlug,
    `/messages/${encodeURIComponent(messageId)}/resend`,
    whatsappResendSchema,
    { method: "POST", headers: { "Idempotency-Key": idempotencyKey } },
  );
  return { status: result.status };
}

/** Best effort: names are only decoration, the list renders without them. */
export async function getPatientNames(
  orgSlug: string,
  patientIds: readonly string[],
): Promise<Map<string, string>> {
  const token = await getSessionToken();
  const names = new Map<string, string>();
  if (!token) return names;

  const { apiBaseUrl } = getServerConfig();
  const unique = [...new Set(patientIds)];
  await Promise.allSettled(
    unique.map(async (patientId) => {
      const response = await fetch(
        `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) return;
      const body = (await response.json().catch(() => null)) as {
        fullName?: unknown;
        patient?: { fullName?: unknown };
      } | null;
      const fullName = body?.fullName ?? body?.patient?.fullName;
      if (typeof fullName === "string" && fullName.trim()) {
        names.set(patientId, fullName.trim());
      }
    }),
  );
  return names;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function listWhatsAppTemplates(
  orgSlug: string,
): Promise<WhatsAppTemplateItem[]> {
  const result = await request(
    orgSlug,
    "/whatsapp/templates",
    whatsappTemplatesResponseSchema,
  );
  return result.data;
}

export async function saveWhatsAppTemplate(
  orgSlug: string,
  type: WhatsAppTemplateType,
  input: { content: string; version: number },
): Promise<WhatsAppTemplateItem> {
  return request(
    orgSlug,
    `/whatsapp/templates/${encodeURIComponent(type)}`,
    whatsappTemplateItemSchema,
    { method: "PUT", body: input },
  );
}

// ---------------------------------------------------------------------------
// Route handler helpers
// ---------------------------------------------------------------------------

const ERROR_HTTP_STATUS: Record<WhatsAppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  MESSAGE_STATE_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  VERSION_CONFLICT: 409,
  INVALID_TEMPLATE_STRUCTURE: 422,
  INVALID_TEMPLATE_VARIABLE: 422,
  COMMUNICATION_PROVIDER_UNAVAILABLE: 503,
  INVALID_RESPONSE: 502,
  UNAVAILABLE: 502,
};

export function whatsappErrorHttpStatus(error: unknown): number {
  return error instanceof WhatsAppApiError
    ? ERROR_HTTP_STATUS[error.code]
    : 500;
}

export function whatsappErrorBody(error: unknown): {
  code: WhatsAppErrorCode | "UNKNOWN";
  message: string;
} {
  return error instanceof WhatsAppApiError
    ? { code: error.code, message: error.message }
    : { code: "UNKNOWN", message: "Não foi possível concluir a operação." };
}
