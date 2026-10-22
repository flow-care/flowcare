import type { MembershipRole } from "../generated/prisma/client";

/**
 * Papéis que podem assumir atendimentos e agenda como profissional.
 *
 * O dono da clínica nasce como ADMIN e precisa operar a própria agenda; por
 * isso ADMIN entra na lista junto dos papéis clínicos. Recepção continua de
 * fora: quem não atende não deve ser escolhido como responsável.
 */
export const CLINICAL_ROLES: MembershipRole[] = [
  "ADMIN",
  "ADMIN_PROFESSIONAL",
  "PROFESSIONAL",
];

export function isClinicalRole(role: string | null | undefined): boolean {
  return (
    typeof role === "string" && CLINICAL_ROLES.includes(role as MembershipRole)
  );
}
