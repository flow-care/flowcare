import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type {
  ListTemplatesQuery,
  ListTemplatesResponse,
  TemplateStatus,
  TemplateVariableItem,
  TemplateVariablesResponse,
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

export class TemplatesService {
  constructor(private readonly prisma: PrismaClient) {}

  listVariables(): TemplateVariablesResponse {
    return {
      data: [...APPROVED_TEMPLATE_VARIABLES],
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
      data: pageRows.map((row) => ({
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
      })),
      pageInfo: {
        nextCursor,
        hasNextPage,
      },
    };
  }
}
