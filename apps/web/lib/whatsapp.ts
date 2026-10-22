import { z } from "zod";

// ---------------------------------------------------------------------------
// Contract (mirrors apps/api/src/modules/communications/model.ts)
// ---------------------------------------------------------------------------

export const connectionStatusSchema = z.enum([
  "CONNECTED",
  "DISCONNECTED",
  "QR_CODE_REQUIRED",
  "CONNECTING",
  "ERROR",
]);
export type WhatsAppConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const whatsappStatusSchema = z.object({
  status: connectionStatusSchema,
  phoneNumber: z.string().nullable(),
});
export type WhatsAppStatus = z.infer<typeof whatsappStatusSchema>;

// The QR is rendered as an <img src>, so only inline base64 images are
// accepted; anything else coming from the upstream is dropped.
const QR_DATA_URL_PATTERN =
  /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

export const whatsappReconnectSchema = z.object({
  status: connectionStatusSchema,
  phoneNumber: z.string().nullable(),
  qrCode: z.string().regex(QR_DATA_URL_PATTERN).nullable(),
  qrExpiresAt: z.string().nullable(),
});

export const messageStatusSchema = z.enum([
  "QUEUED",
  "UNCERTAIN",
  "SENT",
  "DELIVERED",
  "READ",
  "FAILED",
]);
export type WhatsAppMessageStatus = z.infer<typeof messageStatusSchema>;

export const whatsappMessageItemSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: messageStatusSchema,
  patientId: z.string(),
  appointmentId: z.string(),
  phoneMasked: z.string(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorReason: z.string().nullable(),
});
export type WhatsAppMessageItem = z.infer<typeof whatsappMessageItemSchema>;

export const whatsappMessagesResponseSchema = z.object({
  items: z.array(whatsappMessageItemSchema),
  nextCursor: z.string().nullable(),
});
export type WhatsAppMessagesPage = z.infer<
  typeof whatsappMessagesResponseSchema
>;

export const whatsappResendSchema = z.object({ status: z.literal("QUEUED") });

export const templateTypeSchema = z.enum([
  "APPOINTMENT_CONFIRMATION",
  "APPOINTMENT_REMINDER_24H",
  "APPOINTMENT_CANCELLATION",
]);
export type WhatsAppTemplateType = z.infer<typeof templateTypeSchema>;

export const whatsappTemplateItemSchema = z.object({
  type: templateTypeSchema,
  content: z.string(),
  version: z.number().int(),
  allowedVariables: z.array(z.string()).optional(),
  maxLength: z.number().int().optional(),
  approvedAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type WhatsAppTemplateItem = z.infer<typeof whatsappTemplateItemSchema>;

export const whatsappTemplatesResponseSchema = z.object({
  data: z.array(whatsappTemplateItemSchema),
});

// ---------------------------------------------------------------------------
// Tabs and permissions
// ---------------------------------------------------------------------------

type Role = "ADMIN" | "ADMIN_PROFESSIONAL" | "PROFESSIONAL" | "RECEPTIONIST";

export type WhatsAppTab = "connection" | "messages" | "settings";

export const WHATSAPP_TABS: ReadonlyArray<{
  value: WhatsAppTab;
  label: string;
}> = [
  { value: "connection", label: "Conexão" },
  { value: "messages", label: "Mensagens" },
  { value: "settings", label: "Textos das mensagens" },
];

// Connecting the session needs `settings:write` (ADMIN, ADMIN_PROFESSIONAL).
export function canManageWhatsAppConnection(role?: string | null): boolean {
  return role === "ADMIN" || role === "ADMIN_PROFESSIONAL";
}

// The issue limits template editing to clinic administrators even though the
// API also accepts `communications:write` from receptionists.
export function canEditWhatsAppTemplates(role?: string | null): boolean {
  return canManageWhatsAppConnection(role);
}

// History needs `communications:read`/`appointments:read`; resend needs
// `communications:write`. Both are held by the roles that can open the module.
export function canViewWhatsAppMessages(role?: Role | string | null): boolean {
  return (
    role === "ADMIN" || role === "ADMIN_PROFESSIONAL" || role === "RECEPTIONIST"
  );
}

export function canAccessWhatsAppTab(
  role: string | null | undefined,
  tab: WhatsAppTab,
): boolean {
  if (tab === "messages") return canViewWhatsAppMessages(role);
  if (tab === "settings") return canEditWhatsAppTemplates(role);
  return canManageWhatsAppConnection(role);
}

export function resolveWhatsAppTab(
  raw: string | undefined,
  role: string | null | undefined,
): WhatsAppTab {
  if (raw === "messages" || raw === "settings" || raw === "connection") {
    return raw;
  }
  return canManageWhatsAppConnection(role) ? "connection" : "messages";
}

export function whatsappTabHref(
  orgSlug: string,
  tab: WhatsAppTab,
  params?: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams();
  if (tab !== "connection") search.set("tab", tab);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return `/app/${encodeURIComponent(orgSlug)}/whatsapp${query ? `?${query}` : ""}`;
}

// ---------------------------------------------------------------------------
// Connection status, QR code and polling
// ---------------------------------------------------------------------------

export type StatusTone = "success" | "warning" | "danger" | "neutral";

export interface ConnectionPresentation {
  label: string;
  description: string;
  tone: StatusTone;
}

export function connectionPresentation(
  status: WhatsAppConnectionStatus,
): ConnectionPresentation {
  switch (status) {
    case "CONNECTED":
      return {
        label: "Conectado",
        description:
          "A sessão está ativa e as mensagens operacionais podem ser enviadas.",
        tone: "success",
      };
    case "CONNECTING":
      return {
        label: "Conectando",
        description:
          "Aguardando a leitura do QR Code no aplicativo do celular.",
        tone: "warning",
      };
    case "QR_CODE_REQUIRED":
      return {
        label: "QR Code necessário",
        description:
          "A sessão precisa ser pareada. Gere um QR Code e leia com o celular da clínica.",
        tone: "warning",
      };
    case "ERROR":
      return {
        label: "Falha de conexão",
        description:
          "O serviço de WhatsApp reportou um problema. Gere um novo QR Code para reconectar.",
        tone: "danger",
      };
    default:
      return {
        label: "Desconectado",
        description:
          "Nenhuma sessão ativa. Mensagens ficam na fila até a clínica reconectar.",
        tone: "neutral",
      };
  }
}

/** Offers the "generate QR" action whenever the session is not paired. */
export function canRequestQr(status: WhatsAppConnectionStatus): boolean {
  return status !== "CONNECTED";
}

const MAX_QR_TTL_MS = 120_000;
export const DEFAULT_QR_TTL_MS = 20_000;

/**
 * Remaining validity of a QR code in milliseconds, computed on the BFF so the
 * browser never depends on its own clock being aligned with the API.
 */
export function qrTtlMs(
  qrExpiresAt: string | null,
  nowMs: number = Date.now(),
): number {
  if (!qrExpiresAt) return 0;
  const expires = Date.parse(qrExpiresAt);
  if (Number.isNaN(expires)) return DEFAULT_QR_TTL_MS;
  return Math.min(MAX_QR_TTL_MS, Math.max(0, expires - nowMs));
}

export function qrRemainingSeconds(expiresAtMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
}

export function isQrExpired(expiresAtMs: number, nowMs: number): boolean {
  return nowMs >= expiresAtMs;
}

export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function qrProgressPercent(remainingMs: number, totalMs: number) {
  if (totalMs <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((remainingMs / totalMs) * 100)));
}

/** Faster polling while the clinic is expected to scan a QR code. */
export function nextPollDelayMs(
  status: WhatsAppConnectionStatus,
  hasActiveQr: boolean,
): number {
  if (hasActiveQr || status === "CONNECTING") return 3_000;
  return 8_000;
}

/** Formats the paired number (digits only, E.164 without "+"). */
export function formatConnectedPhone(phoneNumber: string | null): string {
  if (!phoneNumber) return "Número não informado";
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.length >= 12 && digits.startsWith("55")) {
    const area = digits.slice(2, 4);
    const subscriber = digits.slice(4);
    const split = subscriber.length === 9 ? 5 : 4;
    return `+55 (${area}) ${subscriber.slice(0, split)}-${subscriber.slice(split)}`;
  }
  return digits ? `+${digits}` : "Número não informado";
}

// ---------------------------------------------------------------------------
// Message history
// ---------------------------------------------------------------------------

export interface MessageStatusPresentation {
  label: string;
  className: string;
  description: string;
}

export function messageStatusPresentation(
  status: WhatsAppMessageStatus,
): MessageStatusPresentation {
  switch (status) {
    case "QUEUED":
      return {
        label: "Na fila",
        className: "bg-muted text-muted-foreground",
        description: "Aguardando o envio.",
      };
    case "SENT":
      return {
        label: "Enviada",
        className: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
        description:
          "O WhatsApp aceitou a mensagem; entrega ainda não confirmada.",
      };
    case "DELIVERED":
      return {
        label: "Entregue",
        className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        description: "A mensagem chegou ao aparelho do paciente.",
      };
    case "READ":
      return {
        label: "Lida",
        className: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
        description: "O paciente leu a mensagem.",
      };
    case "UNCERTAIN":
      return {
        label: "Incerta",
        className: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        description:
          "A mensagem pode ter sido enviada, mas o resultado não foi confirmado. Não é reenviada para evitar duplicidade.",
      };
    default:
      return {
        label: "Falhou",
        className: "bg-destructive/10 text-destructive",
        description: "O envio falhou de forma definitiva.",
      };
  }
}

const MESSAGE_TYPE_LABELS: Record<string, string> = {
  APPOINTMENT_CREATED: "Confirmação",
  APPOINTMENT_CANCELLED: "Cancelamento",
  APPOINTMENT_REMINDER: "Lembrete",
};

export function messageTypeLabel(type: string): string {
  return MESSAGE_TYPE_LABELS[type] ?? "Mensagem";
}

/** Only definitive failures can be resent (API: 409 for anything else). */
export function canRetryMessage(
  status: WhatsAppMessageStatus,
  canWrite = true,
): boolean {
  return canWrite && status === "FAILED";
}

/**
 * The API already returns the masked phone. This is a defensive second layer:
 * if a value without a mask ever reaches the screen, the subscriber's last
 * digits are hidden before rendering.
 */
export function ensureMaskedPhone(value: string | null | undefined): string {
  if (!value) return "Telefone não informado";
  if (value.includes("*")) return value;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 8) return "****";
  const national =
    digits.length > 11 && digits.startsWith("55") ? digits.slice(2) : digits;
  const area = national.slice(0, 2);
  const subscriber = national.slice(2, -4);
  const split = subscriber.length > 4 ? 5 : subscriber.length;
  const prefix = subscriber.slice(0, split);
  return `(${area}) ${prefix}-****`;
}

export interface FailureDescription {
  title: string;
  hint: string;
}

export function describeMessageFailure(
  errorCode: string | null,
  errorReason: string | null,
): FailureDescription {
  switch (errorCode) {
    case "NOT_ELIGIBLE":
      return {
        title: "Mensagem não elegível para envio",
        hint: "O paciente pode não ter consentimento ativo, o telefone pode ser inválido ou o agendamento mudou.",
      };
    case "TEMPLATE_NOT_CONFIGURED":
      return {
        title: "Texto da mensagem não configurado",
        hint: "Configure o texto deste tipo de mensagem na aba “Textos das mensagens”.",
      };
    case "TEMPLATE_INVALID":
      return {
        title: "Texto da mensagem inválido",
        hint: "Revise o texto configurado na aba “Textos das mensagens”.",
      };
    case "WAHA_ACK_ERROR":
      return {
        title: "O WhatsApp informou falha na entrega",
        hint: "Confira se o número do paciente está correto e possui WhatsApp.",
      };
    case "MANUAL_RESEND_CANCELLED":
      return {
        title: "Reenvio cancelado",
        hint: "O reenvio foi interrompido antes de chegar ao paciente.",
      };
    case "PROVIDER_OUTCOME_UNKNOWN":
    case "PROVIDER_RESPONSE_INVALID":
      return {
        title: "Resultado do envio não confirmado",
        hint: "A comunicação com o WhatsApp falhou durante o envio. A mensagem pode ter chegado ao paciente.",
      };
    default:
      if (errorCode?.startsWith("WAHA_HTTP_")) {
        return {
          title: "O serviço de WhatsApp recusou o envio",
          hint: "Verifique a conexão da sessão e o número do paciente.",
        };
      }
      return {
        title: errorReason?.trim() || "Motivo não informado",
        hint: "Se o problema persistir, confira a conexão do WhatsApp da clínica.",
      };
  }
}

export const MESSAGE_STATUS_FILTERS: ReadonlyArray<{
  value: "all" | WhatsAppMessageStatus;
  label: string;
}> = [
  { value: "all", label: "Todos os status" },
  { value: "FAILED", label: "Falhas" },
  { value: "QUEUED", label: "Na fila" },
  { value: "SENT", label: "Enviadas" },
  { value: "DELIVERED", label: "Entregues" },
  { value: "READ", label: "Lidas" },
  { value: "UNCERTAIN", label: "Incertas" },
];

export type MessagePeriod = "all" | "24h" | "7d" | "30d";

export const MESSAGE_PERIOD_FILTERS: ReadonlyArray<{
  value: MessagePeriod;
  label: string;
}> = [
  { value: "all", label: "Todo o período" },
  { value: "24h", label: "Últimas 24 horas" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
];

export function parseMessageStatusFilter(
  raw: string | undefined,
): WhatsAppMessageStatus | undefined {
  const parsed = messageStatusSchema.safeParse(raw?.toUpperCase());
  return parsed.success ? parsed.data : undefined;
}

export function parseMessagePeriod(raw: string | undefined): MessagePeriod {
  return raw === "24h" || raw === "7d" || raw === "30d" ? raw : "all";
}

const PERIOD_MS: Record<Exclude<MessagePeriod, "all">, number> = {
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
};

/** The API filters on `sentAt`, so only a lower bound is ever needed. */
export function resolvePeriodRange(
  period: MessagePeriod,
  now: Date = new Date(),
): { from?: string } {
  if (period === "all") return {};
  return { from: new Date(now.getTime() - PERIOD_MS[period]).toISOString() };
}

export const MESSAGES_PAGE_SIZE = 25;
export const MESSAGES_TIME_ZONE = "America/Sao_Paulo";

export function formatMessageDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: MESSAGES_TIME_ZONE,
  }).format(date);
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Operational message templates
// ---------------------------------------------------------------------------

export const TEMPLATE_MAX_LENGTH = 4_096;

export const TEMPLATE_TYPES: readonly WhatsAppTemplateType[] = [
  "APPOINTMENT_CONFIRMATION",
  "APPOINTMENT_REMINDER_24H",
  "APPOINTMENT_CANCELLATION",
];

export const TEMPLATE_META: Record<
  WhatsAppTemplateType,
  { label: string; description: string }
> = {
  APPOINTMENT_CONFIRMATION: {
    label: "Confirmação de agendamento",
    description: "Enviada logo após marcar a consulta.",
  },
  APPOINTMENT_REMINDER_24H: {
    label: "Lembrete de consulta",
    description: "Enviado 24 horas antes da consulta.",
  },
  APPOINTMENT_CANCELLATION: {
    label: "Cancelamento de consulta",
    description: "Enviada quando a consulta é cancelada.",
  },
};

const COMMON_VARIABLES = [
  "paciente_nome",
  "data",
  "hora",
  "medico_nome",
  "clinica_nome",
] as const;

// Same sets as ALLOWED_TEMPLATE_VARIABLES in the API; the cancellation text
// does not accept {medico_nome}.
export const TEMPLATE_VARIABLES: Record<
  WhatsAppTemplateType,
  readonly string[]
> = {
  APPOINTMENT_CONFIRMATION: COMMON_VARIABLES,
  APPOINTMENT_REMINDER_24H: COMMON_VARIABLES,
  APPOINTMENT_CANCELLATION: ["paciente_nome", "data", "hora", "clinica_nome"],
};

export const VARIABLE_DESCRIPTIONS: Record<string, string> = {
  paciente_nome: "Nome do paciente",
  data: "Data da consulta",
  hora: "Horário da consulta",
  medico_nome: "Nome do profissional",
  clinica_nome: "Nome da clínica",
};

// Same fictitious values the API uses for its own preview endpoint.
export const PREVIEW_VALUES: Readonly<Record<string, string>> = {
  paciente_nome: "Maria da Silva",
  data: "20/10/2026",
  hora: "14:30",
  medico_nome: "Dra. Ana Oliveira",
  clinica_nome: "Clínica Exemplo",
};

export const DEFAULT_TEMPLATE_CONTENT: Record<WhatsAppTemplateType, string> = {
  APPOINTMENT_CONFIRMATION:
    "Olá, {paciente_nome}! Sua consulta com {medico_nome} na {clinica_nome} foi agendada para {data} às {hora}. Para deixar de receber estes avisos, entre em contato com a clínica.",
  APPOINTMENT_REMINDER_24H:
    "Olá, {paciente_nome}! Lembramos que sua consulta com {medico_nome} na {clinica_nome} é amanhã, {data}, às {hora}. Para deixar de receber estes avisos, entre em contato com a clínica.",
  APPOINTMENT_CANCELLATION:
    "Olá, {paciente_nome}. Sua consulta de {data} às {hora} na {clinica_nome} foi cancelada. Para reagendar ou deixar de receber estes avisos, entre em contato com a clínica.",
};

export type TemplateIssueKind =
  | "EMPTY"
  | "TOO_LONG"
  | "CONTROL_CHARACTERS"
  | "MALFORMED"
  | "UNKNOWN_VARIABLE";

export interface TemplateIssue {
  kind: TemplateIssueKind;
  message: string;
}

export interface TemplateValidation {
  ok: boolean;
  issues: TemplateIssue[];
  /** Distinct, valid variable keys used in the text. */
  variables: string[];
  /** Distinct keys that are well-formed but not allowed for this type. */
  unknownVariables: string[];
  length: number;
}

const VARIABLE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127)
      return true;
  }
  return false;
}

/** Client-side mirror of the API's template validation (fail fast, same rules). */
export function validateTemplateContent(
  type: WhatsAppTemplateType,
  content: string,
  maxLength: number = TEMPLATE_MAX_LENGTH,
): TemplateValidation {
  const issues: TemplateIssue[] = [];
  const variables = new Set<string>();
  const unknown = new Set<string>();
  const allowed = new Set(TEMPLATE_VARIABLES[type]);

  if (content.length > maxLength) {
    issues.push({
      kind: "TOO_LONG",
      message: `O texto excede o limite de ${maxLength} caracteres (${content.length}).`,
    });
  }
  if (hasControlCharacters(content)) {
    issues.push({
      kind: "CONTROL_CHARACTERS",
      message: "O texto contém caracteres de controle não permitidos.",
    });
  }

  const trimmed = content.trim();
  if (!trimmed) {
    issues.push({ kind: "EMPTY", message: "O texto não pode estar vazio." });
  }

  let malformed = false;
  for (let index = 0; index < trimmed.length; index++) {
    const character = trimmed.charAt(index);
    if (character === "}") {
      malformed = true;
      continue;
    }
    if (character !== "{") continue;

    const closingIndex = trimmed.indexOf("}", index + 1);
    if (closingIndex === -1) {
      malformed = true;
      continue;
    }
    const rawKey = trimmed.slice(index + 1, closingIndex);
    if (rawKey.includes("{") || /[\r\n]/.test(rawKey)) {
      malformed = true;
      continue;
    }
    const key = rawKey.trim();
    if (!VARIABLE_KEY_PATTERN.test(key)) {
      malformed = true;
    } else if (allowed.has(key)) {
      variables.add(key);
    } else {
      unknown.add(key);
    }
    index = closingIndex;
  }

  if (malformed) {
    issues.push({
      kind: "MALFORMED",
      message:
        "Há uma chave “{” ou “}” sem par ou com formato inválido. Use variáveis completas, como {paciente_nome}.",
    });
  }
  if (unknown.size > 0) {
    const list = [...unknown].map((key) => `{${key}}`).join(", ");
    const valid = TEMPLATE_VARIABLES[type].map((key) => `{${key}}`).join(", ");
    issues.push({
      kind: "UNKNOWN_VARIABLE",
      message: `${unknown.size === 1 ? "Variável não permitida" : "Variáveis não permitidas"}: ${list}. Use somente ${valid}.`,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    variables: [...variables],
    unknownVariables: [...unknown],
    length: content.length,
  };
}

export type PreviewSegmentKind = "text" | "value" | "invalid";

export interface PreviewSegment {
  kind: PreviewSegmentKind;
  text: string;
}

/**
 * Splits the text into plain text, substituted fictitious values and invalid
 * placeholders (kept verbatim so they can be highlighted in red).
 */
export function buildPreviewSegments(
  type: WhatsAppTemplateType,
  content: string,
): PreviewSegment[] {
  const allowed = new Set(TEMPLATE_VARIABLES[type]);
  const segments: PreviewSegment[] = [];
  const pattern = /\{[^{}]*\}/g;
  let cursor = 0;

  for (const match of content.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ kind: "text", text: content.slice(cursor, start) });
    }
    const key = match[0].slice(1, -1).trim();
    if (allowed.has(key) && PREVIEW_VALUES[key] !== undefined) {
      segments.push({ kind: "value", text: PREVIEW_VALUES[key] });
    } else {
      segments.push({ kind: "invalid", text: match[0] });
    }
    cursor = start + match[0].length;
  }
  if (cursor < content.length) {
    segments.push({ kind: "text", text: content.slice(cursor) });
  }
  return segments;
}

export function renderPreviewText(
  type: WhatsAppTemplateType,
  content: string,
): string {
  return buildPreviewSegments(type, content)
    .map((segment) => segment.text)
    .join("");
}

export function insertTemplateVariable(
  content: string,
  selectionStart: number,
  selectionEnd: number,
  variable: string,
): { content: string; cursor: number } {
  const start = Math.min(Math.max(0, selectionStart), content.length);
  const end = Math.min(Math.max(start, selectionEnd), content.length);
  const token = `{${variable}}`;
  return {
    content: `${content.slice(0, start)}${token}${content.slice(end)}`,
    cursor: start + token.length,
  };
}
