import type {
  DocumentStatus,
  DocumentType,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type {
  CreateDocumentDraftBody,
  DocumentItem,
  DocumentResponse,
  DocumentVariables,
  DocumentVersionItem,
  DocumentVersionsResponse,
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
}
