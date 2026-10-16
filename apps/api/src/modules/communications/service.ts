import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { recordAuditEvent } from "../../services/audit-logger";
import type { WahaSession, WhatsAppProvider } from "../../services/waha-client";
import {
  type ConnectionStatus,
  type SaveWhatsAppTemplateBody,
  WHATSAPP_TEMPLATE_MAX_LENGTH,
  type WhatsAppTemplateItem,
  type WhatsAppTemplatePreviewResponse,
  type WhatsAppTemplateType,
  type WhatsAppTemplateVersionItem,
} from "./model";

const QR_TTL_MS = 20_000;

const ALLOWED_TEMPLATE_VARIABLES: Record<
  WhatsAppTemplateType,
  readonly string[]
> = {
  APPOINTMENT_CONFIRMATION: [
    "paciente_nome",
    "data",
    "hora",
    "medico_nome",
    "clinica_nome",
  ],
  APPOINTMENT_CANCELLATION: ["paciente_nome", "data", "hora", "clinica_nome"],
  APPOINTMENT_REMINDER_24H: [
    "paciente_nome",
    "data",
    "hora",
    "medico_nome",
    "clinica_nome",
  ],
};

const FICTIONAL_PREVIEW_VALUES: Readonly<Record<string, string>> = {
  paciente_nome: "Maria da Silva",
  data: "20/10/2026",
  hora: "14:30",
  medico_nome: "Dra. Ana Oliveira",
  clinica_nome: "Clínica Exemplo",
};

type CurrentTemplateRow = {
  id: string;
  organizationId: string;
  type: WhatsAppTemplateType;
  content: string;
  version: number;
  approvedById: string;
  approvedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type TemplateVersionRow = {
  type: WhatsAppTemplateType;
  content: string;
  version: number;
  approvedById: string;
  approvedAt: Date;
  createdAt: Date;
};

export class CommunicationsService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      provider: WhatsAppProvider;
      now?: () => Date;
    },
  ) {}

  async status(organizationId: string) {
    const binding = await this.deps.prisma.whatsAppSession.findUnique({
      where: { organizationId },
      select: { providerSessionName: true },
    });
    if (!binding) return { status: "DISCONNECTED" as const, phoneNumber: null };
    const session = await this.deps.provider.getSession(
      binding.providerSessionName,
    );
    return session
      ? publicSession(session)
      : { status: "DISCONNECTED" as const, phoneNumber: null };
  }

  async reconnect(organizationId: string) {
    const binding = await this.deps.prisma.whatsAppSession.upsert({
      where: { organizationId },
      create: {
        organizationId,
        providerSessionName: `flowcare-${crypto.randomUUID()}`,
      },
      update: {},
      select: { providerSessionName: true },
    });

    let session = await this.deps.provider.getSession(
      binding.providerSessionName,
    );
    if (!session) {
      session = await this.deps.provider.createSession(
        binding.providerSessionName,
      );
    } else if (
      session.status !== "WORKING" &&
      session.status !== "SCAN_QR_CODE"
    ) {
      await this.deps.provider.restartSession(binding.providerSessionName);
      session =
        (await this.deps.provider.getSession(binding.providerSessionName)) ??
        session;
    }

    const current = publicSession(session);
    const qr =
      current.status === "QR_CODE_REQUIRED"
        ? await this.deps.provider.getQr(binding.providerSessionName)
        : null;
    const now = this.deps.now?.() ?? new Date();
    return {
      ...current,
      qrCode: qr ? `data:${qr.mimetype};base64,${qr.data}` : null,
      qrExpiresAt: qr
        ? new Date(now.getTime() + QR_TTL_MS).toISOString()
        : null,
    };
  }

  async listTemplates(
    organizationId: string,
  ): Promise<{ data: WhatsAppTemplateItem[] }> {
    const rows = await this.deps.prisma.whatsAppTemplate.findMany({
      where: { organizationId },
      orderBy: { type: "asc" },
    });

    return { data: rows.map((row) => toTemplateItem(row)) };
  }

  previewTemplate(
    type: WhatsAppTemplateType,
    content: string,
  ): WhatsAppTemplatePreviewResponse {
    const validated = validateWhatsAppTemplate(type, content);
    const variables = Object.fromEntries(
      validated.variables.map((key) => [key, fictionalPreviewValue(key)]),
    );

    return {
      isExample: true,
      type,
      content: renderTemplate(validated.content, variables),
      variables,
      allowedVariables: allowedPlaceholders(type),
      maxLength: WHATSAPP_TEMPLATE_MAX_LENGTH,
    };
  }

  async saveTemplate(
    organizationId: string,
    actorUserId: string,
    type: WhatsAppTemplateType,
    body: SaveWhatsAppTemplateBody,
  ): Promise<WhatsAppTemplateItem> {
    const validated = validateWhatsAppTemplate(type, body.content);

    try {
      const saved = await this.runInTransaction(async (tx) => {
        const existing = await tx.whatsAppTemplate.findUnique({
          where: { organizationId_type: { organizationId, type } },
        });

        if (!existing) {
          if (body.version !== 0) {
            throw versionConflict(body.version, 0);
          }

          const approvedAt = this.deps.now?.() ?? new Date();
          const created = await tx.whatsAppTemplate.create({
            data: {
              organizationId,
              type,
              content: validated.content,
              version: 1,
              approvedById: actorUserId,
              approvedAt,
            },
          });

          await tx.whatsAppTemplateVersion.create({
            data: {
              templateId: created.id,
              organizationId,
              type,
              content: validated.content,
              version: 1,
              approvedById: actorUserId,
              approvedAt,
            },
          });

          await recordAuditEvent(
            tx,
            {
              organizationId,
              actorUserId,
              action: "WHATSAPP_TEMPLATE_CREATED",
              targetType: "WHATSAPP_TEMPLATE",
              targetId: created.id,
              metadata: {
                templateType: type,
                previousVersion: 0,
                newVersion: 1,
                changedFields: ["content"],
                variables: validated.variables,
                approvalMethod: "ADMIN_SAVE",
              },
            },
            { requirePersistence: true },
          );

          return created;
        }

        if (existing.version !== body.version) {
          throw versionConflict(body.version, existing.version);
        }

        if (existing.content === validated.content) {
          return existing;
        }

        const approvedAt = this.deps.now?.() ?? new Date();
        const nextVersion = existing.version + 1;
        const updated = await tx.whatsAppTemplate.updateMany({
          where: {
            id: existing.id,
            organizationId,
            type,
            version: body.version,
          },
          data: {
            content: validated.content,
            version: nextVersion,
            approvedById: actorUserId,
            approvedAt,
            updatedAt: approvedAt,
          },
        });

        if (updated.count !== 1) {
          throw versionConflict(body.version);
        }

        await tx.whatsAppTemplateVersion.create({
          data: {
            templateId: existing.id,
            organizationId,
            type,
            content: validated.content,
            version: nextVersion,
            approvedById: actorUserId,
            approvedAt,
          },
        });

        await recordAuditEvent(
          tx,
          {
            organizationId,
            actorUserId,
            action: "WHATSAPP_TEMPLATE_UPDATED",
            targetType: "WHATSAPP_TEMPLATE",
            targetId: existing.id,
            metadata: {
              templateType: type,
              previousVersion: existing.version,
              newVersion: nextVersion,
              changedFields: ["content"],
              variables: validated.variables,
              approvalMethod: "ADMIN_SAVE",
            },
          },
          { requirePersistence: true },
        );

        return {
          ...existing,
          content: validated.content,
          version: nextVersion,
          approvedById: actorUserId,
          approvedAt,
          updatedAt: approvedAt,
        };
      });

      return toTemplateItem(saved);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        ["P2002", "P2034"].includes(String(error.code))
      ) {
        throw versionConflict(body.version);
      }
      throw error;
    }
  }

  async listTemplateVersions(
    organizationId: string,
    type: WhatsAppTemplateType,
  ): Promise<{ data: WhatsAppTemplateVersionItem[] }> {
    const template = await this.getOrganizationTemplate(organizationId, type);
    const rows = await this.deps.prisma.whatsAppTemplateVersion.findMany({
      where: { organizationId, templateId: template.id },
      orderBy: { version: "asc" },
    });

    return { data: rows.map((row) => toTemplateVersionItem(row)) };
  }

  async getTemplateVersion(
    organizationId: string,
    type: WhatsAppTemplateType,
    version: number,
  ): Promise<WhatsAppTemplateVersionItem> {
    const template = await this.getOrganizationTemplate(organizationId, type);
    const row = await this.deps.prisma.whatsAppTemplateVersion.findFirst({
      where: { organizationId, templateId: template.id, version },
    });

    if (!row) {
      throw new ApiError(
        "NOT_FOUND",
        404,
        "Versão do template de WhatsApp não encontrada.",
      );
    }

    return toTemplateVersionItem(row);
  }

  private async getOrganizationTemplate(
    organizationId: string,
    type: WhatsAppTemplateType,
  ) {
    const template = await this.deps.prisma.whatsAppTemplate.findUnique({
      where: { organizationId_type: { organizationId, type } },
      select: { id: true },
    });

    if (!template) {
      throw new ApiError(
        "NOT_FOUND",
        404,
        "Template de WhatsApp não encontrado.",
      );
    }

    return template;
  }

  private async runInTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (typeof this.deps.prisma.$transaction === "function") {
      return this.deps.prisma.$transaction(fn);
    }
    return fn(this.deps.prisma as unknown as Prisma.TransactionClient);
  }
}

export function allowedTemplateVariables(
  type: WhatsAppTemplateType,
): readonly string[] {
  return ALLOWED_TEMPLATE_VARIABLES[type];
}

export function validateWhatsAppTemplate(
  type: WhatsAppTemplateType,
  content: string,
): { content: string; variables: string[] } {
  if (content.length > WHATSAPP_TEMPLATE_MAX_LENGTH) {
    throw new ApiError(
      "INVALID_TEMPLATE_STRUCTURE",
      422,
      `O template de WhatsApp excede ${WHATSAPP_TEMPLATE_MAX_LENGTH} caracteres.`,
      { maxLength: WHATSAPP_TEMPLATE_MAX_LENGTH },
    );
  }

  if (hasDisallowedControlCharacters(content)) {
    throw new ApiError(
      "INVALID_TEMPLATE_STRUCTURE",
      422,
      "O template de WhatsApp contém caracteres de controle não permitidos.",
    );
  }

  const trimmed = content.trim();
  if (!trimmed) {
    throw new ApiError(
      "INVALID_TEMPLATE_STRUCTURE",
      422,
      "O template de WhatsApp não pode estar vazio.",
    );
  }

  const variables: string[] = [];
  let normalized = "";

  for (let index = 0; index < trimmed.length; index++) {
    const character = trimmed.charAt(index);
    if (character === "}") {
      throw malformedPlaceholder(index);
    }
    if (character !== "{") {
      normalized += character;
      continue;
    }

    const closingIndex = trimmed.indexOf("}", index + 1);
    if (closingIndex === -1) {
      throw malformedPlaceholder(index);
    }

    const rawKey = trimmed.slice(index + 1, closingIndex);
    if (rawKey.includes("{") || /[\r\n]/.test(rawKey)) {
      throw malformedPlaceholder(index);
    }

    const key = rawKey.trim();
    if (!/^[a-z][a-z0-9_]*$/.test(key)) {
      throw malformedPlaceholder(index);
    }

    variables.push(key);
    normalized += `{${key}}`;
    index = closingIndex;
  }

  const uniqueVariables = Array.from(new Set(variables));
  const allowed = new Set(allowedTemplateVariables(type));
  const invalidVariables = uniqueVariables.filter((key) => !allowed.has(key));
  if (invalidVariables.length > 0) {
    throw new ApiError(
      "INVALID_TEMPLATE_VARIABLE",
      422,
      `Variável não permitida para ${type}: ${invalidVariables.map((key) => `{${key}}`).join(", ")}.`,
      {
        type,
        invalidVariables,
        allowedVariables: [...allowed],
      },
    );
  }

  return { content: normalized, variables: uniqueVariables };
}

function malformedPlaceholder(position: number) {
  return new ApiError(
    "INVALID_TEMPLATE_STRUCTURE",
    422,
    "O template de WhatsApp contém uma variável malformada.",
    { position },
  );
}

function hasDisallowedControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
      code === 127
    ) {
      return true;
    }
  }
  return false;
}

function allowedPlaceholders(type: WhatsAppTemplateType): string[] {
  return allowedTemplateVariables(type).map((key) => `{${key}}`);
}

function fictionalPreviewValue(key: string): string {
  const value = FICTIONAL_PREVIEW_VALUES[key];
  if (value === undefined) {
    throw new ApiError(
      "INTERNAL",
      500,
      "Exemplo fictício indisponível para a variável do template.",
    );
  }
  return value;
}

function renderTemplate(
  content: string,
  variables: Readonly<Record<string, string>>,
): string {
  return content.replace(
    /\{([a-z][a-z0-9_]*)\}/g,
    (placeholder, key: string) => variables[key] ?? placeholder,
  );
}

function toTemplateItem(row: CurrentTemplateRow): WhatsAppTemplateItem {
  return {
    type: row.type,
    content: row.content,
    version: row.version,
    allowedVariables: allowedPlaceholders(row.type),
    maxLength: WHATSAPP_TEMPLATE_MAX_LENGTH,
    approvedById: row.approvedById,
    approvedAt: row.approvedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTemplateVersionItem(
  row: TemplateVersionRow,
): WhatsAppTemplateVersionItem {
  return {
    type: row.type,
    content: row.content,
    version: row.version,
    approvedById: row.approvedById,
    approvedAt: row.approvedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function versionConflict(expectedVersion: number, currentVersion?: number) {
  return new ApiError(
    "VERSION_CONFLICT",
    409,
    "O template de WhatsApp foi alterado por outra sessão. Recarregue e tente novamente.",
    {
      expectedVersion,
      ...(currentVersion === undefined ? {} : { currentVersion }),
    },
  );
}

export function normalizeWahaStatus(status: string): ConnectionStatus {
  switch (status) {
    case "WORKING":
      return "CONNECTED";
    case "SCAN_QR_CODE":
    case "PASSKEY_REQUIRED":
    case "PASSKEY_CONFIRMATION_REQUIRED":
      return "QR_CODE_REQUIRED";
    case "STARTING":
      return "CONNECTING";
    case "STOPPED":
      return "DISCONNECTED";
    default:
      return "ERROR";
  }
}

function publicSession(session: WahaSession) {
  return {
    status: normalizeWahaStatus(session.status),
    phoneNumber: phoneNumberFromProviderId(session.me?.id),
  };
}

function phoneNumberFromProviderId(id: string | null | undefined) {
  if (!id) return null;
  const value = id.split("@")[0]?.replace(/\D/g, "") ?? "";
  return value || null;
}
