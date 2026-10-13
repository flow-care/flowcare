import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { ApiError } from "../lib/api-error";

/**
 * Approved retention window for security and clinical audit events (5 years).
 */
export const AUDIT_RETENTION_DAYS = 1825;

export type AuditDbClient = PrismaClient | Prisma.TransactionClient;

export type AuditEventCategory =
  | "AUTH"
  | "PERMISSIONS"
  | "PATIENT"
  | "SCHEDULE"
  | "ANAMNESIS"
  | "DOCUMENT"
  | "ORGANIZATION";

export interface RecordAuditEventInput {
  organizationId?: string | null;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown> | null;
}

export interface RecordedAuditEvent {
  id?: string;
  organizationId: string | null;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt?: Date;
}

const FORBIDDEN_NORMALIZED_KEYS = new Set([
  // Passwords & credentials
  "password",
  "passwordhash",
  "currentpassword",
  "newpassword",
  "oldpassword",
  "passphrase",
  "pin",
  "credentials",
  // Tokens & session secrets
  "token",
  "tokenhash",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "sessiontoken",
  "verificationtoken",
  "resettoken",
  "invitetoken",
  "authtoken",
  "bearertoken",
  " rawtoken",
  // Keys, secrets & headers
  "secret",
  "clientsecret",
  "jwtsecret",
  "webhooksecret",
  "apikey",
  "xapikey",
  "privatekey",
  "secretaccesskey",
  "accesskeyid",
  "signingkey",
  "encryptionkey",
  "authorization",
  "cookie",
  "setcookie",
  "signature",
  "presignedurl",
  "downloadurl",
  "objectkey",
  "storagekey",
  "qrcode",
  // Raw audio & recordings
  "audio",
  "audiofile",
  "audiobuffer",
  "audiobytes",
  "audiobase64",
  "audioblob",
  "audiodata",
  "audiopayload",
  "audiostream",
  "audiourl",
  "rawaudio",
  "voicerecording",
  "recording",
  // Raw clinical content & medical record payload
  "rawclinicalcontent",
  "clinicalcontent",
  "clinicalnote",
  "clinicalnotes",
  "clinicalnoteraw",
  "clinicalsummary",
  "medicalnote",
  "medicalnotes",
  "medicalrecord",
  "confidentialnote",
  "confidentialnotes",
  "anamnesis",
  "anamnesisbody",
  "anamnesistext",
  "anamnesiscontent",
  "anamnesisdraft",
  "chiefcomplaint",
  "historyofpresentillness",
  "physicalexam",
  "diagnostichypothesis",
  "conduct",
  "prescription",
  "prescriptiontext",
  "prescriptionbody",
  "documentcontent",
  "documentbody",
  "bodytemplate",
  "rawcontent",
  "rawtranscript",
  "transcript",
  "transcriptraw",
  "transcripttext",
  "transcription",
  "allergies",
  "comorbidities",
  "clinicalalerts",
  "diagnosis",
  "medications",
  "soap",
  "evolution",
]);

const FORBIDDEN_KEY_SUBSTRINGS = [
  "password",
  "secret",
  "token",
  "apikey",
  "privatekey",
  "audio",
  "transcript",
  "clinicalcontent",
  "clinicalnote",
  "medicalnote",
  "confidentialnote",
  "anamnesisbody",
  "anamnesisdraft",
  "anamnesistext",
  "documentbody",
  "documentcontent",
  "bodytemplate",
  "prescriptionbody",
] as const;

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

export function isForbiddenAuditMetadataKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (!normalized) return false;
  if (FORBIDDEN_NORMALIZED_KEYS.has(normalized)) return true;
  return FORBIDDEN_KEY_SUBSTRINGS.some((sub) => normalized.includes(sub));
}

function isBinaryLike(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    (typeof Blob !== "undefined" && value instanceof Blob)
  );
}

function isSensitiveStringValue(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^Bearer\s+\S+/i.test(trimmed)) return true;
  if (/^\$argon2(id|i|d)\$/i.test(trimmed)) return true;
  if (/^data:(audio|video|application|image)\/[^;]+;base64,/i.test(trimmed))
    return true;
  if (trimmed.includes("-----BEGIN") && trimmed.includes("KEY-----"))
    return true;
  if (
    trimmed.startsWith("ey" + "J") &&
    trimmed.split(".").length === 3 &&
    /^[A-Za-z0-9_.-]+$/.test(trimmed)
  ) {
    return true;
  }
  return false;
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (value === null) return null;
  if (value === undefined) return undefined;

  if (typeof value === "string") {
    if (isSensitiveStringValue(value)) return undefined;
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return Number.isFinite(value) || typeof value === "boolean"
      ? value
      : undefined;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }

  if (isBinaryLike(value)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const sanitizedItems: unknown[] = [];
    for (const item of value) {
      const next = sanitizeValue(item, depth + 1);
      if (next !== undefined) {
        sanitizedItems.push(next);
      }
    }
    return sanitizedItems;
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (isForbiddenAuditMetadataKey(key)) {
        continue;
      }
      const sanitizedEntry = sanitizeValue(entryValue, depth + 1);
      if (sanitizedEntry !== undefined) {
        output[key] = sanitizedEntry;
      }
    }
    return output;
  }

  return undefined;
}

/**
 * Sanitizes audit metadata by stripping any password, token, key, audio,
 * binary payload, or raw clinical content at any nesting level.
 */
export function sanitizeAuditMetadata(
  metadata?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  const sanitized = sanitizeValue(metadata, 0);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : {};
}

export function computeAuditRetentionUntil(baseDate = new Date()): Date {
  return new Date(baseDate.getTime() + AUDIT_RETENTION_DAYS * 86_400_000);
}

function validateAuditInput(input: RecordAuditEventInput) {
  const actorUserId = input.actorUserId?.trim();
  const action = input.action?.trim();
  const targetType = input.targetType?.trim();
  const targetId = input.targetId?.trim();

  if (!actorUserId || !action || !targetType || !targetId) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Evento de auditoria inválido: ator, ação e alvo são obrigatórios.",
    );
  }

  return {
    organizationId:
      input.organizationId === undefined
        ? undefined
        : input.organizationId?.trim() || null,
    actorUserId,
    action,
    targetType,
    targetId,
    metadata: sanitizeAuditMetadata(input.metadata),
  };
}

/**
 * Records a security or clinical audit event.
 *
 * Fail-closed guarantee:
 * - Never swallows errors from `auditLog.create`.
 * - If `auditLog` is configured on the Prisma client/transaction and fails or is
 *   broken, the error propagates immediately and aborts the critical operation.
 * - For legacy unit test mocks that do not define `auditLog` on a partial mock
 *   object (`!("auditLog" in db)`), skips only when `requirePersistence` is false.
 */
export async function recordAuditEvent(
  db: AuditDbClient,
  input: RecordAuditEventInput,
  options?: { requirePersistence?: boolean },
): Promise<RecordedAuditEvent> {
  const validated = validateAuditInput(input);
  const dbRecord = db as unknown as {
    auditLog?: {
      create?: (args: {
        data: Record<string, unknown>;
      }) => Promise<Record<string, unknown> | undefined>;
    };
  };

  const hasAuditLogProperty =
    dbRecord !== null && typeof dbRecord === "object" && "auditLog" in dbRecord;

  if (!hasAuditLogProperty && !options?.requirePersistence) {
    return {
      organizationId: validated.organizationId ?? null,
      actorUserId: validated.actorUserId,
      action: validated.action,
      targetType: validated.targetType,
      targetId: validated.targetId,
      metadata: validated.metadata,
    };
  }

  if (typeof dbRecord?.auditLog?.create !== "function") {
    throw new ApiError(
      "INTERNAL",
      500,
      "Serviço de auditoria indisponível para registrar ação crítica.",
    );
  }

  const data: Record<string, unknown> = {
    ...(validated.organizationId !== undefined
      ? { organizationId: validated.organizationId }
      : {}),
    actorUserId: validated.actorUserId,
    action: validated.action,
    targetType: validated.targetType,
    targetId: validated.targetId,
    metadata: validated.metadata,
  };

  const created = await dbRecord.auditLog.create({
    data: data as Prisma.AuditLogUncheckedCreateInput,
  });

  return {
    ...(created && typeof created.id === "string" ? { id: created.id } : {}),
    organizationId:
      created && "organizationId" in created
        ? ((created.organizationId as string | null) ?? null)
        : (validated.organizationId ?? null),
    actorUserId: validated.actorUserId,
    action: validated.action,
    targetType: validated.targetType,
    targetId: validated.targetId,
    metadata: validated.metadata,
    ...(created && created.createdAt instanceof Date
      ? { createdAt: created.createdAt }
      : {}),
  };
}

/**
 * Common Audit Service for recording security and domain events across:
 * - Login & authentication
 * - Permission, membership & invite changes
 * - Patient registration & attachments
 * - Schedule, appointments & reception queue
 * - Anamnesis & consultation workflow
 * - Clinical documents & templates
 */
export class AuditLogger {
  constructor(private readonly prisma: AuditDbClient) {}

  async record(
    input: RecordAuditEventInput,
    tx: AuditDbClient = this.prisma,
  ): Promise<RecordedAuditEvent> {
    return recordAuditEvent(tx, input, { requirePersistence: true });
  }

  async recordLogin(
    params: {
      actorUserId: string;
      sessionId: string;
      organizationId?: string | null;
      action?:
        | "AUTH_LOGIN_SUCCEEDED"
        | "AUTH_EMAIL_VERIFIED"
        | "AUTH_PASSWORD_RESET_COMPLETED"
        | "AUTH_PASSWORD_CHANGED";
      metadata?: Record<string, unknown>;
    },
    tx: AuditDbClient = this.prisma,
  ): Promise<RecordedAuditEvent> {
    return this.record(
      {
        organizationId: params.organizationId ?? null,
        actorUserId: params.actorUserId,
        action: params.action ?? "AUTH_LOGIN_SUCCEEDED",
        targetType: "SESSION",
        targetId: params.sessionId,
        metadata: params.metadata,
      },
      tx,
    );
  }

  async recordPermissionChange(
    params: {
      organizationId: string;
      actorUserId: string;
      action:
        | "TEAM_INVITE_CREATED"
        | "TEAM_INVITE_ACCEPTED"
        | "TEAM_INVITE_DECLINED"
        | "TEAM_INVITE_REVOKED"
        | "TEAM_INVITE_RESENT"
        | "MEMBERSHIP_ROLE_CHANGED"
        | "MEMBERSHIP_STATUS_CHANGED";
      targetType?: "ORGANIZATION_INVITE" | "MEMBERSHIP";
      targetId: string;
      metadata?: Record<string, unknown>;
    },
    tx: AuditDbClient = this.prisma,
  ): Promise<RecordedAuditEvent> {
    return this.record(
      {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        action: params.action,
        targetType: params.targetType ?? "MEMBERSHIP",
        targetId: params.targetId,
        metadata: params.metadata,
      },
      tx,
    );
  }

  async recordPatientEvent(
    params: {
      organizationId: string;
      actorUserId: string;
      action:
        | "PATIENT_CREATED"
        | "PATIENT_UPDATED"
        | "PATIENT_ATTACHMENT_UPLOADED"
        | "PATIENT_ATTACHMENT_DOWNLOAD_AUTHORIZED"
        | "PATIENT_ATTACHMENT_ARCHIVED";
      targetType?: "PATIENT" | "PATIENT_ATTACHMENT";
      targetId: string;
      metadata?: Record<string, unknown>;
    },
    tx: AuditDbClient = this.prisma,
  ): Promise<RecordedAuditEvent> {
    return this.record(
      {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        action: params.action,
        targetType: params.targetType ?? "PATIENT",
        targetId: params.targetId,
        metadata: params.metadata,
      },
      tx,
    );
  }

  async recordScheduleEvent(
    params: {
      organizationId: string;
      actorUserId: string;
      action:
        | "APPOINTMENT_CREATED"
        | "APPOINTMENT_UPDATED"
        | "APPOINTMENT_CANCELLED"
        | "RECEPTION_QUEUE_UPDATED"
        | "MANUAL_CONFIRMATION_DECIDED"
        | "WEEKLY_SCHEDULE_UPDATED"
        | "SCHEDULE_EXCEPTION_CREATED"
        | "SCHEDULE_EXCEPTION_DELETED";
      targetType?: "APPOINTMENT" | "ORGANIZATION" | "SCHEDULE_EXCEPTION";
      targetId: string;
      metadata?: Record<string, unknown>;
    },
    tx: AuditDbClient = this.prisma,
  ): Promise<RecordedAuditEvent> {
    return this.record(
      {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        action: params.action,
        targetType: params.targetType ?? "APPOINTMENT",
        targetId: params.targetId,
        metadata: params.metadata,
      },
      tx,
    );
  }

  async recordAnamnesisEvent(
    params: {
      organizationId: string;
      actorUserId: string;
      action:
        | "ANAMNESIS_TOPICS_UPDATED"
        | "ANAMNESIS_DRAFT_SAVED"
        | "ANAMNESIS_APPROVED";
      targetType?: "ANAMNESIS_TOPIC_CONFIG" | "ANAMNESIS";
      targetId: string;
      metadata?: Record<string, unknown>;
    },
    tx: AuditDbClient = this.prisma,
  ): Promise<RecordedAuditEvent> {
    return this.record(
      {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        action: params.action,
        targetType: params.targetType ?? "ANAMNESIS",
        targetId: params.targetId,
        metadata: params.metadata,
      },
      tx,
    );
  }

  async recordDocumentEvent(
    params: {
      organizationId: string;
      actorUserId: string;
      action:
        | "DOCUMENT_TEMPLATE_CREATED"
        | "DOCUMENT_TEMPLATE_ARCHIVED"
        | "DOCUMENT_CREATED"
        | "DOCUMENT_ISSUED"
        | "DOCUMENT_VOIDED";
      targetType?: "DOCUMENT_TEMPLATE" | "DOCUMENT";
      targetId: string;
      metadata?: Record<string, unknown>;
    },
    tx: AuditDbClient = this.prisma,
  ): Promise<RecordedAuditEvent> {
    return this.record(
      {
        organizationId: params.organizationId,
        actorUserId: params.actorUserId,
        action: params.action,
        targetType: params.targetType ?? "DOCUMENT",
        targetId: params.targetId,
        metadata: params.metadata,
      },
      tx,
    );
  }
}
