import { z } from "zod";

export const inviteMembershipRoles = [
  "ADMIN",
  "ADMIN_PROFESSIONAL",
  "PROFESSIONAL",
  "RECEPTIONIST",
] as const;

export const inviteMembershipRoleSchema = z.enum(inviteMembershipRoles);
export type InviteMembershipRole = z.infer<typeof inviteMembershipRoleSchema>;

export const INVITE_VALIDITY_DAYS = 7;
export const INVITE_VALIDITY_LABEL = "Válido por 7 dias corridos";

export const createInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "O e-mail é obrigatório.")
    .email("Informe um e-mail corporativo válido.")
    .max(254, "O e-mail não pode exceder 254 caracteres.")
    .transform((val) => val.toLowerCase()),
  role: inviteMembershipRoleSchema,
  expiresInDays: z
    .number()
    .int()
    .positive()
    .default(INVITE_VALIDITY_DAYS)
    .optional(),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export interface RolePermissionConfig {
  role: InviteMembershipRole;
  label: string;
  shortDescription: string;
  badgeClass: string;
  permissions: string[];
}

export const ROLE_PERMISSIONS: Record<
  InviteMembershipRole,
  RolePermissionConfig
> = {
  ADMIN: {
    role: "ADMIN",
    label: "Administrador",
    shortDescription:
      "Acesso administrativo completo à clínica e configurações",
    badgeClass:
      "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800",
    permissions: [
      "Gestão de membros e permissões da equipe",
      "Configurações organizacionais e cadastros gerais",
      "Acesso a relatórios gerenciais e auditoria da clínica",
      "Envio, reenvio e revogação de convites de acesso",
    ],
  },
  ADMIN_PROFESSIONAL: {
    role: "ADMIN_PROFESSIONAL",
    label: "Administrador e Clínico",
    shortDescription:
      "Acesso duplo: gestão administrativa e atendimento clínico",
    badgeClass:
      "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    permissions: [
      "Todas as atribuições e acessos de administrador",
      "Atendimento direto com prontuário eletrônico completo",
      "Emissão de prescrições médicas, atestados e laudos",
      "Gestão e controle da própria agenda de consultas",
    ],
  },
  PROFESSIONAL: {
    role: "PROFESSIONAL",
    label: "Profissional Clínico",
    shortDescription:
      "Atendimento direto a pacientes e rotina médica/assistencial",
    badgeClass:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    permissions: [
      "Acesso aos prontuários e histórico clínico de pacientes",
      "Realização de consultas e registro de evoluções",
      "Emissão e assinatura digital de receitas e documentos",
      "Visualização e agendamento na sua própria agenda",
    ],
  },
  RECEPTIONIST: {
    role: "RECEPTIONIST",
    label: "Recepção",
    shortDescription:
      "Recepção, agendamento de consultas e atendimento primário",
    badgeClass:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    permissions: [
      "Agendamento, remarcação e confirmação de consultas",
      "Cadastro e atualização de dados demográficos de pacientes",
      "Gerenciamento da fila diária e recepção da clínica",
      "Sem acesso a prontuários ou dados clínicos confidenciais",
    ],
  },
};

export function getRolePermissions(role: string): RolePermissionConfig {
  if (role in ROLE_PERMISSIONS) {
    return ROLE_PERMISSIONS[role as InviteMembershipRole];
  }
  return {
    role: "PROFESSIONAL",
    label: role,
    shortDescription: "Papel de colaboração na clínica",
    badgeClass: "bg-muted text-muted-foreground border-border",
    permissions: ["Acesso padrão ao sistema Flowcare"],
  };
}

export interface DuplicateCollisionResult {
  status: "clean" | "active_member" | "pending_invite";
  message?: string;
  existingInviteId?: string;
  existingInviteEmail?: string;
}

export function checkEmailCollision(
  email: string,
  activeMembers: Array<{ email: string }>,
  pendingInvites: Array<{ id: string; email: string }>,
): DuplicateCollisionResult {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return { status: "clean" };
  }

  const isMember = activeMembers.some(
    (m) => m.email.trim().toLowerCase() === normalized,
  );
  if (isMember) {
    return {
      status: "active_member",
      message: "Este e-mail já pertence a um colaborador ativo da clínica.",
    };
  }

  const existingInvite = pendingInvites.find(
    (inv) => inv.email.trim().toLowerCase() === normalized,
  );
  if (existingInvite) {
    return {
      status: "pending_invite",
      message: "Já existe um convite pendente para este e-mail.",
      existingInviteId: existingInvite.id,
      existingInviteEmail: existingInvite.email,
    };
  }

  return { status: "clean" };
}

export interface TeamMemberItem {
  id: string;
  userId: string;
  userName: string;
  email: string;
  role: InviteMembershipRole;
  status?: "ACTIVE" | "SUSPENDED" | "INVITED";
  createdAt?: string;
}

export interface TeamInviteItem {
  id: string;
  email: string;
  role: InviteMembershipRole;
  expiresAt: string;
  createdAt?: string;
}
