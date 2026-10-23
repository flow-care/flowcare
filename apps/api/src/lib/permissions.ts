import type { MembershipRole } from "../generated/prisma/client";

/**
 * Permissões são a fonte de verdade do acesso. O papel do membro é apenas um
 * preset: um atalho que preenche a lista de permissões, que depois pode ser
 * personalizada sem trocar o papel.
 *
 * Manter isto em um módulo puro (sem Prisma, sem Elysia) permite testar a
 * matriz e a regra de clínica solo sem subir banco.
 */

export const PERMISSION_GROUPS = {
  common: [
    "organizations:read",
    "patients:read",
    "patients:write",
    "patients:read_history_summary",
    "appointments:read",
    // Ver a agenda da clínica toda. Sem ela, a agenda é sempre "somente meu".
    "appointments:read_all",
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
    "clinical:read_all",
  ],
  logistics: ["reception:write", "communications:read", "communications:write"],
} as const;

export type Permission =
  (typeof PERMISSION_GROUPS)[keyof typeof PERMISSION_GROUPS][number];

/** Rótulos curtos para as telas de permissões. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "organizations:read": "Ver dados da clínica",
  "patients:read": "Ver pacientes",
  "patients:write": "Cadastrar e editar pacientes",
  "patients:read_history_summary": "Ver resumo do histórico do paciente",
  "appointments:read": "Ver agenda",
  "appointments:read_all": "Ver agenda da clínica toda",
  "appointments:write": "Criar e editar agendamentos",
  "reception:read": "Ver fila de recepção",
  "dashboard:read": "Ver dashboard",
  "team:read": "Ver equipe",
  "team:invite": "Convidar membros",
  "team:manage": "Gerenciar equipe e permissões",
  "roles:read": "Ver papéis personalizados",
  "usage:read": "Ver consumo",
  "settings:read": "Ver configurações",
  "settings:write": "Editar configurações",
  "audit:read": "Ver auditoria",
  "patients:read_history": "Ver prontuário do paciente",
  "patients:attachments:read": "Ver anexos do paciente",
  "patients:attachments:write": "Enviar anexos do paciente",
  "consultations:read": "Ver atendimentos",
  "consultations:write": "Registrar atendimentos",
  "consultations:approve": "Assinar atendimentos",
  "documents:read": "Ver documentos clínicos",
  "documents:write": "Criar documentos clínicos",
  "documents:issue": "Emitir documentos clínicos",
  "documents:void": "Anular documentos clínicos",
  "templates:read": "Ver modelos de documentos",
  "templates:write": "Criar e editar modelos",
  "clinical:read_all": "Ver prontuário de todos os profissionais",
  "reception:write": "Confirmar chegada e mover a fila",
  "communications:read": "Ver mensagens",
  "communications:write": "Enviar mensagens",
};

export const PERMISSION_GROUP_META: Record<
  keyof typeof PERMISSION_GROUPS,
  { label: string; description: string }
> = {
  common: {
    label: "Dia a dia",
    description: "Pacientes, agenda e visão geral da clínica.",
  },
  administration: {
    label: "Gestão",
    description: "Equipe, configurações, consumo e auditoria.",
  },
  clinical: {
    label: "Clínico",
    description:
      "Prontuário, atendimentos e documentos. Contém dados sensíveis.",
  },
  logistics: {
    label: "Recepção e comunicação",
    description: "Fila de espera, presença e mensagens.",
  },
};

export const ALL_PERMISSIONS: readonly Permission[] =
  Object.values(PERMISSION_GROUPS).flat();

const ALL_PERMISSIONS_SET: ReadonlySet<Permission> = new Set(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return ALL_PERMISSIONS_SET.has(value as Permission);
}

/** Os três presets. `ADMIN_PROFESSIONAL` é legado: tratado como ADMIN. */
export type Preset = "ADMIN" | "PROFESSIONAL" | "RECEPTIONIST";

export const PRESETS: readonly Preset[] = [
  "ADMIN",
  "PROFESSIONAL",
  "RECEPTIONIST",
];

export function normalizePreset(role: MembershipRole | string): Preset {
  switch (role) {
    case "PROFESSIONAL":
      return "PROFESSIONAL";
    case "RECEPTIONIST":
      return "RECEPTIONIST";
    default:
      // ADMIN e o legado ADMIN_PROFESSIONAL (que era admin + clínico).
      return "ADMIN";
  }
}

function preset(
  ...groups: ReadonlyArray<readonly Permission[]>
): Set<Permission> {
  const set = new Set(groups.flat());
  // Ver prontuário de outro profissional é exceção explícita, nunca preset.
  set.delete("clinical:read_all");
  return set;
}

/**
 * Presets padrão. `clinical:read_all` fica FORA de todos: ver prontuário de
 * outro profissional é exceção explícita, concedida membro a membro (ou
 * automática em clínica solo).
 */
export const PRESET_PERMISSIONS: Record<Preset, ReadonlySet<Permission>> = {
  ADMIN: preset(
    PERMISSION_GROUPS.common,
    PERMISSION_GROUPS.administration,
    PERMISSION_GROUPS.clinical,
    PERMISSION_GROUPS.logistics,
  ),
  PROFESSIONAL: preset(PERMISSION_GROUPS.common, PERMISSION_GROUPS.clinical),
  RECEPTIONIST: preset(PERMISSION_GROUPS.common, PERMISSION_GROUPS.logistics),
};

export interface EffectivePermissionsInput {
  /** Papel gravado no vínculo (preset escolhido). */
  role: MembershipRole | string;
  /** Lista personalizada; vazia = usar o preset. */
  storedPermissions?: readonly string[] | null;
  /** Clínica com um único membro ativo: essa pessoa tem acesso a tudo. */
  isSoloClinic?: boolean;
}

/**
 * Permissões efetivas do membro.
 *
 * Ordem de precedência:
 * 1. clínica solo → tudo (inclusive `clinical:read_all`);
 * 2. lista personalizada, quando existe;
 * 3. preset do papel.
 *
 * Permissões desconhecidas na lista personalizada são descartadas para que um
 * nome antigo nunca vire acesso por engano.
 */
export function effectivePermissions({
  role,
  storedPermissions,
  isSoloClinic = false,
}: EffectivePermissionsInput): ReadonlySet<Permission> {
  if (isSoloClinic) return ALL_PERMISSIONS_SET;

  const stored = (storedPermissions ?? []).filter(isPermission);
  if (stored.length > 0) return new Set(stored);

  return PRESET_PERMISSIONS[normalizePreset(role)];
}

/** Lista ordenada e sem duplicatas, para gravar e devolver na API. */
export function materializePermissions(
  permissions: Iterable<Permission>,
): Permission[] {
  const set = new Set(permissions);
  return ALL_PERMISSIONS.filter((permission) => set.has(permission));
}

/** Quantas permissões do preset o membro manteve/alterou (para a UI). */
export function isCustomized(
  role: MembershipRole | string,
  storedPermissions?: readonly string[] | null,
): boolean {
  const stored = (storedPermissions ?? []).filter(isPermission);
  if (stored.length === 0) return false;
  const presetSet = PRESET_PERMISSIONS[normalizePreset(role)];
  if (stored.length !== presetSet.size) return true;
  return stored.some((permission) => !presetSet.has(permission));
}

export function hasPermission(
  permissions: ReadonlySet<Permission>,
  permission: Permission,
): boolean {
  return permissions.has(permission);
}
