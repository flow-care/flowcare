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
  DocumentListItem,
  DocumentResponse,
  DocumentVariables,
  DocumentVersionDetailResponse,
  DocumentVersionItem,
  DocumentVersionsResponse,
  ListDocumentsQuery,
  ListDocumentsResponse,
  ListVersionsQuery,
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
  savedBy?: { id: string; fullName: string } | null;
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
  patient?: { id: string; fullName: string } | null;
  author?: { id: string; fullName: string } | null;
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

function parseDateFilter(
  value: string | undefined,
  isEndOfDay: boolean,
): Date | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const timeSuffix = isEndOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
    return new Date(`${trimmed}${timeSuffix}`);
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError("VALIDATION_ERROR", 400, "Formato de data inválido.", {
      value,
    });
  }
  return parsed;
}

function toVersionItem(
  record: DocumentVersionRecord,
  activeDocumentVersion?: number,
): DocumentVersionItem {
  const savedBy = record.savedBy
    ? { id: record.savedBy.id, fullName: record.savedBy.fullName }
    : { id: record.savedById, fullName: "Profissional" };

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
    savedBy,
    isActiveVersion:
      activeDocumentVersion !== undefined
        ? record.version === activeDocumentVersion
        : false,
    createdAt: record.createdAt.toISOString(),
  };
}

function toDocumentListItem(record: ClinicalDocumentRecord): DocumentListItem {
  const patient = record.patient
    ? { id: record.patient.id, fullName: record.patient.fullName }
    : { id: record.patientId, fullName: "Paciente" };

  const author = record.author
    ? { id: record.author.id, fullName: record.author.fullName }
    : { id: record.authorId, fullName: "Profissional" };

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
    status: record.status,
    version: record.version,
    revisionId: record.currentRevisionId,
    currentRevisionId: record.currentRevisionId,
    patient,
    author,
    issuedAt: record.issuedAt ? record.issuedAt.toISOString() : null,
    voidedAt: record.voidedAt ? record.voidedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
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

  const patient = record.patient
    ? { id: record.patient.id, fullName: record.patient.fullName }
    : { id: record.patientId, fullName: "Paciente" };

  const author = record.author
    ? { id: record.author.id, fullName: record.author.fullName }
    : { id: record.authorId, fullName: "Profissional" };

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
    patient,
    author,
    issuedAt: record.issuedAt ? record.issuedAt.toISOString() : null,
    voidedAt: record.voidedAt ? record.voidedAt.toISOString() : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    versions: sortedVersions.map((v) => toVersionItem(v, record.version)),
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

  async list(
    organizationId: string,
    query: ListDocumentsQuery,
  ): Promise<ListDocumentsResponse> {
    const where: Prisma.ClinicalDocumentWhereInput = {
      organizationId,
    };

    if (query.patientId) {
      where.patientId = query.patientId;
    }

    if (query.authorId) {
      where.authorId = query.authorId;
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.status) {
      where.status = query.status;
    }

    const searchTerm = (query.search ?? query.q)?.trim();
    if (searchTerm) {
      where.OR = [
        { title: { contains: searchTerm, mode: "insensitive" } },
        { content: { contains: searchTerm, mode: "insensitive" } },
      ];
    }

    const startDate = parseDateFilter(query.startDate, false);
    const endDate = parseDateFilter(query.endDate, true);
    if (startDate || endDate) {
      where.createdAt = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }

    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const page = Math.max(query.page ?? 1, 1);
    const sortOrder: Prisma.SortOrder = query.order === "asc" ? "asc" : "desc";

    const orderBy: Prisma.ClinicalDocumentOrderByWithRelationInput[] = [
      { updatedAt: sortOrder },
      { createdAt: sortOrder },
      { id: sortOrder },
    ];

    const totalCount = await this.prisma.clinicalDocument.count({ where });

    let findManyArgs: Prisma.ClinicalDocumentFindManyArgs = {
      where,
      orderBy,
      take: limit + 1,
      include: {
        patient: { select: { id: true, fullName: true } },
        author: { select: { id: true, fullName: true } },
      },
    };

    if (query.cursor) {
      findManyArgs = {
        ...findManyArgs,
        cursor: { id: query.cursor },
        skip: 1,
      };
    } else if (page > 1) {
      findManyArgs = {
        ...findManyArgs,
        skip: (page - 1) * limit,
      };
    }

    const rawRecords = (await this.prisma.clinicalDocument.findMany(
      findManyArgs,
    )) as unknown as ClinicalDocumentRecord[];

    const hasNextPage = rawRecords.length > limit;
    const pageRecords = hasNextPage ? rawRecords.slice(0, limit) : rawRecords;
    const lastRecord = pageRecords[pageRecords.length - 1];
    const nextCursor = hasNextPage && lastRecord ? lastRecord.id : null;

    const data = pageRecords.map(toDocumentListItem);

    return {
      data,
      documents: data,
      pageInfo: {
        limit,
        page,
        totalCount,
        hasNextPage,
        nextCursor,
      },
    };
  }

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
      select: { id: true, fullName: true },
    });
    if (!patient) {
      throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
    }

    const author = this.prisma.user
      ? await this.prisma.user.findFirst({
          where: { id: authorId },
          select: { id: true, fullName: true },
        })
      : null;

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
        patient: patient
          ? { id: patient.id, fullName: patient.fullName }
          : null,
        author: author ? { id: author.id, fullName: author.fullName } : null,
        versions: [
          {
            ...revision,
            savedBy: author
              ? { id: author.id, fullName: author.fullName }
              : null,
          },
        ],
      });
    });
  }

  async getById(
    organizationId: string,
    documentId: string,
    requestedVersion?: number,
  ): Promise<DocumentResponse> {
    const doc = (await this.prisma.clinicalDocument.findFirst({
      where: {
        id: documentId,
        organizationId,
      },
      include: {
        patient: { select: { id: true, fullName: true } },
        author: { select: { id: true, fullName: true } },
        versions: {
          include: {
            savedBy: { select: { id: true, fullName: true } },
          },
          orderBy: { version: "asc" },
        },
      },
    })) as unknown as ClinicalDocumentRecord | null;

    if (!doc) {
      throw new ApiError("NOT_FOUND", 404, "Documento não encontrado.");
    }

    if (requestedVersion !== undefined) {
      const historicalVersion = doc.versions.find(
        (v) => v.version === requestedVersion,
      );
      if (!historicalVersion) {
        throw new ApiError(
          "NOT_FOUND",
          404,
          `Versão ${requestedVersion} do documento não encontrada.`,
        );
      }

      return toDocumentResponse({
        ...doc,
        title: historicalVersion.title,
        content: historicalVersion.content,
        variables: historicalVersion.variables,
        templateId: historicalVersion.templateId,
        templateVersion: historicalVersion.templateVersion,
        version: historicalVersion.version,
        currentRevisionId: historicalVersion.id,
      });
    }

    return toDocumentResponse(doc);
  }

  async listVersions(
    organizationId: string,
    documentId: string,
    query?: ListVersionsQuery,
  ): Promise<DocumentVersionsResponse> {
    const doc = (await this.prisma.clinicalDocument.findFirst({
      where: {
        id: documentId,
        organizationId,
      },
      include: {
        versions: {
          include: {
            savedBy: { select: { id: true, fullName: true } },
          },
          orderBy: { version: "asc" },
        },
      },
    })) as unknown as ClinicalDocumentRecord | null;

    if (!doc) {
      throw new ApiError("NOT_FOUND", 404, "Documento não encontrado.");
    }

    let versionsList = (doc.versions ?? []).map((v) =>
      toVersionItem(v, doc.version),
    );

    if (query?.version !== undefined) {
      versionsList = versionsList.filter((v) => v.version === query.version);
    }

    if (query?.order === "desc") {
      versionsList.sort((a, b) => b.version - a.version);
    } else {
      versionsList.sort((a, b) => a.version - b.version);
    }

    return {
      documentId: doc.id,
      currentVersion: doc.version,
      currentRevisionId: doc.currentRevisionId,
      status: doc.status,
      data: versionsList,
      versions: versionsList,
    };
  }

  async getVersion(
    organizationId: string,
    documentId: string,
    versionIdOrNumber: string,
  ): Promise<DocumentVersionDetailResponse> {
    const doc = await this.prisma.clinicalDocument.findFirst({
      where: {
        id: documentId,
        organizationId,
      },
      select: {
        id: true,
        version: true,
      },
    });

    if (!doc) {
      throw new ApiError("NOT_FOUND", 404, "Documento não encontrado.");
    }

    const isNumeric = /^\d+$/.test(versionIdOrNumber);
    const versionRecord = (await this.prisma.documentVersion.findFirst({
      where: isNumeric
        ? {
            documentId: doc.id,
            organizationId,
            version: Number.parseInt(versionIdOrNumber, 10),
          }
        : {
            id: versionIdOrNumber,
            documentId: doc.id,
            organizationId,
          },
      include: {
        savedBy: { select: { id: true, fullName: true } },
      },
    })) as unknown as DocumentVersionRecord | null;

    if (!versionRecord) {
      throw new ApiError(
        "NOT_FOUND",
        404,
        "Versão do documento não encontrada.",
      );
    }

    const versionItem = toVersionItem(versionRecord, doc.version);
    const snapshot = {
      version: versionItem.version,
      title: versionItem.title,
      content: versionItem.content,
      variables: versionItem.variables,
      templateId: versionItem.templateId,
      templateVersion: versionItem.templateVersion,
      savedBy: versionItem.savedBy,
      createdAt: versionItem.createdAt,
    };

    return {
      ...versionItem,
      organizationId,
      snapshot,
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
        const current = (await tx.clinicalDocument.findFirst({
          where: {
            id: documentId,
            organizationId,
          },
          include: {
            patient: { select: { id: true, fullName: true } },
            author: { select: { id: true, fullName: true } },
            versions: {
              include: {
                savedBy: { select: { id: true, fullName: true } },
              },
              orderBy: { version: "asc" },
            },
          },
        })) as unknown as ClinicalDocumentRecord | null;

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

        const actor = tx.user
          ? await tx.user.findFirst({
              where: { id: actorUserId },
              select: { id: true, fullName: true },
            })
          : null;

        const populatedRevision: DocumentVersionRecord = {
          ...createdRevision,
          savedBy: actor ? { id: actor.id, fullName: actor.fullName } : null,
        };

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
          versions: [...current.versions, populatedRevision],
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
