import type {
  Membership,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { hasOrganizationCapability } from "../../plugins/organization-access";
import { recordAuditEvent } from "../../services/audit-logger";
import type { ListMembersResponse, RemoveMemberResponse } from "./model";

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
      where: {
        organizationId,
        status: "ACTIVE",
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return {
      data: memberships.map((m) => ({
        id: m.id,
        userId: m.userId,
        userName: m.user.fullName,
        email: m.user.email,
        role: m.role,
        status: m.status,
      })),
    };
  }

  async removeMember(input: {
    actorUserId: string;
    memberId: string;
    organizationId?: string;
  }): Promise<RemoveMemberResponse> {
    const trimmedMemberId = input.memberId.trim();
    if (!trimmedMemberId) {
      throw new ApiError("NOT_FOUND", 404, "Membro não encontrado.");
    }

    return this.runInTx(async (tx) => {
      let organizationId = input.organizationId;
      let targetMembership:
        | (Membership & {
            user: { id: string; fullName: string; email: string };
          })
        | null = null;

      if (organizationId) {
        // Scoped by organization from path parameter (/organizations/:orgSlug/...)
        targetMembership = (await tx.membership.findFirst({
          where: {
            organizationId,
            OR: [{ id: trimmedMemberId }, { userId: trimmedMemberId }],
          },
          include: {
            user: {
              select: { id: true, fullName: true, email: true },
            },
          },
        })) as any;
      } else {
        // Standalone route (/settings/team/:memberId)
        targetMembership = (await tx.membership.findFirst({
          where: {
            OR: [{ id: trimmedMemberId }, { userId: trimmedMemberId }],
          },
          include: {
            user: {
              select: { id: true, fullName: true, email: true },
            },
          },
        })) as any;

        if (!targetMembership) {
          throw new ApiError("NOT_FOUND", 404, "Membro não encontrado.");
        }

        organizationId = targetMembership.organizationId;

        // Verify that actor has active team:manage in this organization
        const actorMembership = await tx.membership.findFirst({
          where: {
            userId: input.actorUserId,
            organizationId,
          },
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

      // Last Administrator Protection:
      // It is strictly forbidden to remove the only remaining active administrator (ADMIN or ADMIN_PROFESSIONAL).
      const isTargetAdmin =
        targetMembership.role === "ADMIN" ||
        targetMembership.role === "ADMIN_PROFESSIONAL";

      if (isTargetAdmin && targetMembership.status === "ACTIVE") {
        const activeAdminCount = await tx.membership.count({
          where: {
            organizationId,
            status: "ACTIVE",
            role: { in: ["ADMIN", "ADMIN_PROFESSIONAL"] },
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

      // If already suspended, return idempotent confirmation without duplicate audit
      if (targetMembership.status === "SUSPENDED") {
        return {
          success: true,
          message: "Membro já desativado da clínica.",
          memberId: targetMembership.id,
        };
      }

      // Revoke membership (set status to SUSPENDED to maintain referential integrity)
      await tx.membership.update({
        where: { id: targetMembership.id },
        data: { status: "SUSPENDED" },
      });

      // Clear active organization preference if the user was currently navigated to this clinic
      if (tx.user?.updateMany) {
        await tx.user.updateMany({
          where: {
            id: targetMembership.userId,
            activeOrganizationId: organizationId,
          },
          data: {
            activeOrganizationId: null,
          },
        });
      }

      // Audit trail in the same transaction
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
