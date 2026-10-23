import { Elysia } from "elysia";
import type { MembershipRole, PrismaClient } from "../generated/prisma/client";
import { ApiError } from "../lib/api-error";
import {
  effectivePermissions,
  PERMISSION_GROUPS,
  type Permission,
  PRESET_PERMISSIONS,
  type Preset,
} from "../lib/permissions";
import { Unauthenticated } from "../modules/auth/errors";
import { authPlugin } from "./auth";

/**
 * Grupos e capacidades vêm de `lib/permissions` — a fonte única. Este arquivo
 * mantém o nome histórico (`OrganizationCapability`) usado nas rotas.
 */
export const capacityGroups = PERMISSION_GROUPS;

export type OrganizationCapability = Permission;
export type Role = MembershipRole;

/**
 * Presets por papel (legado). Serve para telas e metadados; a autorização real
 * usa `permissions` do vínculo, resolvida por `resolveOrganizationAccess`.
 * `ADMIN_PROFESSIONAL` é legado e se comporta como ADMIN.
 */
export const capabilities: Record<Role, ReadonlySet<OrganizationCapability>> = {
  ADMIN: PRESET_PERMISSIONS.ADMIN,
  ADMIN_PROFESSIONAL: PRESET_PERMISSIONS.ADMIN,
  PROFESSIONAL: PRESET_PERMISSIONS.PROFESSIONAL,
  RECEPTIONIST: PRESET_PERMISSIONS.RECEPTIONIST,
};

export interface CapabilityCatalogItem {
  name: OrganizationCapability;
  group: keyof typeof capacityGroups;
  description: string;
}

export const CUSTOM_ROLE_CAPABILITIES_CATALOG: readonly CapabilityCatalogItem[] =
  [
    // common
    {
      name: "organizations:read",
      group: "common",
      description: "Visualização dos dados da clínica",
    },
    {
      name: "patients:read",
      group: "common",
      description: "Visualização de dados cadastrais de pacientes",
    },
    {
      name: "patients:write",
      group: "common",
      description: "Cadastro e atualização cadastral de pacientes",
    },
    {
      name: "patients:read_history_summary",
      group: "common",
      description:
        "Resumo do histórico do paciente (datas, profissional e tipo), sem conteúdo clínico",
    },
    {
      name: "appointments:read",
      group: "common",
      description: "Visualização de agendamentos e agenda da clínica",
    },
    {
      name: "appointments:write",
      group: "common",
      description: "Criação e remarcação de agendamentos",
    },
    {
      name: "reception:read",
      group: "common",
      description: "Visualização da fila de recepção",
    },
    {
      name: "dashboard:read",
      group: "common",
      description: "Visualização do painel operacional",
    },
    // administration
    {
      name: "team:read",
      group: "administration",
      description: "Visualização de membros da equipe",
    },
    {
      name: "team:invite",
      group: "administration",
      description: "Envio e cancelamento de convites de equipe",
    },
    {
      name: "team:manage",
      group: "administration",
      description: "Gerenciamento de membros e papéis da equipe",
    },
    {
      name: "roles:read",
      group: "administration",
      description: "Visualização de papéis e capacidades da clínica",
    },
    {
      name: "usage:read",
      group: "administration",
      description: "Visualização do consumo de recursos e transcrição",
    },
    {
      name: "settings:read",
      group: "administration",
      description: "Visualização das configurações da clínica",
    },
    {
      name: "settings:write",
      group: "administration",
      description: "Edição de configurações institucionais da clínica",
    },
    {
      name: "audit:read",
      group: "administration",
      description: "Visualização da trilha de auditoria da clínica",
    },
    // clinical
    {
      name: "patients:read_history",
      group: "clinical",
      description: "Visualização de histórico clínico do paciente",
    },
    {
      name: "patients:attachments:read",
      group: "clinical",
      description: "Visualização e download de anexos clínicos",
    },
    {
      name: "patients:attachments:write",
      group: "clinical",
      description: "Upload e arquivamento de anexos clínicos",
    },
    {
      name: "consultations:read",
      group: "clinical",
      description: "Visualização de consultas e prontuários",
    },
    {
      name: "consultations:write",
      group: "clinical",
      description: "Registro e edição de consultas e atendimentos",
    },
    {
      name: "consultations:approve",
      group: "clinical",
      description: "Aprovação clínica de anamnese",
    },
    {
      name: "documents:read",
      group: "clinical",
      description: "Leitura de documentos clínicos",
    },
    {
      name: "documents:write",
      group: "clinical",
      description: "Criação e edição de minutas de documentos clínicos",
    },
    {
      name: "documents:issue",
      group: "clinical",
      description: "Emissão definitiva de documentos clínicos",
    },
    {
      name: "documents:void",
      group: "clinical",
      description: "Anulação de documentos clínicos emitidos",
    },
    {
      name: "templates:read",
      group: "clinical",
      description: "Visualização de modelos de documentos clínicos",
    },
    {
      name: "templates:write",
      group: "clinical",
      description: "Criação e edição de modelos de documentos clínicos",
    },
    {
      name: "clinical:read_all",
      group: "clinical",
      description:
        "Acesso ao prontuário, documentos e anexos de todos os profissionais (sem esta permissão, apenas os próprios)",
    },
    // logistics
    {
      name: "reception:write",
      group: "logistics",
      description: "Movimentação e atendimento na fila da recepção",
    },
    {
      name: "communications:read",
      group: "logistics",
      description: "Visualização de mensagens e comunicações",
    },
    {
      name: "communications:write",
      group: "logistics",
      description: "Disparo de mensagens logísticas e WhatsApp",
    },
  ];

export const ALLOWED_CUSTOM_ROLE_CAPABILITIES: readonly OrganizationCapability[] =
  CUSTOM_ROLE_CAPABILITIES_CATALOG.map((item) => item.name);

export const ALLOWED_CUSTOM_ROLE_CAPABILITIES_SET = new Set<string>(
  ALLOWED_CUSTOM_ROLE_CAPABILITIES,
);

export function isAllowedCustomRoleCapability(
  capability: string,
): capability is OrganizationCapability {
  return ALLOWED_CUSTOM_ROLE_CAPABILITIES_SET.has(capability);
}

export const RESERVED_SYSTEM_ROLE_NAMES = [
  "ADMIN",
  "ADMIN_PROFESSIONAL",
  "PROFESSIONAL",
  "RECEPTIONIST",
] as const;

export function isReservedRoleName(name: string): boolean {
  const normalized = name.trim().toUpperCase();
  return RESERVED_SYSTEM_ROLE_NAMES.some((r) => r === normalized);
}

export const SYSTEM_ROLES_METADATA = [
  {
    role: "ADMIN" as const,
    name: "Administrador",
    description:
      "Controla clínica, equipe e configurações. Vê o prontuário dos próprios atendimentos.",
    capabilities: Array.from(PRESET_PERMISSIONS.ADMIN),
    isSystem: true as const,
  },
  {
    role: "PROFESSIONAL" as const,
    name: "Profissional",
    description:
      "Atende, registra prontuário e emite documentos. Sem acesso às configurações do negócio.",
    capabilities: Array.from(PRESET_PERMISSIONS.PROFESSIONAL),
    isSystem: true as const,
  },
  {
    role: "RECEPTIONIST" as const,
    name: "Recepção",
    description:
      "Cuida de pacientes, agenda, fila e mensagens. Sem acesso ao conteúdo clínico.",
    capabilities: Array.from(PRESET_PERMISSIONS.RECEPTIONIST),
    isSystem: true as const,
  },
] as const;

export function hasOrganizationCapability(
  role: Role,
  capability: OrganizationCapability,
  permissions?: readonly string[] | null,
) {
  if (permissions && permissions.length > 0) {
    return permissions.includes(capability);
  }
  return capabilities[role].has(capability);
}

export type OrganizationAccess = {
  organizationId: string;
  membershipId: string;
  /** Usuário da sessão: é o "eu" do escopo clínico. */
  userId: string;
  role: Role;
  /** Preset escolhido, normalizado para os três disponíveis. */
  preset: Preset;
  /** Permissões efetivas — a fonte de verdade da autorização. */
  permissions: ReadonlySet<Permission>;
  /** @deprecated alias de `permissions`, mantido para os chamadores antigos. */
  capabilities: ReadonlySet<OrganizationCapability>;
  /** Clínica com um único membro ativo: essa pessoa tem acesso a tudo. */
  isSoloClinic: boolean;
  memberCount: number;
};

/**
 * Quantos membros ativos a clínica tem. Fixtures de teste que não implementam
 * `count` caem no default conservador (2), para nunca tratar como clínica solo
 * por acidente.
 */
async function countActiveMembers(
  prisma: PrismaClient,
  organizationId: string,
): Promise<number> {
  const counter = (
    prisma.membership as unknown as {
      count?: (args: unknown) => Promise<number>;
    }
  ).count;
  if (typeof counter !== "function") return 2;
  return counter.call(prisma.membership, {
    where: { organizationId, status: "ACTIVE" },
  });
}

export async function resolveOrganizationAccess(
  prisma: PrismaClient,
  userId: string,
  slug: string,
  capability: OrganizationCapability | readonly OrganizationCapability[],
): Promise<OrganizationAccess> {
  const caps = (
    Array.isArray(capability) ? capability : [capability]
  ) as readonly OrganizationCapability[];
  const membership = await prisma.membership.findFirst({
    where: { userId, organization: { slug } },
    select: {
      id: true,
      organizationId: true,
      role: true,
      status: true,
      permissions: true,
    },
  });
  if (!membership)
    throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
  if (membership.status !== "ACTIVE")
    throw new ApiError("MEMBERSHIP_INACTIVE", 403, "Vínculo inativo.");

  const memberCount = await countActiveMembers(
    prisma,
    membership.organizationId,
  );
  const isSoloClinic = memberCount <= 1;
  const permissions = effectivePermissions({
    role: membership.role,
    storedPermissions: membership.permissions,
    isSoloClinic,
  });

  const missing = caps.filter((c) => !permissions.has(c));
  if (missing.length > 0) {
    throw new ApiError(
      "PERMISSION_DENIED",
      403,
      "Você não possui permissão para realizar esta ação.",
      { requiredPermission: missing[0] },
    );
  }

  return {
    organizationId: membership.organizationId,
    membershipId: membership.id,
    userId,
    role: membership.role,
    preset: normalizePresetFromRole(membership.role),
    permissions,
    capabilities: permissions,
    isSoloClinic,
    memberCount,
  };
}

function normalizePresetFromRole(role: Role): Preset {
  if (role === "PROFESSIONAL") return "PROFESSIONAL";
  if (role === "RECEPTIONIST") return "RECEPTIONIST";
  return "ADMIN";
}

/**
 * Escopo de leitura clínica. Sem `clinical:read_all` o membro só alcança o que
 * é dele: consultas em que é o profissional e documentos que assinou.
 */
export type ClinicalScope = { userId: string; readAll: boolean };

export function clinicalScope(access: OrganizationAccess): ClinicalScope {
  return {
    userId: access.userId,
    readAll: access.permissions.has("clinical:read_all"),
  };
}

/** Escopo da agenda: ver a clínica toda ou apenas os próprios agendamentos. */
export function canReadAllAgenda(access: OrganizationAccess): boolean {
  return access.permissions.has("appointments:read_all");
}

export function canReadAllClinical(access: OrganizationAccess): boolean {
  return access.permissions.has("clinical:read_all");
}

/**
 * Filtro de autor para documentos: vazio quando o membro pode ver tudo.
 * Recebe `OrganizationAccess` e devolve `{}` ou `{ authorId }`.
 */
export function clinicalOwnerPicker(access: OrganizationAccess): {
  authorId?: string;
} {
  return canReadAllClinical(access) ? {} : { authorId: access.userId };
}

/**
 * Filtro de dono para leitura clínica: vazio quando o membro pode ver tudo.
 * Sem `clinical:read_all`, só consultas em que ele é o profissional.
 */
export function clinicalOwnerFilter(access: OrganizationAccess): {
  professionalId?: string;
} {
  return canReadAllClinical(access) ? {} : { professionalId: access.userId };
}

/** Install after authPlugin; each route opts into the capability it needs. */
export function organizationAccessPlugin(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
}) {
  return new Elysia({ name: "organization-access" })
    .use(authPlugin(deps))
    .macro({
      organizationAccess: (
        capability: OrganizationCapability | readonly OrganizationCapability[],
      ) => ({
        resolve: async ({ auth, params }) => {
          if (!auth) throw Unauthenticated();
          return {
            organizationAccess: await resolveOrganizationAccess(
              deps.prisma,
              auth.userId,
              (params as { orgSlug: string }).orgSlug,
              capability,
            ),
          };
        },
      }),
    });
}
