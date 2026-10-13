import type {
  Membership,
  MembershipRole,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { hasOrganizationCapability } from "../../plugins/organization-access";
import { recordAuditEvent } from "../../services/audit-logger";
import type {
  ListMembersResponse,
  RemoveMemberResponse,
  UpdateMemberRoleBody,
  UpdateMemberRoleResponse,
} from "./model";

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

type MembershipWithUser = Membership & {
  user: { id: string; fullName: string; email: string };
};

export class TeamService {
  constructor(private readonly prisma: PrismaClient) {}

  private async runInTx<T>(
    fn: (tx: Prisma.TransactionClient | PrismaClient) => Promise<T>,
  ): Promise<T> {
    if (typeof this.prisma.$transaction === "function") {
      return (
        this.prisma.$transaction as (
          cb: (tx: Prisma.TransactionClient) => Promise<T>,
        ) => Promise<T>
      )(fn as (tx: Prisma.TransactionClient) => Promise<T>);
    }
    return fn(this.prisma);
  }

  async listMembers(organizationId: string): Promise<ListMembersResponse> {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId, status: "ACTIVE" },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      data: memberships.map((membership) => ({
        id: membership.id,
        userId: membership.userId,
        userName: membership.user.fullName,
        email: membership.user.email,
        role: membership.role,
        status: membership.status,
      })),
    };
  }

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

    return this.runInTx(async (tx) => {
      const current = await tx.membership.findFirst({
        where: { id: memberId, organizationId },
        include: { user: true },
      });

      if (!current) {
        throw new ApiError("NOT_FOUND", 404, "Membro não encontrado.");
      }
      if (actorUserId === current.userId) {
        throw new ApiError(
          "FORBIDDEN",
          403,
          "Não é permitido alterar o próprio papel por esta rota.",
        );
      }
      if (current.status !== "ACTIVE") {
        throw new ApiError("MEMBERSHIP_INACTIVE", 403, "Vínculo inativo.");
      }
      if (current.version !== version) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "O membro foi modificado por outro usuário. Recarregue os dados e tente novamente.",
        );
      }

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

      if (CLINICAL_ROLES.includes(newRole)) {
        const registrationNumber = current.user?.registrationNumber?.trim();
        const professionalTitle = current.user?.professionalTitle?.trim();
        if (!registrationNumber || !professionalTitle) {
          throw new ApiError(
            "CLINICAL_QUALIFICATION_REQUIRED",
            422,
            "Dados profissionais exigidos para atribuição de papel clínico.",
          );
        }
      }

      const updateResult = await tx.membership.updateMany({
        where: { id: current.id, organizationId, version },
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

      const updated = await tx.membership.findFirst({
        where: { id: current.id, organizationId },
        include: { user: true },
      });
      if (!updated) {
        throw new ApiError("NOT_FOUND", 404, "Membro não encontrado.");
      }

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
      const createdAt = (updated.createdAt ?? now).toISOString();
      const updatedAt = (updated.updatedAt ?? now).toISOString();
      return {
        id: updated.id,
        userId: updated.userId,
        organizationId: updated.organizationId,
        role: updated.role,
        status: updated.status,
        version: updated.version,
        createdAt,
        updatedAt,
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
          createdAt,
          updatedAt,
        },
      };
    });
  }

  async removeMember(input: {
    actorUserId: string;
    memberId: string;
    organizationId?: string;
  }): Promise<RemoveMemberResponse> {
    const memberId = input.memberId.trim();
    if (!memberId) {
      throw new ApiError("NOT_FOUND", 404, "Membro não encontrado.");
    }

    return this.runInTx(async (tx) => {
      let organizationId = input.organizationId;
      let targetMembership: MembershipWithUser | null;

      if (organizationId) {
        targetMembership = (await tx.membership.findFirst({
          where: { organizationId, OR: [{ id: memberId }, { userId: memberId }] },
          include: {
            user: { select: { id: true, fullName: true, email: true } },
          },
        })) as MembershipWithUser | null;
      } else {
        targetMembership = (await tx.membership.findFirst({
          where: { OR: [{ id: memberId }, { userId: memberId }] },
          include: {
            user: { select: { id: true, fullName: true, email: true } },
          },
        })) as MembershipWithUser | null;
        if (!targetMembership) {
          throw new ApiError("NOT_FOUND", 404, "Membro não encontrado.");
        }
        organizationId = targetMembership.organizationId;

        const actorMembership = await tx.membership.findFirst({
          where: { userId: input.actorUserId, organizationId },
        });
        if (!actorMembership) {
          throw new ApiError("NOT_FOUND", 404, "Membro não encontrado.");
        }
        if (actorMembership.status !== "ACTIVE") {
          throw new ApiError("MEMBERSHIP_INACTIVE", 403, "Vínculo inativo.");
        }
        if (!hasOrganizationCapability(actorMembership.role, "team:manage")) {
          throw new ApiError(
            "PERMISSION_DENIED",
            403,
            "Você não possui permissão para realizar esta ação.",
            { requiredPermission: "team:manage" },
          );
        }
      }

      if (!targetMembership || !organizationId) {
        throw new ApiError("NOT_FOUND", 404, "Membro não encontrado.");
      }

      if (
        ADMIN_ROLES.includes(targetMembership.role) &&
        targetMembership.status === "ACTIVE"
      ) {
        const activeAdminCount = await tx.membership.count({
          where: {
            organizationId,
            status: "ACTIVE",
            role: { in: [...ADMIN_ROLES] },
          },
        });
        if (activeAdminCount <= 1) {
          throw new ApiError(
            "LAST_ADMIN_REQUIRED",
            409,
            "Não é possível remover o único administrador remanescente da organização.",
          );
        }
      }

      if (targetMembership.status === "SUSPENDED") {
        return {
          success: true,
          message: "Membro já desativado da clínica.",
          memberId: targetMembership.id,
        };
      }

      await tx.membership.update({
        where: { id: targetMembership.id },
        data: {
          status: "SUSPENDED",
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      await tx.user.updateMany({
        where: {
          id: targetMembership.userId,
          activeOrganizationId: organizationId,
        },
        data: { activeOrganizationId: null },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: input.actorUserId,
        action: "MEMBER_REMOVED",
        targetType: "MEMBERSHIP",
        targetId: targetMembership.id,
        metadata: {
          removedUserId: targetMembership.userId,
          role: targetMembership.role,
        },
      });

      return {
        success: true,
        message: "Membro removido da organização com sucesso.",
        memberId: targetMembership.id,
      };
    });
  }
}
