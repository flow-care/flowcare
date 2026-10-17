export interface AuditLogActorUser {
  id: string;
  fullName: string;
  email: string;
}

export interface AuditLogItem {
  id: string;
  organizationId: string | null;
  actorUserId: string;
  actorName?: string | null;
  actorUser?: AuditLogActorUser | null;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditPageInfo {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ListAuditLogsResponse {
  data: AuditLogItem[];
  pagination?: AuditPageInfo;
  pageInfo?: AuditPageInfo;
}

export type AuditCategory =
  | "all"
  | "auth"
  | "records"
  | "documents"
  | "team"
  | "settings";

export const AUDIT_CATEGORIES: ReadonlyArray<{
  id: AuditCategory;
  label: string;
}> = [
  { id: "all", label: "Todas" },
  { id: "auth", label: "Autenticação" },
  { id: "records", label: "Prontuário" },
  { id: "documents", label: "Documento" },
  { id: "team", label: "Equipe" },
  { id: "settings", label: "Configurações" },
] as const;

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Authentication & Session
  AUTH_LOGIN_SUCCEEDED: "Login realizado com sucesso",
  AUTH_LOGIN_FAILED: "Falha na tentativa de login",
  AUTH_LOGOUT: "Logout realizado",
  SESSION_REVOKED: "Sessão revogada",
  PASSWORD_RESET_REQUESTED: "Solicitação de redefinição de senha",
  PASSWORD_CHANGED: "Senha alterada",

  // Patient & Clinical Records
  PATIENT_CREATED: "Cadastrou novo paciente",
  PATIENT_UPDATED: "Atualizou dados do paciente",
  PATIENT_VIEWED: "Visualizou prontuário",
  PATIENT_ARCHIVED: "Arquivou paciente",
  PATIENT_ATTACHMENT_UPLOADED: "Anexou arquivo ao prontuário",
  PATIENT_ATTACHMENT_ARCHIVED: "Arquivou anexo do prontuário",
  APPOINTMENT_CREATED: "Agendou consulta",
  APPOINTMENT_UPDATED: "Alterou agendamento de consulta",
  APPOINTMENT_CANCELLED: "Cancelou consulta",
  CONSULTATION_STARTED: "Iniciou atendimento clínico",
  CONSULTATION_COMPLETED: "Finalizou atendimento clínico",
  ANAMNESIS_SAVED: "Salvou anamnese clínica",

  // Documents & Templates
  DOCUMENT_CREATED: "Criou rascunho de documento",
  DOCUMENT_ISSUED: "Emitiu documento clínico",
  DOCUMENT_VOIDED: "Cancelou / anulou documento",
  DOCUMENT_VIEWED: "Visualizou documento clínico",
  DOCUMENT_DOWNLOADED: "Exportou documento / receita",
  TEMPLATE_CREATED: "Criou modelo de documento",
  TEMPLATE_UPDATED: "Atualizou modelo de documento",
  TEMPLATE_ARCHIVED: "Arquivou modelo de documento",

  // Team & Permissions
  TEAM_INVITE_CREATED: "Enviou convite para equipe",
  TEAM_INVITE_REVOKED: "Revogou convite da equipe",
  TEAM_INVITE_ACCEPTED: "Aceitou convite da equipe",
  MEMBER_ROLE_UPDATED: "Alterou papel de membro",
  MEMBER_REMOVED: "Removeu membro da equipe",
  MEMBER_STATUS_UPDATED: "Alterou status de membro",
  ROLE_CREATED: "Criou perfil de acesso",
  ROLE_UPDATED: "Atualizou perfil de acesso",

  // Settings & Schedule
  WEEKLY_SCHEDULE_UPDATED: "Atualizou horários de atendimento",
  ORGANIZATION_UPDATED: "Atualizou configurações da clínica",
  RECEPTION_QUEUE_UPDATED: "Atualizou fila da recepção",
  MANUAL_CONFIRMATION_DECIDED: "Registrou confirmação manual",
};

/**
 * Masks an IP address (IPv4 or IPv6) for privacy compliance (LGPD).
 * IPv4: 192.168.1.10 -> 192.168.***.***
 * IPv6: 2001:0db8:85a3:: -> 2001:0db8:***:***
 * Localhost: ::1 -> ::***
 */
export function maskIpAddress(ip: string | null | undefined): string {
  if (!ip) return "—";
  const trimmed = ip.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return "—";

  // Check for IPv4-mapped IPv6 (::ffff:192.168.1.1)
  const ipv4MappedMatch = trimmed.match(
    /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i,
  );
  const targetIp = ipv4MappedMatch ? ipv4MappedMatch[1] : trimmed;

  const ipv4Parts = targetIp.split(".");
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  ) {
    return `${ipv4Parts[0]}.${ipv4Parts[1]}.***.***`;
  }

  if (targetIp.includes(":")) {
    if (targetIp === "::1") return "::***";
    const segments = targetIp.split(":").filter(Boolean);
    if (segments.length >= 2) {
      return `${segments[0]}:${segments[1]}:***:***`;
    }
    return `${targetIp.slice(0, 4)}:***`;
  }

  return trimmed;
}

/**
 * Extracts and masks the client IP address from an event's metadata.
 */
export function extractMaskedIp(
  metadata: Record<string, unknown> | null | undefined,
): string {
  if (!metadata || typeof metadata !== "object") return "—";
  const rawIp =
    metadata.ip ?? metadata.clientIp ?? metadata.ipAddress ?? metadata.userIp;
  return maskIpAddress(typeof rawIp === "string" ? rawIp : null);
}

/**
 * Formats an ISO date string in clinic timezone (America/Sao_Paulo) e.g. "17/10/2026 às 12:45".
 */
export function formatAuditDate(
  dateString: string | Date | null | undefined,
  timeZone = "America/Sao_Paulo",
): string {
  if (!dateString) return "—";
  try {
    const d =
      typeof dateString === "string" ? new Date(dateString) : dateString;
    if (Number.isNaN(d.getTime())) {
      return typeof dateString === "string" ? dateString : "—";
    }

    const datePart = new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone,
    }).format(d);

    const timePart = new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone,
    }).format(d);

    return `${datePart} às ${timePart}`;
  } catch {
    return typeof dateString === "string" ? dateString : "—";
  }
}

/**
 * Categorizes an audit action into one of the 5 LGPD audit domains.
 */
export function getAuditCategory(action: string): {
  id: "auth" | "records" | "documents" | "team" | "settings";
  label: string;
  badgeClassName: string;
} {
  const upper = (action || "").toUpperCase();

  if (
    upper.startsWith("AUTH_") ||
    upper.startsWith("SESSION_") ||
    upper.includes("LOGIN") ||
    upper.includes("PASSWORD")
  ) {
    return {
      id: "auth",
      label: "Autenticação",
      badgeClassName:
        "border-purple-500/20 bg-purple-500/10 text-purple-700 dark:text-purple-300",
    };
  }

  if (
    upper.startsWith("PATIENT_") ||
    upper.startsWith("CONSULTATION_") ||
    upper.startsWith("APPOINTMENT_") ||
    upper.startsWith("ANAMNESIS_") ||
    upper.includes("RECORD") ||
    upper.includes("CLINICAL")
  ) {
    return {
      id: "records",
      label: "Prontuário",
      badgeClassName:
        "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }

  if (
    upper.startsWith("DOCUMENT_") ||
    upper.startsWith("TEMPLATE_") ||
    upper.startsWith("PRESCRIPTION_") ||
    upper.startsWith("CERTIFICATE_")
  ) {
    return {
      id: "documents",
      label: "Documento",
      badgeClassName:
        "border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    };
  }

  if (
    upper.startsWith("TEAM_") ||
    upper.startsWith("MEMBER_") ||
    upper.startsWith("ROLE_") ||
    upper.startsWith("INVITE_") ||
    upper.includes("PERMISSION")
  ) {
    return {
      id: "team",
      label: "Equipe",
      badgeClassName:
        "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }

  return {
    id: "settings",
    label: "Configurações",
    badgeClassName:
      "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-300",
  };
}

/**
 * Formats action codes to human-friendly Portuguese labels.
 */
export function formatAuditAction(action: string): string {
  if (!action) return "Ação não informada";
  if (AUDIT_ACTION_LABELS[action]) {
    return AUDIT_ACTION_LABELS[action];
  }
  const clean = action.toLowerCase().replace(/_/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Returns a friendly resource representation (e.g. Paciente #123, Documento #456).
 */
export function formatAuditTarget(
  targetType: string,
  targetId: string,
  metadata?: Record<string, unknown>,
): string {
  const upper = (targetType || "").toUpperCase();
  const idDisplay = targetId ? `#${targetId}` : "";

  if (upper === "PATIENT") {
    if (metadata?.patientName && typeof metadata.patientName === "string") {
      return `Paciente: ${metadata.patientName} (${idDisplay})`;
    }
    return `Paciente ${idDisplay}`.trim();
  }
  if (upper === "DOCUMENT") {
    if (metadata?.documentType && typeof metadata.documentType === "string") {
      return `Documento (${metadata.documentType}) ${idDisplay}`.trim();
    }
    return `Documento ${idDisplay}`.trim();
  }
  if (upper === "APPOINTMENT") {
    return `Consulta ${idDisplay}`.trim();
  }
  if (upper === "ORGANIZATION") {
    return "Clínica";
  }
  if (upper === "ORGANIZATION_INVITE" || upper === "INVITE") {
    if (metadata?.email && typeof metadata.email === "string") {
      return `Convite (${metadata.email})`;
    }
    return `Convite ${idDisplay}`.trim();
  }
  if (upper === "SESSION") {
    return `Sessão ${idDisplay}`.trim();
  }
  if (upper === "TEMPLATE") {
    if (metadata?.templateName && typeof metadata.templateName === "string") {
      return `Modelo: ${metadata.templateName}`;
    }
    return `Modelo ${idDisplay}`.trim();
  }
  if (upper === "USER" || upper === "MEMBERSHIP") {
    return `Membro ${idDisplay}`.trim();
  }

  return targetType
    ? `${targetType} ${idDisplay}`.trim()
    : `Item ${idDisplay}`.trim();
}

/**
 * Resolves the actor display name and optional email.
 */
export function formatAuditActor(
  actorUserId: string,
  actorUser?: AuditLogActorUser | null,
  actorName?: string | null,
): { label: string; email?: string } {
  if (actorUser?.fullName) {
    return {
      label: actorUser.fullName,
      email: actorUser.email,
    };
  }
  if (actorName) {
    return { label: actorName };
  }
  if (!actorUserId || actorUserId.toLowerCase() === "system") {
    return { label: "Sistema" };
  }
  return { label: actorUserId };
}

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /key/i,
  /credential/i,
  /auth/i,
  /creditcard/i,
  /cardnumber/i,
  /cvv/i,
  /cvc/i,
  /salt/i,
  /hash/i,
  /fulltaxid/i,
];

/**
 * Checks whether a metadata key represents sensitive confidential data.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Masks tax ID values (CPF / CNPJ) for privacy.
 */
export function maskTaxIdValue(val: string): string {
  const digits = val.replace(/\D/g, "");
  if (digits.length === 11) {
    return `***.***.${digits.slice(6, 9)}-**`;
  }
  if (digits.length === 14) {
    return `**.***.***/${digits.slice(8, 12)}-**`;
  }
  return "***";
}

/**
 * Prepares metadata for safe display in the details dialog modal,
 * strictly filtering out any passwords, tokens, API keys, or raw secrets.
 */
export function sanitizeMetadataForDisplay(
  metadata: Record<string, unknown> | null | undefined,
): Array<{ key: string; label: string; value: string }> {
  if (!metadata || typeof metadata !== "object") return [];

  const entries: Array<{ key: string; label: string; value: string }> = [];

  for (const [key, rawValue] of Object.entries(metadata)) {
    // 1. Completely omit sensitive keys
    if (isSensitiveKey(key)) {
      continue;
    }

    // 2. Mask IP addresses
    if (
      key.toLowerCase() === "ip" ||
      key.toLowerCase() === "clientip" ||
      key.toLowerCase() === "ipaddress" ||
      key.toLowerCase() === "userip"
    ) {
      entries.push({
        key,
        label: "Endereço IP",
        value: maskIpAddress(String(rawValue)),
      });
      continue;
    }

    // 3. Mask tax IDs (CPF / CNPJ)
    if (key.toLowerCase() === "cpf" || key.toLowerCase() === "taxid") {
      entries.push({
        key,
        label: key.toUpperCase(),
        value: typeof rawValue === "string" ? maskTaxIdValue(rawValue) : "***",
      });
      continue;
    }

    // 4. Handle nested objects safely
    if (rawValue && typeof rawValue === "object") {
      if (Array.isArray(rawValue)) {
        entries.push({
          key,
          label: key,
          value: JSON.stringify(rawValue),
        });
      } else {
        const cleanObj: Record<string, unknown> = {};
        for (const [subKey, subVal] of Object.entries(
          rawValue as Record<string, unknown>,
        )) {
          if (!isSensitiveKey(subKey)) {
            cleanObj[subKey] = subVal;
          }
        }
        entries.push({
          key,
          label: key,
          value: JSON.stringify(cleanObj),
        });
      }
      continue;
    }

    entries.push({
      key,
      label: key,
      value: String(rawValue ?? "—"),
    });
  }

  return entries;
}

/**
 * Client-side filter helper for refining loaded events.
 */
export function matchesAuditFilter(
  item: AuditLogItem,
  filters: {
    category?: string;
    actor?: string;
    action?: string;
  },
): boolean {
  if (filters.category && filters.category !== "all") {
    const category = getAuditCategory(item.action);
    if (category.id !== filters.category) return false;
  }

  if (filters.action?.trim()) {
    const query = filters.action.trim().toLowerCase();
    const actionFriendly = formatAuditAction(item.action).toLowerCase();
    const rawAction = item.action.toLowerCase();
    if (!actionFriendly.includes(query) && !rawAction.includes(query)) {
      return false;
    }
  }

  if (filters.actor?.trim()) {
    const query = filters.actor.trim().toLowerCase();
    const actorLabel = formatAuditActor(
      item.actorUserId,
      item.actorUser,
      item.actorName,
    );
    const nameMatch = actorLabel.label.toLowerCase().includes(query);
    const emailMatch = actorLabel.email?.toLowerCase().includes(query) ?? false;
    const idMatch = item.actorUserId.toLowerCase().includes(query);
    if (!nameMatch && !emailMatch && !idMatch) {
      return false;
    }
  }

  return true;
}
