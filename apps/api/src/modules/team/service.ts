import type {
  MembershipRole,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { recordAuditEvent } from "../../services/audit-logger";
import type { UpdateMemberRoleBody, UpdateMemberRoleResponse } from "./model";

export interface UpdateMemberRoleInput extends UpdateMemberRoleBody {
  organizationId: string;
  actorUserId: string;
  memberId: string;
}

const ADMIN_ROLES: readonly MembershipRole[] = ["ADMIN", "ADMIN_PROFESSIONAL"];

const CLINICAL_ROLES: readonly MembershipRole[] = [
  "PROFESSIONAL",
  "ADMIN_PROFESSIONAL",
];

export class TeamService {
  constructor(private readonly prisma: PrismaClient) {}

  async updateMemberRole(
    input: UpdateMemberRoleInput,
  ): Promise<UpdateMemberRoleResponse> {
    const {
      organizationId,
      actorUserId,
      memberId,
      role: newRole,
      version,
    } = input;

    return await this.prisma.$transaction(async (tx) => {
      // 1. Cross-clinic isolation: must belong to the active organization
      const current = await tx.membership.findFirst({
        where: {
          id: memberId,
          organizationId,
        },
        include: {
          user: true,
        },
      });

      if (!current) {
        throw new ApiError("NOT_FOUND", 404, "Membro não encontrado.");
      }

      // 2. No Self-Modification
      if (actorUserId === current.userId) {
        throw new ApiError(
          "FORBIDDEN",
          403,
          "Não é permitido alterar o próprio papel por esta rota.",
        );
      }

      // 3. Inactive membership check
      if (current.status !== "ACTIVE") {
        throw new ApiError("MEMBERSHIP_INACTIVE", 403, "Vínculo inativo.");
      }

      // 4. Optimistic concurrency pre-check
      if (current.version !== version) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "O membro foi modificado por outro usuário. Recarregue os dados e tente novamente.",
        );
      }

      // 5. Last Administrator Protection:
      // Demoting an active admin to a non-admin role requires at least another active admin to remain.
      const isCurrentAdmin = ADMIN_ROLES.includes(current.role);
      const isNewAdmin = ADMIN_ROLES.includes(newRole);

      if (isCurrentAdmin && !isNewAdmin) {
        const activeAdminCount = await tx.membership.count({
          where: {
            organizationId,
            role: { in: [...ADMIN_ROLES] },
            status: "ACTIVE",
          },
        });

        if (activeAdminCount <= 1) {
          throw new ApiError(
            "LAST_ADMIN_REQUIRED",
            409,
            "A clínica deve manter ao menos um administrador ativo.",
          );
        }
      }

      // 6. Clinical Qualification Check:
      // Assigning a clinical role requires professional title and registration number on User.
      const isNewClinical = CLINICAL_ROLES.includes(newRole);

      if (isNewClinical) {
        const regNumber = current.user?.registrationNumber?.trim();
        const profTitle = current.user?.professionalTitle?.trim();

        if (!regNumber || !profTitle) {
          throw new ApiError(
            "CLINICAL_QUALIFICATION_REQUIRED",
            422,
            "Dados profissionais exigidos para atribuição de papel clínico.",
          );
        }
      }

      // 7. Atomic update under optimistic lock
      const updateResult = await tx.membership.updateMany({
        where: {
          id: current.id,
          organizationId,
          version,
        },
        data: {
          role: newRole,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "O membro foi modificado por outro usuário. Recarregue os dados e tente novamente.",
        );
      }

      // 8. Fetch updated membership with user data
      const updated = await tx.membership.findFirst({
        where: {
          id: current.id,
          organizationId,
        },
        include: {
          user: true,
        },
      });

      if (!updated) {
        throw new ApiError("NOT_FOUND", 404, "Membro não encontrado.");
      }

      // 9. Record AuditLog within the same transaction
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId,
        action: "MEMBER_ROLE_CHANGED",
        targetType: "MEMBERSHIP",
        targetId: current.id,
        metadata: {
          targetUserId: current.userId,
          previousRole: current.role,
          newRole,
          version: updated.version,
        },
      });

      const now = new Date();
      const createdAtIso = (updated.createdAt ?? now).toISOString();
      const updatedAtIso = (updated.updatedAt ?? now).toISOString();

      return {
        id: updated.id,
        userId: updated.userId,
        organizationId: updated.organizationId,
        role: updated.role,
        status: updated.status,
        version: updated.version,
        createdAt: createdAtIso,
        updatedAt: updatedAtIso,
        user: updated.user
          ? {
              id: updated.user.id,
              fullName: updated.user.fullName,
              email: updated.user.email,
              professionalRole: updated.user.professionalRole ?? null,
              professionalTitle: updated.user.professionalTitle ?? null,
              registrationNumber: updated.user.registrationNumber ?? null,
            }
          : undefined,
        member: {
          id: updated.id,
          userId: updated.userId,
          organizationId: updated.organizationId,
          role: updated.role,
          status: updated.status,
          version: updated.version,
          createdAt: createdAtIso,
          updatedAt: updatedAtIso,
        },
      };
    });
  }
}
