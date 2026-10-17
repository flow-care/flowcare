import { z } from "zod";

export const membershipRoles = [
  "ADMIN",
  "ADMIN_PROFESSIONAL",
  "PROFESSIONAL",
  "RECEPTIONIST",
] as const;

export const membershipRoleSchema = z.enum(membershipRoles);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const ADMIN_ROLES: readonly MembershipRole[] = [
  "ADMIN",
  "ADMIN_PROFESSIONAL",
];

export const CLINICAL_ROLES: readonly MembershipRole[] = [
  "PROFESSIONAL",
  "ADMIN_PROFESSIONAL",
];

export function isAdministratorRole(role: string): boolean {
  return role === "ADMIN" || role === "ADMIN_PROFESSIONAL";
}

export function isClinicalRole(role: string): boolean {
  return role === "PROFESSIONAL" || role === "ADMIN_PROFESSIONAL";
}

export const LAST_ADMIN_DOWNGRADE_ALERT =
  "A clínica deve manter ao menos um administrador ativo. Promova outro membro a administrador antes de alterar o papel deste colaborador.";

export function isLastAdminDowngradeBlocked(
  currentRole: string,
  targetRole: string,
  activeAdminCount: number,
): boolean {
  const isCurrentAdmin = isAdministratorRole(currentRole);
  const isTargetAdmin = isAdministratorRole(targetRole);
  return isCurrentAdmin && !isTargetAdmin && activeAdminCount <= 1;
}

export const updateMemberRoleSchema = z.object({
  role: membershipRoleSchema,
  version: z
    .number()
    .int("A versão deve ser um número inteiro.")
    .min(1, "A versão do registro deve ser maior ou igual a 1."),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export interface RoleChangeImpact {
  hasChanged: boolean;
  gainedAdmin: boolean;
  lostAdmin: boolean;
  gainedClinical: boolean;
  lostClinical: boolean;
  gainedPermissions: string[];
  lostPermissions: string[];
  summary: string;
  clinicalQualificationNotice?: string;
}

export function getRoleChangeImpact(
  currentRole: string,
  targetRole: string,
): RoleChangeImpact {
  if (currentRole === targetRole) {
    return {
      hasChanged: false,
      gainedAdmin: false,
      lostAdmin: false,
      gainedClinical: false,
      lostClinical: false,
      gainedPermissions: [],
      lostPermissions: [],
      summary: "O papel selecionado é idêntico ao papel atual do colaborador.",
    };
  }

  const isCurrentAdmin = isAdministratorRole(currentRole);
  const isTargetAdmin = isAdministratorRole(targetRole);
  const isCurrentClinical = isClinicalRole(currentRole);
  const isTargetClinical = isClinicalRole(targetRole);

  const gainedPermissions: string[] = [];
  const lostPermissions: string[] = [];

  const gainedAdmin = !isCurrentAdmin && isTargetAdmin;
  const lostAdmin = isCurrentAdmin && !isTargetAdmin;
  const gainedClinical = !isCurrentClinical && isTargetClinical;
  const lostClinical = isCurrentClinical && !isTargetClinical;

  if (gainedAdmin) {
    gainedPermissions.push(
      "Gestão completa de equipe, colaboradores e permissões",
      "Configurações gerais da organização e horários de atendimento",
      "Envio, reenvio e revogação de convites de acesso",
      "Consulta à trilha de auditoria e métricas de consumo de IA",
    );
  }

  if (lostAdmin) {
    lostPermissions.push(
      "Acesso às configurações administrativas da clínica",
      "Gerenciamento de membros, convites e papéis da equipe",
      "Visualização de registros de auditoria e segurança",
    );
  }

  if (gainedClinical) {
    gainedPermissions.push(
      "Acesso completo a prontuários e históricos médicos de pacientes",
      "Atendimento direto com gravação e transcrição inteligente de anamnese",
      "Emissão e assinatura digital de receitas, atestados e laudos",
      "Gerenciamento de procedimentos e agenda médica própria",
    );
  }

  if (lostClinical) {
    lostPermissions.push(
      "Atendimento clínico direto e registro de evoluções em prontuário",
      "Emissão e assinatura de prescrições, laudos e atestados",
      "Acesso aos dados de saúde confidenciais dos pacientes",
    );
  }

  if (targetRole === "RECEPTIONIST" && currentRole !== "RECEPTIONIST") {
    gainedPermissions.push(
      "Operação da fila de recepção e confirmação de consultas",
      "Cadastro e atualização demográfica de pacientes",
    );
  }

  let clinicalQualificationNotice: string | undefined;
  if (gainedClinical) {
    clinicalQualificationNotice =
      "Atenção: A atribuição de papel clínico exige que o colaborador possua título profissional e número de conselho (CRM, CRO, etc.) cadastrados no perfil.";
  }

  const summaries: string[] = [];
  if (gainedAdmin) summaries.push("ganha acesso administrativo pleno");
  if (lostAdmin) summaries.push("perde acesso administrativo");
  if (gainedClinical) summaries.push("ganha acesso ao atendimento clínico");
  if (lostClinical) summaries.push("perde acesso clínico e aos prontuários");

  const summary =
    summaries.length > 0
      ? `Ao confirmar, o colaborador ${summaries.join(" e ")}.`
      : "Alteração de papel do colaborador.";

  return {
    hasChanged: true,
    gainedAdmin,
    lostAdmin,
    gainedClinical,
    lostClinical,
    gainedPermissions,
    lostPermissions,
    summary,
    clinicalQualificationNotice,
  };
}

export const MEMBER_ROLE_ERROR_MESSAGES: Record<string, string> = {
  VERSION_CONFLICT:
    "O membro foi modificado por outro usuário. Recarregue os dados e tente novamente.",
  LAST_ADMIN_REQUIRED: "A clínica deve manter ao menos um administrador ativo.",
  FORBIDDEN: "Não é permitido alterar o próprio papel por esta rota.",
  CLINICAL_QUALIFICATION_REQUIRED:
    "Dados profissionais exigidos para atribuição de papel clínico.",
  MEMBERSHIP_INACTIVE:
    "O vínculo deste colaborador não está ativo na organização.",
  NOT_FOUND: "Membro não encontrado na clínica.",
  UNAUTHENTICATED: "Entre novamente para continuar.",
  UNAVAILABLE:
    "Não foi possível atualizar o papel do colaborador. Tente novamente.",
  VALIDATION_ERROR: "Dados inválidos fornecidos para atualização do papel.",
};

export function getMemberRoleErrorMessage(
  code: string,
  fallbackMessage?: string,
): string {
  return (
    MEMBER_ROLE_ERROR_MESSAGES[code] ||
    fallbackMessage ||
    "Não foi possível atualizar o papel do colaborador. Tente novamente."
  );
}

export interface EditableMember {
  id: string;
  userId: string;
  userName: string;
  email: string;
  role: MembershipRole;
  status?: "ACTIVE" | "SUSPENDED" | "INVITED";
  version?: number;
  createdAt?: string;
}
