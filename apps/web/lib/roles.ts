import { z } from "zod";

export const MVP_ROLES = [
  "ADMIN",
  "ADMIN_PROFESSIONAL",
  "PROFESSIONAL",
  "RECEPTIONIST",
] as const;

export type MvpRole = (typeof MVP_ROLES)[number];

export const systemRoleItemSchema = z.object({
  role: z
    .enum(["ADMIN", "ADMIN_PROFESSIONAL", "PROFESSIONAL", "RECEPTIONIST"])
    .or(z.string()),
  name: z.string(),
  description: z.string(),
  capabilities: z.array(z.string()),
  memberCount: z.number().default(0),
  isSystem: z.literal(true).default(true),
});

export type SystemRoleItem = z.infer<typeof systemRoleItemSchema>;

export const customRoleItemSchema = z.object({
  id: z.string(),
  organizationId: z.string().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  capabilities: z.array(z.string()).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  isSystem: z.literal(false).default(false),
});

export type CustomRoleItem = z.infer<typeof customRoleItemSchema>;

export const organizationRolesResponseSchema = z
  .object({
    systemRoles: z.array(systemRoleItemSchema).optional(),
    customRoles: z.array(customRoleItemSchema).optional().default([]),
    roles: z
      .array(z.union([systemRoleItemSchema, customRoleItemSchema]))
      .optional(),
    data: z
      .array(z.union([systemRoleItemSchema, customRoleItemSchema]))
      .optional(),
  })
  .transform((raw) => {
    let systemRoles = raw.systemRoles;
    if (!systemRoles && raw.data) {
      systemRoles = raw.data.filter(
        (r): r is SystemRoleItem => "role" in r && r.isSystem === true,
      );
    }
    if (!systemRoles && raw.roles) {
      systemRoles = raw.roles.filter(
        (r): r is SystemRoleItem => "role" in r && r.isSystem === true,
      );
    }
    return {
      systemRoles: systemRoles ?? [],
      customRoles: raw.customRoles ?? [],
    };
  });

export type OrganizationRolesData = z.infer<
  typeof organizationRolesResponseSchema
>;

export interface GroupedCapability {
  category: string;
  items: string[];
}

export interface RoleCardConfig {
  role: MvpRole;
  title: string;
  badgeLabel: string;
  badgeClassName: string;
  productDescription: string;
  groupedCapabilities: GroupedCapability[];
}

export const MVP_ROLE_DEFINITIONS: Record<MvpRole, RoleCardConfig> = {
  ADMIN: {
    role: "ADMIN",
    title: "Administrador Geral",
    badgeLabel: "Administrador Geral",
    badgeClassName:
      "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800",
    productDescription:
      "Gestão completa da clínica, equipe, configurações institucionais, LGPD e trilha de auditoria.",
    groupedCapabilities: [
      {
        category: "Administração & Equipe",
        items: [
          "Gestão completa de membros da equipe e papéis de acesso",
          "Envio, reenvio e revogação de convites de colaboradores",
          "Configurações institucionais e dados cadastrais da clínica",
          "Trilha de auditoria e conformidade LGPD",
          "Monitoramento de consumo e limite de transcrições por IA",
        ],
      },
      {
        category: "Operação Geral & Recepção",
        items: [
          "Visualização de agendamentos e agenda da clínica",
          "Consulta e cadastro de pacientes",
          "Acompanhamento da fila de espera e recepção",
          "Disparo de comunicações logísticas e WhatsApp",
          "Acesso ao painel operacional e métricas gerais",
        ],
      },
    ],
  },
  ADMIN_PROFESSIONAL: {
    role: "ADMIN_PROFESSIONAL",
    title: "Administrador e Médico",
    badgeLabel: "Administrador e Médico",
    badgeClassName:
      "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    productDescription:
      "Gestão administrativa plena + atendimento clínico, gravação de anamnese e emissão de documentos.",
    groupedCapabilities: [
      {
        category: "Gestão Administrativa Plena",
        items: [
          "Gestão completa da equipe, convites e papéis de acesso",
          "Configurações institucionais e trilha de auditoria LGPD",
          "Monitoramento de métricas, recursos e consumo de IA",
        ],
      },
      {
        category: "Atendimento Clínico & Prontuário",
        items: [
          "Condução e registro de atendimentos e consultas",
          "Gravação e transcrição inteligente de anamnese",
          "Aprovação clínica e finalização de consultas",
          "Emissão de receitas, atestados e laudos com assinatura",
          "Criação e edição de modelos de documentos clínicos",
        ],
      },
      {
        category: "Operação Geral & Recepção",
        items: [
          "Acesso integral à agenda de consultas e pacientes",
          "Visualização da fila da recepção e mensagens WhatsApp",
        ],
      },
    ],
  },
  PROFESSIONAL: {
    role: "PROFESSIONAL",
    title: "Profissional Clínico",
    badgeLabel: "Profissional Clínico",
    badgeClassName:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    productDescription:
      "Atendimentos, gravação e revisão de anamnese, emissão de receitas, atestados e laudos, acesso ao prontuário.",
    groupedCapabilities: [
      {
        category: "Atendimento Clínico & Prontuário",
        items: [
          "Atendimentos e registro de consultas médicas",
          "Gravação e revisão de anamnese assistida por IA",
          "Aprovação e fechamento de consultas clínicas",
          "Emissão de receitas médicas, atestados e laudos",
          "Consulta ao prontuário e histórico clínico do paciente",
          "Upload e visualização de anexos clínicos e exames",
          "Uso de modelos e templates de documentos",
        ],
      },
      {
        category: "Operação Geral",
        items: [
          "Visualização da agenda médica e atendimentos agendados",
          "Consulta cadastral dos pacientes atendidos",
          "Acesso ao painel operacional clínico",
        ],
      },
    ],
  },
  RECEPTIONIST: {
    role: "RECEPTIONIST",
    title: "Recepcionista",
    badgeLabel: "Recepcionista",
    badgeClassName:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    productDescription:
      "Gestão da agenda de consultas, fila de recepção, confirmação manual e cadastro de pacientes.",
    groupedCapabilities: [
      {
        category: "Recepção & Agenda",
        items: [
          "Gestão da agenda de consultas e calendário da clínica",
          "Check-in e movimentação na fila de espera da recepção",
          "Confirmação manual e reagendamento de consultas",
          "Cadastro completo e atualização cadastral de pacientes",
        ],
      },
      {
        category: "Comunicação & Logística",
        items: [
          "Visualização do histórico de mensagens e contatos",
          "Disparo de mensagens logísticas e avisos via WhatsApp",
          "Consulta às informações gerais da clínica",
        ],
      },
    ],
  },
};

export interface RoleCardData extends RoleCardConfig {
  memberCount: number;
}

export function formatMemberCount(count: number): string {
  if (count === 1) {
    return "1 membro ativo";
  }
  return `${count} membros ativos`;
}

export function getMvpRoleCards(
  rolesData?: OrganizationRolesData | null,
): RoleCardData[] {
  const memberCounts = new Map<string, number>();

  if (rolesData?.systemRoles) {
    for (const sr of rolesData.systemRoles) {
      memberCounts.set(sr.role, sr.memberCount);
    }
  }

  return MVP_ROLES.map((roleKey) => {
    const config = MVP_ROLE_DEFINITIONS[roleKey];
    const memberCount = memberCounts.get(roleKey) ?? 0;
    return {
      ...config,
      memberCount,
    };
  });
}
