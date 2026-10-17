import { z } from "zod";

export const memberRemovalExplanations = {
  accessRevocation:
    "O colaborador perderá o acesso a esta organização imediatamente e suas credenciais ativas para esta clínica serão revogadas.",
  clinicalHistoryPreserved:
    "Histórico preservado: Prontuários, anamneses, consultas e laudos emitidos ou assinados por este profissional permanecerão totalmente preservados e acessíveis na clínica.",
  personalAccountRetention:
    "A conta pessoal do usuário continuará existindo no sistema para outras clínicas às quais ele eventualmente pertença.",
} as const;

export const LAST_ADMIN_BLOCK_MESSAGE =
  "Não é possível remover o único administrador remanescente da organização. Promova outro membro a administrador antes de prosseguir.";

export const MEMBER_REMOVAL_ERRORS = {
  LAST_ADMIN_REQUIRED:
    "Não é possível remover o único administrador remanescente da organização.",
  NOT_FOUND: "Membro não encontrado.",
  PERMISSION_DENIED: "Você não possui permissão para realizar esta ação.",
  FORBIDDEN: "Você não possui permissão para realizar esta ação.",
  UNAUTHENTICATED: "Entre novamente para continuar.",
  UNAVAILABLE: "Não foi possível remover o membro da clínica.",
} as const;

export const removeMemberResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  memberId: z.string().optional(),
});

export type RemoveMemberResponse = z.infer<typeof removeMemberResponseSchema>;

export interface MemberRemovalCandidate {
  id: string;
  userName: string;
  email: string;
  role: string;
  status?: string;
  createdAt?: string;
}

export function isSoleAdminMember(
  targetMember: { role: string; status?: string },
  allMembers: Array<{ role: string; status?: string }>,
): boolean {
  const isAdmin =
    targetMember.role === "ADMIN" || targetMember.role === "ADMIN_PROFESSIONAL";
  if (!isAdmin) return false;

  const activeAdmins = allMembers.filter(
    (m) =>
      (m.role === "ADMIN" || m.role === "ADMIN_PROFESSIONAL") &&
      (m.status === undefined || m.status === "ACTIVE"),
  );

  return activeAdmins.length <= 1;
}

export function isNameConfirmationMatching(
  typedName: string,
  expectedName: string,
): boolean {
  if (!typedName || !expectedName) return false;
  return typedName.trim().toLowerCase() === expectedName.trim().toLowerCase();
}
