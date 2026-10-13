import type {
  DocumentStatus,
  DocumentType,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import {
  APPROVED_TEMPLATE_VARIABLES,
  APPROVED_VARIABLE_KEY_SET,
  parseAndNormalizePlaceholders,
} from "../templates/service";
import type {
  CreateDocumentDraftBody,
  DocumentItem,
  DocumentResponse,
  DocumentSnapshotItem,
  DocumentVariables,
  DocumentVersionItem,
  DocumentVersionsResponse,
  PrepareDocumentSnapshotBody,
  PrepareDocumentSnapshotResponse,
  UpdateDocumentDraftBody,
} from "./model";

type DocumentVersionRecord = {
  id: string;
  documentId: string;
  organizationId: string;
  version: number;
  title: string;
  content: string;
  variables: Prisma.JsonValue;
  templateId: string | null;
  templateVersion: number | null;
  savedById: string;
  createdAt: Date;
};

type ClinicalDocumentRecord = {
  id: string;
  organizationId: string;
  patientId: string;
  authorId: string;
  templateId: string | null;
  templateVersion: number | null;
  type: DocumentType;
  title: string;
  content: string;
  variables: Prisma.JsonValue;
  status: DocumentStatus;
  version: number;
  currentRevisionId: string | null;
  issuedAt: Date | null;
  voidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  versions: DocumentVersionRecord[];
};

const ALLOWED_DOCUMENT_TYPES: ReadonlySet<string> = new Set([
  "PRESCRIPTION",
  "CERTIFICATE",
  "REPORT",
  "EXAM_REQUEST",
]);

function normalizeVariables(raw: unknown): DocumentVariables {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const normalized: DocumentVariables = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      normalized[key] = value;
    }
  }
  return normalized;
}

function formatDateBR(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateTimeBR(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

function formatBirthDate(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const datePart = trimmed.split("T")[0] ?? "";
      const [year, month, day] = datePart.split("-");
      if (year && month && day) {
        return `${day}/${month}/${year}`;
      }
    }
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return trimmed;
    return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  }
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return null;
    return `${String(val.getUTCDate()).padStart(2, "0")}/${String(val.getUTCMonth() + 1).padStart(2, "0")}/${val.getUTCFullYear()}`;
  }
  return null;
}

function formatAddress(org: {
  street?: string | null;
  streetNumber?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
}): string | null {
  const parts = [
    org.street,
    org.streetNumber,
    org.district,
    org.city ? (org.state ? `${org.city}/${org.state}` : org.city) : org.state,
  ].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

function toVersionItem(record: DocumentVersionRecord): DocumentVersionItem {
  return {
    id: record.id,
    revisionId: record.id,
    documentId: record.documentId,
    version: record.version,
    title: record.title,
    content: record.content,
    variables: normalizeVariables(record.variables),
    templateId: record.templateId,
    templateVersion: record.templateVersion,
    savedById: record.savedById,
    createdAt: record.createdAt.toISOString(),
  };
}

function toDocumentItem(record: ClinicalDocumentRecord): DocumentItem {
  const sortedVersions = [...record.versions].sort(
    (a, b) => a.version - b.version,
  );
  const latestRevisionId =
    record.currentRevisionId ??
    sortedVersions[sortedVersions.length - 1]?.id ??
    null;

  return {
    id: record.id,
    documentId: record.id,
    organizationId: record.organizationId,
    patientId: record.patientId,
    authorId: record.authorId,
    templateId: record.templateId,
    templateVersion: record.templateVersion,
    type: record.type,
    title: record.title,
    content: record.content,
    variables: normalizeVariables(record.variables),
    status: record.status,
    version: record.version,
    revisionId: latestRevisionId,
    currentRevisionId: latestRevisionId,
    issuedAt: record.issuedAt ? record.issuedAt.toISOString() : null,
    voidedAt: record.voidedAt ? record.voidedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    versions: sortedVersions.map(toVersionItem),
  };
}

function toDocumentResponse(record: ClinicalDocumentRecord): DocumentResponse {
  const item = toDocumentItem(record);
  return {
    ...item,
    document: item,
  };
}

const versionConflictError = () =>
  new ApiError(
    "VERSION_CONFLICT",
    409,
    "O rascunho foi alterado por outra sessão. Recarregue antes de salvar.",
  );

export class DocumentsService {
  constructor(private readonly prisma: PrismaClient) {}

  async createDraft(
    organizationId: string,
    authorId: string,
    body: CreateDocumentDraftBody,
  ): Promise<DocumentResponse> {
    if (!ALLOWED_DOCUMENT_TYPES.has(body.type)) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Tipo de documento não permitido no MVP.",
        { field: "type" },
      );
    }

    const patient = await this.prisma.patient.findFirst({
      where: {
        id: body.patientId,
        organizationId,
      },
      select: { id: true },
    });
    if (!patient) {
      throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
    }

    let resolvedTemplateId: string | null = null;
    let resolvedTemplateVersion: number | null = null;
    let templateTitle: string | undefined;
    let templateBody: string | undefined;

    if (body.templateId !== undefined && body.templateId !== null) {
      const template = await this.prisma.documentTemplate.findFirst({
        where: {
          id: body.templateId,
          OR: [{ organizationId }, { organizationId: null }],
        },
        select: {
          id: true,
          title: true,
          type: true,
          bodyTemplate: true,
          status: true,
          version: true,
        },
      });
      if (!template) {
        throw new ApiError(
          "NOT_FOUND",
          404,
          "Modelo de documento não encontrado.",
        );
      }
      if (template.status !== "ACTIVE") {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          "Modelo arquivado não pode ser utilizado em novos rascunhos.",
          { field: "templateId", reason: "TEMPLATE_ARCHIVED" },
        );
      }
      if (template.type !== body.type) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          "O tipo do documento não corresponde ao tipo do modelo selecionado.",
          { field: "type", expectedType: template.type },
        );
      }
      resolvedTemplateId = template.id;
      resolvedTemplateVersion = template.version;
      templateTitle = template.title;
      templateBody = template.bodyTemplate;
    }

    const resolvedTitle = (body.title ?? templateTitle ?? "").trim();
    if (!resolvedTitle) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Título do documento é obrigatório.",
        { field: "title" },
      );
    }

    const rawContent = body.content ?? body.body ?? templateBody;
    const resolvedContent = (rawContent ?? "").trim();
    if (!resolvedContent) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Conteúdo do rascunho é obrigatório.",
        { field: "content" },
      );
    }

    const resolvedVariables = normalizeVariables(body.variables ?? {});
    const now = new Date();
    const initialRevisionId = crypto.randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.clinicalDocument.create({
        data: {
          organizationId,
          patientId: patient.id,
          authorId,
          templateId: resolvedTemplateId,
          templateVersion: resolvedTemplateVersion,
          type: body.type,
          title: resolvedTitle,
          content: resolvedContent,
          variables: resolvedVariables,
          status: "DRAFT",
          version: 1,
          currentRevisionId: initialRevisionId,
          createdAt: now,
          updatedAt: now,
        },
      });

      const revision = await tx.documentVersion.create({
        data: {
          id: initialRevisionId,
          documentId: created.id,
          organizationId,
          version: 1,
          title: resolvedTitle,
          content: resolvedContent,
          variables: resolvedVariables,
          templateId: resolvedTemplateId,
          templateVersion: resolvedTemplateVersion,
          savedById: authorId,
          createdAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId: authorId,
          action: "DOCUMENT_DRAFT_CREATED",
          targetType: "DOCUMENT",
          targetId: created.id,
          metadata: {
            patientId: patient.id,
            type: body.type,
            version: 1,
            revisionId: revision.id,
            templateId: resolvedTemplateId,
            templateVersion: resolvedTemplateVersion,
          },
        },
      });

      return toDocumentResponse({
        ...created,
        currentRevisionId: revision.id,
        versions: [revision],
      });
    });
  }

  async getById(
    organizationId: string,
    documentId: string,
  ): Promise<DocumentResponse> {
    const doc = await this.prisma.clinicalDocument.findFirst({
      where: {
        id: documentId,
        organizationId,
      },
      include: {
        versions: {
          orderBy: { version: "asc" },
        },
      },
    });
    if (!doc) {
      throw new ApiError("NOT_FOUND", 404, "Documento não encontrado.");
    }
    return toDocumentResponse(doc);
  }

  async listVersions(
    organizationId: string,
    documentId: string,
  ): Promise<DocumentVersionsResponse> {
    const doc = await this.prisma.clinicalDocument.findFirst({
      where: {
        id: documentId,
        organizationId,
      },
      include: {
        versions: {
          orderBy: { version: "asc" },
        },
      },
    });
    if (!doc) {
      throw new ApiError("NOT_FOUND", 404, "Documento não encontrado.");
    }
    const item = toDocumentItem(doc);
    return {
      documentId: item.id,
      currentVersion: item.version,
      currentRevisionId: item.currentRevisionId,
      status: item.status,
      versions: item.versions,
    };
  }

  async updateDraft(
    organizationId: string,
    actorUserId: string,
    documentId: string,
    body: UpdateDocumentDraftBody,
  ): Promise<DocumentResponse> {
    const hasEditableField =
      body.title !== undefined ||
      body.content !== undefined ||
      body.body !== undefined ||
      body.templateId !== undefined ||
      body.variables !== undefined;

    if (!hasEditableField) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Informe ao menos um campo para atualizar o rascunho.",
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.clinicalDocument.findFirst({
          where: {
            id: documentId,
            organizationId,
          },
          include: {
            versions: {
              orderBy: { version: "asc" },
            },
          },
        });

        if (!current) {
          throw new ApiError("NOT_FOUND", 404, "Documento não encontrado.");
        }

        if (current.status !== "DRAFT") {
          throw new ApiError(
            "DOCUMENT_STATE_CONFLICT",
            409,
            "Documento emitido não pode ser atualizado por este comando.",
            {
              currentStatus: current.status,
              reason: "DOCUMENT_NOT_EDITABLE",
            },
          );
        }

        if (current.version !== body.version) {
          throw versionConflictError();
        }

        let nextTemplateId = current.templateId;
        let nextTemplateVersion = current.templateVersion;

        if (body.templateId !== undefined) {
          if (body.templateId === null) {
            nextTemplateId = null;
            nextTemplateVersion = null;
          } else {
            const template = await tx.documentTemplate.findFirst({
              where: {
                id: body.templateId,
                OR: [{ organizationId }, { organizationId: null }],
              },
              select: {
                id: true,
                type: true,
                status: true,
                version: true,
              },
            });
            if (!template) {
              throw new ApiError(
                "NOT_FOUND",
                404,
                "Modelo de documento não encontrado.",
              );
            }
            if (template.status !== "ACTIVE") {
              throw new ApiError(
                "VALIDATION_ERROR",
                400,
                "Modelo arquivado não pode ser utilizado em rascunhos.",
                { field: "templateId", reason: "TEMPLATE_ARCHIVED" },
              );
            }
            if (template.type !== current.type) {
              throw new ApiError(
                "VALIDATION_ERROR",
                400,
                "O tipo do modelo selecionado não corresponde ao tipo do documento.",
                { field: "templateId", expectedType: current.type },
              );
            }
            nextTemplateId = template.id;
            nextTemplateVersion = template.version;
          }
        }

        let nextTitle = current.title;
        if (body.title !== undefined) {
          const trimmedTitle = body.title.trim();
          if (!trimmedTitle) {
            throw new ApiError(
              "VALIDATION_ERROR",
              400,
              "Título do documento é obrigatório.",
              { field: "title" },
            );
          }
          nextTitle = trimmedTitle;
        }

        let nextContent = current.content;
        if (body.content !== undefined || body.body !== undefined) {
          const trimmedContent = (body.content ?? body.body ?? "").trim();
          if (!trimmedContent) {
            throw new ApiError(
              "VALIDATION_ERROR",
              400,
              "Conteúdo do rascunho é obrigatório.",
              { field: "content" },
            );
          }
          nextContent = trimmedContent;
        }

        const nextVariables =
          body.variables !== undefined
            ? normalizeVariables(body.variables)
            : normalizeVariables(current.variables);

        const nextVersion = body.version + 1;
        const nextRevisionId = crypto.randomUUID();
        const now = new Date();

        const updated = await tx.clinicalDocument.updateMany({
          where: {
            id: documentId,
            organizationId,
            status: "DRAFT",
            version: body.version,
          },
          data: {
            title: nextTitle,
            content: nextContent,
            variables: nextVariables,
            templateId: nextTemplateId,
            templateVersion: nextTemplateVersion,
            version: nextVersion,
            currentRevisionId: nextRevisionId,
            updatedAt: now,
          },
        });

        if (updated.count !== 1) {
          throw versionConflictError();
        }

        const createdRevision = await tx.documentVersion.create({
          data: {
            id: nextRevisionId,
            documentId: current.id,
            organizationId,
            version: nextVersion,
            title: nextTitle,
            content: nextContent,
            variables: nextVariables,
            templateId: nextTemplateId,
            templateVersion: nextTemplateVersion,
            savedById: actorUserId,
            createdAt: now,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId,
            action: "DOCUMENT_DRAFT_UPDATED",
            targetType: "DOCUMENT",
            targetId: current.id,
            metadata: {
              previousVersion: current.version,
              newVersion: nextVersion,
              revisionId: createdRevision.id,
              templateId: nextTemplateId,
              templateVersion: nextTemplateVersion,
            },
          },
        });

        return toDocumentResponse({
          ...current,
          title: nextTitle,
          content: nextContent,
          variables: nextVariables,
          templateId: nextTemplateId,
          templateVersion: nextTemplateVersion,
          version: nextVersion,
          currentRevisionId: createdRevision.id,
          updatedAt: now,
          versions: [...current.versions, createdRevision],
        });
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        ["P2002", "P2034"].includes(String(error.code))
      ) {
        throw versionConflictError();
      }
      throw error;
    }
  }

  async prepareSnapshot(
    organizationId: string,
    actorUserId: string,
    documentId: string,
    body?: PrepareDocumentSnapshotBody | null,
  ): Promise<PrepareDocumentSnapshotResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.clinicalDocument.findFirst({
          where: {
            id: documentId,
            organizationId,
          },
          include: {
            versions: {
              orderBy: { version: "asc" },
            },
          },
        });

        if (!current) {
          throw new ApiError("NOT_FOUND", 404, "Documento não encontrado.");
        }

        if (current.status !== "DRAFT") {
          throw new ApiError(
            "DOCUMENT_NOT_EDITABLE",
            409,
            "Documento fora do estado de rascunho não pode ter snapshot preparado.",
            {
              currentStatus: current.status,
              reason: "DOCUMENT_NOT_EDITABLE",
            },
          );
        }

        if (!ALLOWED_DOCUMENT_TYPES.has(current.type)) {
          throw new ApiError(
            "BUSINESS_RULE_VIOLATION",
            422,
            "Tipo de documento não suportado no MVP de emissão.",
            {
              type: current.type,
              reason: "UNSUPPORTED_DOCUMENT_TYPE",
              allowedTypes: Array.from(ALLOWED_DOCUMENT_TYPES),
            },
          );
        }

        if (body?.type && !ALLOWED_DOCUMENT_TYPES.has(body.type)) {
          throw new ApiError(
            "BUSINESS_RULE_VIOLATION",
            422,
            "Tipo de documento não suportado no MVP de emissão.",
            {
              type: body.type,
              reason: "UNSUPPORTED_DOCUMENT_TYPE",
              allowedTypes: Array.from(ALLOWED_DOCUMENT_TYPES),
            },
          );
        }

        if (body?.version !== undefined && current.version !== body.version) {
          throw versionConflictError();
        }

        const patient = await tx.patient.findFirst({
          where: {
            id: current.patientId,
            organizationId,
          },
        });
        if (!patient) {
          throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
        }

        const organization = await tx.organization.findFirst({
          where: {
            id: organizationId,
          },
        });
        if (!organization) {
          throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
        }

        const author = await tx.user.findFirst({
          where: {
            id: current.authorId,
          },
        });
        if (!author) {
          throw new ApiError(
            "NOT_FOUND",
            404,
            "Autor do documento não encontrado.",
          );
        }

        const parsedContent = parseAndNormalizePlaceholders(
          current.content,
          "content",
        );
        const parsedTitle = parseAndNormalizePlaceholders(
          current.title,
          "title",
        );

        const currentVars = normalizeVariables(current.variables);
        const bodyVars = body?.variables
          ? normalizeVariables(body.variables)
          : {};
        const allReferencedVariables = new Set([
          ...parsedContent.variables,
          ...parsedTitle.variables,
          ...Object.keys(currentVars),
          ...Object.keys(bodyVars),
        ]);

        const unknownVariables = Array.from(allReferencedVariables).filter(
          (key) => !APPROVED_VARIABLE_KEY_SET.has(key),
        );
        if (unknownVariables.length > 0) {
          throw new ApiError(
            "INVALID_VARIABLES",
            422,
            `Variáveis automáticas fora do catálogo homologado: ${unknownVariables.map((v) => `{${v}}`).join(", ")}.`,
            {
              invalidVariables: unknownVariables,
              unknownVariables,
              allowedVariables: APPROVED_TEMPLATE_VARIABLES.map((v) => v.key),
            },
          );
        }

        const now = new Date();
        const formattedDate = formatDateBR(now);
        const formattedDateTime = formatDateTimeBR(now);
        const formattedBirthDate = formatBirthDate(patient.birthDate);
        const formattedAddress = formatAddress(organization);

        const resolvedValues: Record<string, string | null> = {
          paciente_nome: patient.fullName?.trim() || null,
          paciente_cpf: patient.cpf?.trim() || null,
          paciente_data_nascimento: formattedBirthDate,
          clinica_nome: organization.name?.trim() || null,
          clinica_cnpj: organization.taxId?.trim() || null,
          clinica_endereco: formattedAddress,
          clinica_telefone: organization.contactPhone?.trim() || null,
          profissional_nome: author.fullName?.trim() || null,
          medico_nome: author.fullName?.trim() || null,
          profissional_registro: author.registrationNumber?.trim() || null,
          profissional_crm: author.registrationNumber?.trim() || null,
          medico_crm: author.registrationNumber?.trim() || null,
          profissional_titulo: author.professionalTitle?.trim() || null,
          data_emissao: formattedDate,
          data_atual: formattedDate,
          data_hora_emissao: formattedDateTime,
        };

        const missingFields: string[] = [];

        if (!resolvedValues.paciente_nome) {
          missingFields.push("paciente_nome");
        }
        if (!resolvedValues.clinica_nome) {
          missingFields.push("clinica_nome");
        }
        if (!resolvedValues.profissional_nome) {
          missingFields.push("profissional_nome");
        }
        if (!author.registrationNumber?.trim()) {
          if (
            allReferencedVariables.has("profissional_registro") &&
            !allReferencedVariables.has("profissional_crm")
          ) {
            missingFields.push("profissional_registro");
          } else {
            missingFields.push("profissional_crm");
          }
        }
        if (!current.content?.trim()) {
          missingFields.push("content");
        }
        if (!current.title?.trim()) {
          missingFields.push("title");
        }

        for (const varKey of allReferencedVariables) {
          const spec = APPROVED_TEMPLATE_VARIABLES.find(
            (item) => item.key === varKey,
          );
          if (
            spec?.required &&
            (!resolvedValues[varKey] || resolvedValues[varKey]?.trim() === "")
          ) {
            missingFields.push(varKey);
          }
        }

        if (missingFields.length > 0) {
          throw new ApiError(
            "VALIDATION_ERROR",
            422,
            "Campos obrigatórios ausentes ou não preenchíveis para o documento.",
            {
              missingFields: Array.from(new Set(missingFields)),
            },
          );
        }

        const frozenVariables: DocumentVariables = {};
        for (const [key, val] of Object.entries(resolvedValues)) {
          if (val !== null && val !== undefined && val !== "") {
            frozenVariables[key] = val;
          }
        }

        let frozenContent = parsedContent.normalizedText;
        let frozenTitle = parsedTitle.normalizedText;

        for (const item of APPROVED_TEMPLATE_VARIABLES) {
          const key = item.key;
          const placeholder = `{${key}}`;
          const val = resolvedValues[key];
          const replacement = val ?? "";
          frozenContent = frozenContent.replaceAll(placeholder, replacement);
          frozenTitle = frozenTitle.replaceAll(placeholder, replacement);
        }

        const nextVersion = current.version + 1;
        const nextRevisionId = crypto.randomUUID();

        const updated = await tx.clinicalDocument.updateMany({
          where: {
            id: documentId,
            organizationId,
            status: "DRAFT",
            version: current.version,
          },
          data: {
            title: frozenTitle,
            content: frozenContent,
            variables: frozenVariables,
            version: nextVersion,
            currentRevisionId: nextRevisionId,
            updatedAt: now,
          },
        });

        if (updated.count !== 1) {
          throw versionConflictError();
        }

        const createdRevision = await tx.documentVersion.create({
          data: {
            id: nextRevisionId,
            documentId: current.id,
            organizationId,
            version: nextVersion,
            title: frozenTitle,
            content: frozenContent,
            variables: frozenVariables,
            templateId: current.templateId,
            templateVersion: current.templateVersion,
            savedById: actorUserId,
            createdAt: now,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId,
            action: "DOCUMENT_SNAPSHOT_PREPARED",
            targetType: "DOCUMENT",
            targetId: current.id,
            metadata: {
              previousVersion: current.version,
              newVersion: nextVersion,
              revisionId: createdRevision.id,
              type: current.type,
              patientId: current.patientId,
              templateId: current.templateId,
              templateVersion: current.templateVersion,
            },
          },
        });

        const updatedDocRecord: ClinicalDocumentRecord = {
          ...current,
          title: frozenTitle,
          content: frozenContent,
          variables: frozenVariables,
          version: nextVersion,
          currentRevisionId: nextRevisionId,
          updatedAt: now,
          versions: [...current.versions, createdRevision],
        };

        const docItem = toDocumentItem(updatedDocRecord);
        const snapshotItem: DocumentSnapshotItem = {
          documentId: current.id,
          version: nextVersion,
          revisionId: nextRevisionId,
          type: current.type,
          title: frozenTitle,
          content: frozenContent,
          variables: frozenVariables,
          preparedAt: now.toISOString(),
        };

        return {
          ...docItem,
          document: docItem,
          snapshot: snapshotItem,
        };
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        ["P2002", "P2034"].includes(String(error.code))
      ) {
        throw versionConflictError();
      }
      throw error;
    }
  }
}
