import { Elysia } from "elysia";
import type { MembershipRole, PrismaClient } from "../generated/prisma/client";
import { ApiError } from "../lib/api-error";
import { Unauthenticated } from "../modules/auth/errors";
import { authPlugin } from "./auth";

export const capacityGroups = {
  common: [
    "organizations:read",
    "patients:read",
    "patients:write",
    "appointments:read",
    "appointments:write",
    "reception:read",
    "dashboard:read",
  ],
  administration: [
    "team:read",
    "team:invite",
    "team:manage",
    "roles:read",
    "usage:read",
    "settings:read",
    "settings:write",
    "audit:read",
  ],
  clinical: [
    "patients:read_history",
    "patients:attachments:read",
    "patients:attachments:write",
    "consultations:read",
    "consultations:write",
    "consultations:approve",
    "documents:read",
    "documents:write",
    "documents:issue",
    "documents:void",
    "templates:read",
    "templates:write",
  ],
  logistics: ["reception:write", "communications:read", "communications:write"],
} as const;

export type OrganizationCapability =
  (typeof capacityGroups)[keyof typeof capacityGroups][number];
export type Role = MembershipRole;

export const capabilities: Record<Role, ReadonlySet<OrganizationCapability>> = {
  // O dono/criador da clínica e qualquer administrador controlam a clínica
  // inteira, incluindo prontuário, documentos e modelos: ADMIN acumula as
  // capacidades administrativas e clínicas. O papel ADMIN_PROFESSIONAL
  // permanece para quem foi convidado explicitamente como profissional.
  ADMIN: new Set([
    ...capacityGroups.common,
    ...capacityGroups.administration,
    ...capacityGroups.clinical,
    ...capacityGroups.logistics,
  ]),
  ADMIN_PROFESSIONAL: new Set(Object.values(capacityGroups).flat()),
  PROFESSIONAL: new Set([...capacityGroups.common, ...capacityGroups.clinical]),
  RECEPTIONIST: new Set([
    ...capacityGroups.common,
    ...capacityGroups.logistics,
  ]),
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
    description: "Gerencia clínica, equipe, agenda, operação e consumo.",
    capabilities: Array.from(capabilities.ADMIN),
    isSystem: true as const,
  },
  {
    role: "ADMIN_PROFESSIONAL" as const,
    name: "Administrador e Profissional",
    description: "Reúne administração e atuação clínica na clínica.",
    capabilities: Array.from(capabilities.ADMIN_PROFESSIONAL),
    isSystem: true as const,
  },
  {
    role: "PROFESSIONAL" as const,
    name: "Profissional de Saúde",
    description: "Atua em atendimentos, prontuários e documentos clínicos.",
    capabilities: Array.from(capabilities.PROFESSIONAL),
    isSystem: true as const,
  },
  {
    role: "RECEPTIONIST" as const,
    name: "Recepcionista",
    description:
      "Cuida do cadastro de pacientes, agenda, fila e mensagens logísticas.",
    capabilities: Array.from(capabilities.RECEPTIONIST),
    isSystem: true as const,
  },
] as const;

// Only these actions require a separate clinical qualification decision. The
// route implementing a clinical resource must supply its own resource-specific
// check; without one, clinical actions fail closed.
const qualifiedClinicalActions = new Set<OrganizationCapability>([
  "consultations:read",
  "consultations:write",
  "consultations:approve",
  "documents:read",
  "documents:write",
  "documents:issue",
  "documents:void",
  "templates:read",
  "templates:write",
]);

export function hasOrganizationCapability(
  role: Role,
  capability: OrganizationCapability,
) {
  return capabilities[role].has(capability);
}

export type OrganizationAccess = {
  organizationId: string;
  membershipId: string;
  role: Role;
  capabilities: ReadonlySet<OrganizationCapability>;
};

export async function resolveOrganizationAccess(
  prisma: PrismaClient,
  userId: string,
  slug: string,
  capability: OrganizationCapability | readonly OrganizationCapability[],
  clinicalEligibility?: (
    context: OrganizationAccess,
    capability: OrganizationCapability,
  ) => Promise<boolean>,
): Promise<OrganizationAccess> {
  const caps = (
    Array.isArray(capability) ? capability : [capability]
  ) as readonly OrganizationCapability[];
  const membership = await prisma.membership.findFirst({
    where: { userId, organization: { slug } },
    select: { id: true, organizationId: true, role: true, status: true },
  });
  if (!membership)
    throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
  if (membership.status !== "ACTIVE")
    throw new ApiError("MEMBERSHIP_INACTIVE", 403, "Vínculo inativo.");
  const hasAccess = caps.some((c) =>
    hasOrganizationCapability(membership.role, c),
  );
  if (!hasAccess)
    throw new ApiError(
      "PERMISSION_DENIED",
      403,
      "Você não possui permissão para realizar esta ação.",
      { requiredPermission: caps[0] },
    );

  const context: OrganizationAccess = {
    organizationId: membership.organizationId,
    membershipId: membership.id,
    role: membership.role,
    capabilities: capabilities[membership.role],
  };
  for (const cap of caps) {
    if (
      qualifiedClinicalActions.has(cap) &&
      !(await clinicalEligibility?.(context, cap))
    )
      throw new ApiError(
        "PERMISSION_DENIED",
        403,
        "Habilitação profissional necessária.",
        { requiredPermission: cap },
      );
  }
  return context;
}

/** Install after authPlugin; each route opts into the capability it needs. */
export function organizationAccessPlugin(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  clinicalEligibility?: (
    context: OrganizationAccess,
    capability: OrganizationCapability,
  ) => Promise<boolean>;
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
              deps.clinicalEligibility,
            ),
          };
        },
      }),
    });
}
