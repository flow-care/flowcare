import type {
  DocumentType,
  Prisma,
  PrismaClient,
  TemplateStatus,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type {
  CreateTemplateBody,
  ListTemplatesQuery,
  ListTemplatesResponse,
  TemplateDetailResponse,
  TemplateItem,
  TemplateVariableItem,
  TemplateVariablesResponse,
  TemplateVersionItem,
  TemplateVersionsResponse,
  UpdateTemplateBody,
} from "./model";

export const APPROVED_TEMPLATE_VARIABLES: readonly TemplateVariableItem[] = [
  {
    key: "paciente_nome",
    placeholder: "{paciente_nome}",
    label: "Nome do paciente",
    description: "Nome completo do paciente vinculado ao documento.",
    type: "string",
    category: "PATIENT",
    required: true,
    source: "patient.fullName",
    example: "Maria da Silva",
  },
  {
    key: "paciente_cpf",
    placeholder: "{paciente_cpf}",
    label: "CPF do paciente",
    description: "CPF formatado do paciente, quando cadastrado.",
    type: "string",
    category: "PATIENT",
    required: false,
    source: "patient.cpf",
    example: "123.456.789-00",
  },
  {
    key: "paciente_data_nascimento",
    placeholder: "{paciente_data_nascimento}",
    label: "Data de nascimento do paciente",
    description: "Data de nascimento do paciente no formato local.",
    type: "date",
    category: "PATIENT",
    required: false,
    source: "patient.birthDate",
    example: "20/05/1985",
  },
  {
    key: "clinica_nome",
    placeholder: "{clinica_nome}",
    label: "Nome da clínica",
    description: "Nome de exibição da clínica ativa.",
    type: "string",
    category: "CLINIC",
    required: true,
    source: "organization.name",
    example: "Clínica Vida & Saúde",
  },
  {
    key: "clinica_cnpj",
    placeholder: "{clinica_cnpj}",
    label: "CNPJ da clínica",
    description: "CNPJ institucional da clínica, quando configurado.",
    type: "string",
    category: "CLINIC",
    required: false,
    source: "organization.taxId",
    example: "12.345.678/0001-90",
  },
  {
    key: "clinica_endereco",
    placeholder: "{clinica_endereco}",
    label: "Endereço da clínica",
    description: "Endereço institucional da clínica ativa.",
    type: "string",
    category: "CLINIC",
    required: false,
    source: "organization.address",
    example: "Av. Paulista, 1000 - São Paulo/SP",
  },
  {
    key: "clinica_telefone",
    placeholder: "{clinica_telefone}",
    label: "Telefone da clínica",
    description: "Telefone institucional de contato da clínica.",
    type: "string",
    category: "CLINIC",
    required: false,
    source: "organization.contactPhone",
    example: "(11) 98765-4321",
  },
  {
    key: "profissional_nome",
    placeholder: "{profissional_nome}",
    label: "Nome do profissional",
    description: "Nome completo do profissional emissor do documento.",
    type: "string",
    category: "PROFESSIONAL",
    required: true,
    source: "professional.fullName",
    example: "Dra. Ana Oliveira",
  },
  {
    key: "profissional_registro",
    placeholder: "{profissional_registro}",
    label: "Registro profissional",
    description:
      "Conselho e número de registro profissional do emissor (ex: CRM/UF).",
    type: "string",
    category: "PROFESSIONAL",
    required: true,
    source: "professional.registrationNumber",
    example: "CRM/SP 123456",
  },
  {
    key: "profissional_titulo",
    placeholder: "{profissional_titulo}",
    label: "Título profissional",
    description: "Título ou especialidade profissional do emissor.",
    type: "string",
    category: "PROFESSIONAL",
    required: false,
    source: "professional.professionalTitle",
    example: "Médica Cardiologista",
  },
  {
    key: "medico_nome",
    placeholder: "{medico_nome}",
    label: "Nome do médico",
    description:
      "Alias homologado para o nome completo do profissional emissor.",
    type: "string",
    category: "PROFESSIONAL",
    required: true,
    source: "professional.fullName",
    example: "Dra. Ana Oliveira",
  },
  {
    key: "medico_crm",
    placeholder: "{medico_crm}",
    label: "CRM do médico",
    description: "Alias homologado para o registro profissional do emissor.",
    type: "string",
    category: "PROFESSIONAL",
    required: true,
    source: "professional.registrationNumber",
    example: "CRM/SP 123456",
  },
  {
    key: "profissional_crm",
    placeholder: "{profissional_crm}",
    label: "CRM do profissional",
    description: "Alias homologado para o registro profissional do emissor.",
    type: "string",
    category: "PROFESSIONAL",
    required: true,
    source: "professional.registrationNumber",
    example: "CRM/SP 123456",
  },
  {
    key: "data_atual",
    placeholder: "{data_atual}",
    label: "Data de emissão",
    description: "Data de emissão do documento no fuso horário da clínica.",
    type: "date",
    category: "DOCUMENT",
    required: true,
    source: "document.issuedDate",
    example: "11/10/2026",
  },
  {
    key: "data_emissao",
    placeholder: "{data_emissao}",
    label: "Data de emissão",
    description: "Alias homologado para a data de emissão do documento.",
    type: "date",
    category: "DOCUMENT",
    required: true,
    source: "document.issuedDate",
    example: "11/10/2026",
  },
  {
    key: "data_hora_emissao",
    placeholder: "{data_hora_emissao}",
    label: "Data e hora de emissão",
    description:
      "Data e horário de emissão do documento no fuso de apresentação da clínica.",
    type: "datetime",
    category: "DOCUMENT",
    required: true,
    source: "document.issuedAt",
    example: "11/10/2026 14:30",
  },
] as const;

export const APPROVED_VARIABLE_KEY_SET = new Set<string>(
  APPROVED_TEMPLATE_VARIABLES.map((item) => item.key),
);

const MAX_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 20_000;

function hasDisallowedControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    const isAllowedWhitespace = code === 9 || code === 10 || code === 13;
    if ((code < 32 && !isAllowedWhitespace) || code === 127) {
      return true;
    }
  }
  return false;
}

export function parseAndNormalizePlaceholders(
  text: string,
  field: "title" | "bodyTemplate" | "content",
): { normalizedText: string; variables: string[] } {
  const variables: string[] = [];
  let normalized = "";
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "}") {
      throw new ApiError(
        "INVALID_TEMPLATE_STRUCTURE",
        422,
        "Estrutura do modelo inválida: chave de fechamento '}' sem abertura correspondente.",
        { field, reason: "UNMATCHED_CLOSING_BRACE", position: i },
      );
    }

    if (ch === "{") {
      let openCount = 0;
      while (i + openCount < text.length && text[i + openCount] === "{") {
        openCount++;
      }
      if (openCount > 2) {
        throw new ApiError(
          "INVALID_TEMPLATE_STRUCTURE",
          422,
          "Estrutura do modelo inválida: chaves aninhadas ou malformadas.",
          { field, reason: "MALFORMED_PLACEHOLDER", position: i },
        );
      }

      const contentStart = i + openCount;
      let cursor = contentStart;
      while (
        cursor < text.length &&
        text[cursor] !== "}" &&
        text[cursor] !== "{" &&
        text[cursor] !== "\n" &&
        text[cursor] !== "\r"
      ) {
        cursor++;
      }

      if (cursor >= text.length) {
        throw new ApiError(
          "INVALID_TEMPLATE_STRUCTURE",
          422,
          "Estrutura do modelo inválida: placeholder dinâmico não foi fechado com '}'.",
          { field, reason: "UNCLOSED_PLACEHOLDER", position: i },
        );
      }

      if (
        text[cursor] === "{" ||
        text[cursor] === "\n" ||
        text[cursor] === "\r"
      ) {
        throw new ApiError(
          "INVALID_TEMPLATE_STRUCTURE",
          422,
          "Estrutura do modelo inválida: placeholder dinâmico malformado ou aninhado.",
          { field, reason: "MALFORMED_PLACEHOLDER", position: i },
        );
      }

      let closeCount = 0;
      while (
        cursor + closeCount < text.length &&
        text[cursor + closeCount] === "}"
      ) {
        closeCount++;
      }

      if (closeCount !== openCount) {
        throw new ApiError(
          "INVALID_TEMPLATE_STRUCTURE",
          422,
          "Estrutura do modelo inválida: quantidade de chaves de abertura e fechamento não coincide.",
          { field, reason: "MISMATCHED_PLACEHOLDER_BRACES", position: i },
        );
      }

      const rawInner = text.slice(contentStart, cursor);
      const key = rawInner.trim();

      if (key.length === 0) {
        throw new ApiError(
          "INVALID_TEMPLATE_STRUCTURE",
          422,
          "Estrutura do modelo inválida: placeholder vazio '{}'.",
          { field, reason: "EMPTY_PLACEHOLDER", position: i },
        );
      }

      if (!/^[A-Za-z0-9_.-]+$/.test(key)) {
        throw new ApiError(
          "INVALID_TEMPLATE_STRUCTURE",
          422,
          `Estrutura do modelo inválida: sintaxe incorreta no placeholder '{${rawInner}}'.`,
          {
            field,
            reason: "INVALID_PLACEHOLDER_SYNTAX",
            placeholder: `{${rawInner}}`,
          },
        );
      }

      variables.push(key);
      normalized += `{${key}}`;
      i = cursor + closeCount;
      continue;
    }

    normalized += ch;
    i++;
  }

  return { normalizedText: normalized, variables };
}

export function validateTemplateContent(input: {
  title: string;
  bodyTemplate: string;
}): {
  normalizedTitle: string;
  normalizedBody: string;
  variables: string[];
} {
  if (hasDisallowedControlCharacters(input.title)) {
    throw new ApiError(
      "INVALID_TEMPLATE_STRUCTURE",
      422,
      "Estrutura do modelo inválida: título contém caracteres de controle não permitidos.",
      { field: "title", reason: "INVALID_CONTROL_CHARACTERS" },
    );
  }

  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length < 2) {
    throw new ApiError(
      "INVALID_TEMPLATE_STRUCTURE",
      422,
      "Estrutura do modelo inválida: o título deve ter ao menos 2 caracteres.",
      { field: "title", reason: "EMPTY_OR_TOO_SHORT_TITLE" },
    );
  }
  if (trimmedTitle.length > MAX_TITLE_LENGTH) {
    throw new ApiError(
      "INVALID_TEMPLATE_STRUCTURE",
      422,
      `Estrutura do modelo inválida: o título excede ${MAX_TITLE_LENGTH} caracteres.`,
      { field: "title", reason: "TITLE_TOO_LONG" },
    );
  }

  if (hasDisallowedControlCharacters(input.bodyTemplate)) {
    throw new ApiError(
      "INVALID_TEMPLATE_STRUCTURE",
      422,
      "Estrutura do modelo inválida: o conteúdo contém caracteres de controle não permitidos.",
      { field: "bodyTemplate", reason: "INVALID_CONTROL_CHARACTERS" },
    );
  }

  const trimmedBody = input.bodyTemplate.trim();
  if (trimmedBody.length === 0) {
    throw new ApiError(
      "INVALID_TEMPLATE_STRUCTURE",
      422,
      "Estrutura do modelo inválida: o conteúdo do modelo não pode estar vazio.",
      { field: "bodyTemplate", reason: "EMPTY_BODY" },
    );
  }
  if (input.bodyTemplate.length > MAX_BODY_LENGTH) {
    throw new ApiError(
      "INVALID_TEMPLATE_STRUCTURE",
      422,
      `Estrutura do modelo inválida: o conteúdo excede ${MAX_BODY_LENGTH} caracteres.`,
      { field: "bodyTemplate", reason: "BODY_TOO_LONG" },
    );
  }

  const parsedTitle = parseAndNormalizePlaceholders(trimmedTitle, "title");
  const parsedBody = parseAndNormalizePlaceholders(
    input.bodyTemplate,
    "bodyTemplate",
  );

  const uniqueVariables = Array.from(
    new Set([...parsedTitle.variables, ...parsedBody.variables]),
  );

  const invalidVariables = uniqueVariables.filter(
    (variableKey) => !APPROVED_VARIABLE_KEY_SET.has(variableKey),
  );

  if (invalidVariables.length > 0) {
    throw new ApiError(
      "INVALID_TEMPLATE_VARIABLE",
      422,
      `Variável automática fora do catálogo homologado: ${invalidVariables.map((v) => `{${v}}`).join(", ")}.`,
      {
        invalidVariables,
        invalidPlaceholders: invalidVariables.map((v) => `{${v}}`),
        allowedVariables: APPROVED_TEMPLATE_VARIABLES.map((v) => v.key),
        allowedPlaceholders: APPROVED_TEMPLATE_VARIABLES.map(
          (v) => v.placeholder,
        ),
      },
    );
  }

  return {
    normalizedTitle: parsedTitle.normalizedText,
    normalizedBody: parsedBody.normalizedText,
    variables: uniqueVariables,
  };
}

export function extractApprovedVariables(text: string): string[] {
  const matches = text.match(/\{([a-z0-9_]+)\}/g) ?? [];
  const keys = matches.map((token) => token.slice(1, -1));
  return Array.from(new Set(keys));
}

interface TemplateRow {
  id: string;
  organizationId: string | null;
  title: string;
  type: DocumentType;
  bodyTemplate: string;
  status: TemplateStatus;
  version: number;
  archivedAt: Date | null;
  createdById?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class TemplatesService {
  constructor(private readonly prisma: PrismaClient) {}

  listVariables(): TemplateVariablesResponse {
    return {
      data: [...APPROVED_TEMPLATE_VARIABLES],
    };
  }

  private toTemplateItem(row: TemplateRow): TemplateItem {
    return {
      id: row.id,
      organizationId: row.organizationId,
      scope: row.organizationId === null ? "GLOBAL" : "ORGANIZATION",
      isGlobal: row.organizationId === null,
      title: row.title,
      type: row.type,
      bodyTemplate: row.bodyTemplate,
      status: row.status,
      version: row.version,
      selectable: row.status === "ACTIVE",
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toDetailResponse(row: TemplateRow): TemplateDetailResponse {
    const item = this.toTemplateItem(row);
    const variables = Array.from(
      new Set([
        ...extractApprovedVariables(row.title),
        ...extractApprovedVariables(row.bodyTemplate),
      ]),
    );
    return {
      ...item,
      variables,
      template: item,
    };
  }

  async list(
    organizationId: string,
    query: ListTemplatesQuery = {},
  ): Promise<ListTemplatesResponse> {
    const excludeArchived =
      query.selectableOnly === true || query.includeArchived === false;

    if (excludeArchived && query.status === "ARCHIVED") {
      return {
        data: [],
        pageInfo: {
          nextCursor: null,
          hasNextPage: false,
        },
      };
    }

    const effectiveStatus: TemplateStatus | undefined = excludeArchived
      ? "ACTIVE"
      : query.status;

    if (query.cursor) {
      const cursorRecord = await this.prisma.documentTemplate.findFirst({
        where: {
          id: query.cursor,
          OR: [{ organizationId }, { organizationId: null }],
        },
        select: { id: true },
      });
      if (!cursorRecord) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          "Cursor de paginação inválido.",
        );
      }
    }

    const search = query.search?.trim();
    const where: Prisma.DocumentTemplateWhereInput = {
      OR: [{ organizationId }, { organizationId: null }],
      ...(effectiveStatus ? { status: effectiveStatus } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.version !== undefined ? { version: query.version } : {}),
      ...(search ? { title: { contains: search, mode: "insensitive" } } : {}),
    };

    const limit = query.limit ?? 20;
    const rows = await this.prisma.documentTemplate.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        organizationId: true,
        title: true,
        type: true,
        bodyTemplate: true,
        status: true,
        version: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage
      ? (pageRows[pageRows.length - 1]?.id ?? null)
      : null;

    return {
      data: pageRows.map((row) => this.toTemplateItem(row)),
      pageInfo: {
        nextCursor,
        hasNextPage,
      },
    };
  }

  async getById(
    organizationId: string,
    templateId: string,
    requestedVersion?: number,
  ): Promise<TemplateDetailResponse> {
    const template = await this.prisma.documentTemplate.findFirst({
      where: {
        id: templateId,
        OR: [{ organizationId }, { organizationId: null }],
      },
      select: {
        id: true,
        organizationId: true,
        title: true,
        type: true,
        bodyTemplate: true,
        status: true,
        version: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!template) {
      throw new ApiError(
        "NOT_FOUND",
        404,
        "Modelo de documento não encontrado.",
      );
    }

    if (requestedVersion !== undefined) {
      const versionRow = this.prisma.documentTemplateVersion
        ? await this.prisma.documentTemplateVersion.findUnique({
            where: {
              templateId_version: {
                templateId: template.id,
                version: requestedVersion,
              },
            },
          })
        : null;

      if (versionRow) {
        return this.toDetailResponse({
          ...template,
          title: versionRow.title,
          type: versionRow.type,
          bodyTemplate: versionRow.bodyTemplate,
          version: versionRow.version,
          updatedAt: versionRow.createdAt,
        });
      }

      if (template.version === requestedVersion) {
        return this.toDetailResponse(template);
      }

      throw new ApiError(
        "NOT_FOUND",
        404,
        "Versão do modelo de documento não encontrada.",
      );
    }

    return this.toDetailResponse(template);
  }

  async listVersions(
    organizationId: string,
    templateId: string,
  ): Promise<TemplateVersionsResponse> {
    const template = await this.prisma.documentTemplate.findFirst({
      where: {
        id: templateId,
        OR: [{ organizationId }, { organizationId: null }],
      },
      select: {
        id: true,
        organizationId: true,
        title: true,
        type: true,
        bodyTemplate: true,
        version: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!template) {
      throw new ApiError(
        "NOT_FOUND",
        404,
        "Modelo de documento não encontrado.",
      );
    }

    const rows = this.prisma.documentTemplateVersion
      ? await this.prisma.documentTemplateVersion.findMany({
          where: { templateId: template.id },
          orderBy: { version: "asc" },
        })
      : [];

    const items: TemplateVersionItem[] =
      rows.length > 0
        ? rows.map((row) => ({
            id: row.id,
            templateId: row.templateId,
            organizationId: row.organizationId,
            version: row.version,
            title: row.title,
            type: row.type,
            bodyTemplate: row.bodyTemplate,
            variables: Array.from(
              new Set([
                ...extractApprovedVariables(row.title),
                ...extractApprovedVariables(row.bodyTemplate),
              ]),
            ),
            createdById: row.createdById,
            createdAt: row.createdAt.toISOString(),
          }))
        : [
            {
              id: template.id,
              templateId: template.id,
              organizationId: template.organizationId,
              version: template.version,
              title: template.title,
              type: template.type,
              bodyTemplate: template.bodyTemplate,
              variables: Array.from(
                new Set([
                  ...extractApprovedVariables(template.title),
                  ...extractApprovedVariables(template.bodyTemplate),
                ]),
              ),
              createdById: template.createdById ?? null,
              createdAt: template.createdAt.toISOString(),
            },
          ];

    return {
      data: items,
      versions: items,
    };
  }

  private async runInTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (typeof this.prisma.$transaction === "function") {
      return this.prisma.$transaction(fn);
    }
    return fn(this.prisma as unknown as Prisma.TransactionClient);
  }

  async archive(
    organizationId: string,
    actorUserId: string,
    templateId: string,
  ): Promise<{ archived: true }> {
    await this.runInTransaction(async (tx) => {
      const template = await tx.documentTemplate.findFirst({
        where: {
          id: templateId,
          OR: [{ organizationId }, { organizationId: null }],
        },
      });
      if (!template) {
        throw new ApiError(
          "NOT_FOUND",
          404,
          "Modelo de documento não encontrado.",
        );
      }
      if (template.organizationId === null) {
        throw new ApiError(
          "PERMISSION_DENIED",
          403,
          "Modelos globais não podem ser arquivados pela clínica.",
        );
      }
      if (template.status === "ARCHIVED") return;

      const archivedAt = new Date();
      const result = await tx.documentTemplate.updateMany({
        where: { id: templateId, organizationId, status: "ACTIVE" },
        data: { status: "ARCHIVED", archivedAt, archivedById: actorUserId },
      });
      if (result.count !== 1) return;

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: "TEMPLATE_ARCHIVED",
          targetType: "DOCUMENT_TEMPLATE",
          targetId: templateId,
          metadata: {
            version: template.version,
            archivedAt: archivedAt.toISOString(),
          },
        },
      });
    });
    return { archived: true };
  }

  async create(
    organizationId: string,
    actorUserId: string,
    body: CreateTemplateBody,
  ): Promise<TemplateDetailResponse> {
    const validated = validateTemplateContent({
      title: body.title,
      bodyTemplate: body.bodyTemplate,
    });

    const created = await this.runInTransaction(async (tx) => {
      const template = await tx.documentTemplate.create({
        data: {
          organizationId,
          title: validated.normalizedTitle,
          type: body.type,
          bodyTemplate: validated.normalizedBody,
          status: "ACTIVE",
          version: 1,
          createdById: actorUserId,
        },
      });

      if (tx.documentTemplateVersion) {
        await tx.documentTemplateVersion.create({
          data: {
            templateId: template.id,
            organizationId,
            version: 1,
            title: validated.normalizedTitle,
            type: body.type,
            bodyTemplate: validated.normalizedBody,
            createdById: actorUserId,
            createdAt: template.createdAt,
          },
        });
      }

      if (tx.auditLog) {
        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId,
            action: "TEMPLATE_CREATED",
            targetType: "DOCUMENT_TEMPLATE",
            targetId: template.id,
            metadata: {
              version: 1,
              type: template.type,
              title: template.title,
              variables: validated.variables,
            },
          },
        });
      }

      return template;
    });

    return this.toDetailResponse(created);
  }

  async update(
    organizationId: string,
    actorUserId: string,
    templateId: string,
    body: UpdateTemplateBody,
  ): Promise<TemplateDetailResponse> {
    if (
      body.title === undefined &&
      body.type === undefined &&
      body.bodyTemplate === undefined
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Informe ao menos um campo do modelo para atualização.",
      );
    }

    if (body.title !== undefined || body.bodyTemplate !== undefined) {
      validateTemplateContent({
        title: body.title ?? "Título válido",
        bodyTemplate: body.bodyTemplate ?? "Conteúdo válido",
      });
    }

    try {
      const updated = await this.runInTransaction(async (tx) => {
        const existing = await tx.documentTemplate.findFirst({
          where: {
            id: templateId,
            OR: [{ organizationId }, { organizationId: null }],
          },
        });

        if (!existing) {
          throw new ApiError(
            "NOT_FOUND",
            404,
            "Modelo de documento não encontrado.",
          );
        }

        if (existing.organizationId === null) {
          throw new ApiError(
            "PERMISSION_DENIED",
            403,
            "Modelos globais não podem ser editados pela clínica.",
          );
        }

        if (existing.status === "ARCHIVED") {
          throw new ApiError(
            "INVALID_STATE_TRANSITION",
            409,
            "Modelos arquivados não podem ser editados.",
          );
        }

        const validated = validateTemplateContent({
          title: body.title ?? existing.title,
          bodyTemplate: body.bodyTemplate ?? existing.bodyTemplate,
        });

        if (existing.version !== body.version) {
          throw new ApiError(
            "VERSION_CONFLICT",
            409,
            "Conflito de versão: o modelo foi alterado por outra sessão. Recarregue e tente novamente.",
            {
              expectedVersion: body.version,
              currentVersion: existing.version,
            },
          );
        }

        if (tx.documentTemplateVersion) {
          const priorSnapshot = await tx.documentTemplateVersion.findUnique({
            where: {
              templateId_version: {
                templateId: existing.id,
                version: existing.version,
              },
            },
          });

          if (!priorSnapshot) {
            await tx.documentTemplateVersion.create({
              data: {
                templateId: existing.id,
                organizationId: existing.organizationId,
                version: existing.version,
                title: existing.title,
                type: existing.type,
                bodyTemplate: existing.bodyTemplate,
                createdById: existing.createdById ?? null,
                createdAt: existing.updatedAt ?? existing.createdAt,
              },
            });
          }
        }

        const nextVersion = existing.version + 1;
        const nextType = body.type ?? existing.type;
        const now = new Date();

        const updatedCount = await tx.documentTemplate.updateMany({
          where: {
            id: existing.id,
            organizationId,
            status: "ACTIVE",
            version: body.version,
          },
          data: {
            title: validated.normalizedTitle,
            type: nextType,
            bodyTemplate: validated.normalizedBody,
            version: nextVersion,
            updatedAt: now,
          },
        });

        if (updatedCount.count !== 1) {
          throw new ApiError(
            "VERSION_CONFLICT",
            409,
            "Conflito de versão: o modelo foi alterado por outra sessão. Recarregue e tente novamente.",
          );
        }

        if (tx.documentTemplateVersion) {
          await tx.documentTemplateVersion.create({
            data: {
              templateId: existing.id,
              organizationId,
              version: nextVersion,
              title: validated.normalizedTitle,
              type: nextType,
              bodyTemplate: validated.normalizedBody,
              createdById: actorUserId,
              createdAt: now,
            },
          });
        }

        const changedFields: string[] = [];
        if (
          body.title !== undefined &&
          validated.normalizedTitle !== existing.title
        ) {
          changedFields.push("title");
        }
        if (body.type !== undefined && nextType !== existing.type) {
          changedFields.push("type");
        }
        if (
          body.bodyTemplate !== undefined &&
          validated.normalizedBody !== existing.bodyTemplate
        ) {
          changedFields.push("bodyTemplate");
        }

        if (tx.auditLog) {
          await tx.auditLog.create({
            data: {
              organizationId,
              actorUserId,
              action: "TEMPLATE_UPDATED",
              targetType: "DOCUMENT_TEMPLATE",
              targetId: existing.id,
              metadata: {
                previousVersion: existing.version,
                newVersion: nextVersion,
                changedFields,
                variables: validated.variables,
              },
            },
          });
        }

        return {
          ...existing,
          title: validated.normalizedTitle,
          type: nextType,
          bodyTemplate: validated.normalizedBody,
          version: nextVersion,
          updatedAt: now,
        };
      });

      return this.toDetailResponse(updated);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        ["P2002", "P2034"].includes(String(error.code))
      ) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "Conflito de versão: o modelo foi alterado por outra sessão. Recarregue e tente novamente.",
        );
      }
      throw error;
    }
  }
}
