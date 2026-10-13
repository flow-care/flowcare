import type {
  MembershipRole,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import {
  CUSTOM_ROLE_CAPABILITIES_CATALOG,
  isAllowedCustomRoleCapability,
  isReservedRoleName,
  SYSTEM_ROLES_METADATA,
} from "../../plugins/organization-access";
import type {
  CreateRoleInput,
  CreateRoleResponse,
  CustomRoleItem,
  ListCapabilitiesResponse,
  ListRolesResponse,
  SystemRoleItem,
} from "./model";

export class RolesService {
  constructor(private readonly prisma: PrismaClient) {}

  getCapabilitiesCatalog(): ListCapabilitiesResponse {
    return {
      capabilities: CUSTOM_ROLE_CAPABILITIES_CATALOG.map((item) => ({
        name: item.name,
        group: item.group,
        description: item.description,
      })),
      data: CUSTOM_ROLE_CAPABILITIES_CATALOG.map((item) => ({
        name: item.name,
        group: item.group,
        description: item.description,
      })),
    };
  }

  async listRoles(organizationId: string): Promise<ListRolesResponse> {
    const [membershipCounts, customRoleRecords] = await Promise.all([
      this.prisma.membership.groupBy({
        by: ["role"],
        where: {
          organizationId,
          status: "ACTIVE",
        },
        _count: {
          id: true,
        },
      }),
      this.prisma.organizationRole.findMany({
        where: {
          organizationId,
        },
        orderBy: {
          createdAt: "asc",
        },
      }),
    ]);

    const countMap = new Map<MembershipRole, number>(
      membershipCounts.map((mc) => [mc.role, mc._count.id]),
    );

    const systemRoles: SystemRoleItem[] = SYSTEM_ROLES_METADATA.map((sr) => ({
      role: sr.role,
      name: sr.name,
      description: sr.description,
      capabilities: [...sr.capabilities],
      memberCount: countMap.get(sr.role) ?? 0,
      isSystem: true as const,
    }));

    const customRoles: CustomRoleItem[] = customRoleRecords.map((cr) => ({
      id: cr.id,
      organizationId: cr.organizationId,
      name: cr.name,
      description: cr.description,
      capabilities: cr.capabilities,
      createdAt: cr.createdAt.toISOString(),
      updatedAt: cr.updatedAt.toISOString(),
      isSystem: false as const,
    }));

    const allRoles = [...systemRoles, ...customRoles];

    return {
      systemRoles,
      customRoles,
      roles: allRoles,
      data: allRoles,
    };
  }

  async createCustomRole(
    organizationId: string,
    actorUserId: string,
    input: CreateRoleInput,
  ): Promise<CreateRoleResponse> {
    const trimmedName = input.name.trim();

    if (trimmedName.length < 2 || trimmedName.length > 50) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "O nome do papel deve ter entre 2 e 50 caracteres.",
        { field: "name" },
      );
    }

    if (isReservedRoleName(trimmedName)) {
      throw new ApiError(
        "ROLE_NAME_CONFLICT",
        409,
        "O nome informado é reservado pelo sistema e não pode ser utilizado.",
        { field: "name" },
      );
    }

    if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "O papel deve conter ao menos uma capacidade válida.",
        { field: "capabilities" },
      );
    }

    const invalidCapabilities = input.capabilities.filter(
      (cap) => !isAllowedCustomRoleCapability(cap),
    );
    if (invalidCapabilities.length > 0) {
      throw new ApiError(
        "INVALID_CAPABILITY",
        400,
        "Uma ou mais capacidades informadas são inválidas ou não pertencem ao catálogo aprovado.",
        { invalidCapabilities },
      );
    }

    const uniqueCapabilities = Array.from(new Set(input.capabilities));

    const existingRole = await this.prisma.organizationRole.findFirst({
      where: {
        organizationId,
        name: {
          equals: trimmedName,
          mode: "insensitive",
        },
      },
    });

    if (existingRole) {
      throw new ApiError(
        "ALREADY_EXISTS",
        409,
        "Já existe um papel personalizado com este nome nesta clínica.",
        { field: "name" },
      );
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const role = await tx.organizationRole.create({
          data: {
            organizationId,
            name: trimmedName,
            description: input.description?.trim() || null,
            capabilities: uniqueCapabilities,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId,
            action: "ROLE_CREATED",
            targetType: "ORGANIZATION_ROLE",
            targetId: role.id,
            metadata: {
              name: role.name,
              capabilities: role.capabilities,
            },
          },
        });

        return role;
      });

      const roleDto: CustomRoleItem = {
        id: created.id,
        organizationId: created.organizationId,
        name: created.name,
        description: created.description,
        capabilities: created.capabilities,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
        isSystem: false,
      };

      return {
        ...roleDto,
        role: roleDto,
      };
    } catch (err) {
      if (
        err instanceof Error &&
        (err as Prisma.PrismaClientKnownRequestError).code === "P2002"
      ) {
        throw new ApiError(
          "ALREADY_EXISTS",
          409,
          "Já existe um papel personalizado com este nome nesta clínica.",
          { field: "name" },
        );
      }
      throw err;
    }
  }
}
