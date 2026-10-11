import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { slugify } from "../../lib/slug";
import type {
  ClinicAddressBody,
  ClinicContactBody,
  ClinicDetailsResponse,
  CreateAdditionalOrganizationBody,
  OrganizationsResponse,
} from "./model";

const MAX_USER_ORGANIZATIONS = 100;

type ClinicContactStepData = {
  legalName: string;
  taxId: string | null;
  contactEmail: string;
  contactPhone: string;
};

type ClinicAddressStepData = {
  postalCode: string;
  state: string;
  city: string;
  district: string;
  street: string;
  streetNumber: string;
  addressComplement: string | null;
  detailsCompletedAt: Date;
};

type ClinicStepData = ClinicContactStepData | ClinicAddressStepData;

type ClinicStep = "CLINIC_DETAILS" | "CLINIC_ADDRESS";

function canSaveClinicStep(
  step: ClinicStep,
  progress: { currentStep: string; completed: boolean } | null,
): boolean {
  if (!progress) return false;
  if (step === "CLINIC_DETAILS") {
    return (
      (progress.currentStep === "ORGANIZATION_SETUP" && progress.completed) ||
      (progress.currentStep === "CLINIC_DETAILS" && !progress.completed)
    );
  }
  return progress.currentStep === "CLINIC_DETAILS" && progress.completed;
}

export class OrganizationsService {
  constructor(private readonly prisma: PrismaClient) {}

  async createAdditional(
    userId: string,
    body: CreateAdditionalOrganizationBody,
  ) {
    const name = body.name.trim();
    const slug = slugify(name).slice(0, 60).replace(/-+$/, "");
    if (slug.length < 2) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Nome inválido para gerar o endereço da clínica.",
      );
    }
    for (let attempt = 1; attempt <= 100; attempt++) {
      const suffix = attempt === 1 ? "" : `-${attempt}`;
      const candidate = `${slug.slice(0, 60 - suffix.length).replace(/-+$/, "")}${suffix}`;
      try {
        const org = await this.prisma.$transaction(async (tx) => {
          const created = await tx.organization.create({
            data: { name, slug: candidate, ownerId: userId },
          });
          await tx.membership.create({
            data: {
              userId,
              organizationId: created.id,
              role: "ADMIN",
              status: "ACTIVE",
            },
          });
          await tx.subscription.create({
            data: { organizationId: created.id },
          });
          await tx.user.update({
            where: { id: userId },
            data: { activeOrganizationId: created.id },
          });
          return created;
        });
        return {
          organization: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            role: "ADMIN" as const,
            isOwner: true as const,
          },
          activeOrganization: { id: org.id, slug: org.slug },
        };
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new ApiError(
      "ALREADY_EXISTS",
      409,
      "Não foi possível gerar um endereço único para esta clínica.",
    );
  }

  async listForUser(userId: string): Promise<OrganizationsResponse> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: "ACTIVE" },
      select: {
        role: true,
        organization: {
          select: { id: true, name: true, slug: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take: MAX_USER_ORGANIZATIONS,
    });

    return {
      data: memberships.map(({ role, organization }) => ({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role,
        status: "ACTIVE",
      })),
    };
  }

  private async editableClinic(userId: string, slug: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        role: "ADMIN",
        organization: { slug },
      },
      select: { organization: true },
    });
    if (!membership)
      throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
    return membership.organization;
  }

  async getClinicDetails(
    userId: string,
    slug: string,
  ): Promise<ClinicDetailsResponse> {
    const org = await this.editableClinic(userId, slug);
    return {
      name: org.name,
      slug: org.slug,
      version: org.detailsVersion,
      completed: org.detailsCompletedAt !== null,
      legalName: org.legalName ?? "",
      taxId: org.taxId ?? "",
      contactEmail: org.contactEmail ?? "",
      contactPhone: org.contactPhone ?? "",
      postalCode: org.postalCode ?? "",
      state: org.state ?? "",
      city: org.city ?? "",
      district: org.district ?? "",
      street: org.street ?? "",
      streetNumber: org.streetNumber ?? "",
      addressComplement: org.addressComplement ?? "",
    };
  }

  async saveClinicContact(
    userId: string,
    slug: string,
    body: ClinicContactBody,
  ): Promise<ClinicDetailsResponse> {
    const taxId = body.taxId.replace(/\D/g, "");
    return this.saveClinicStep(userId, slug, "CLINIC_DETAILS", body.version, {
      legalName: body.legalName.trim(),
      taxId: taxId || null,
      contactEmail: body.contactEmail.trim().toLowerCase(),
      contactPhone: body.contactPhone.replace(/\D/g, ""),
    });
  }

  async saveClinicAddress(
    userId: string,
    slug: string,
    body: ClinicAddressBody,
  ): Promise<ClinicDetailsResponse> {
    return this.saveClinicStep(userId, slug, "CLINIC_ADDRESS", body.version, {
      postalCode: body.postalCode,
      state: body.state.toUpperCase(),
      city: body.city.trim(),
      district: body.district.trim(),
      street: body.street.trim(),
      streetNumber: body.streetNumber.trim(),
      addressComplement: body.addressComplement.trim() || null,
      detailsCompletedAt: new Date(),
    });
  }

  private async saveClinicStep(
    userId: string,
    slug: string,
    step: ClinicStep,
    version: number,
    stepData: ClinicStepData,
  ): Promise<ClinicDetailsResponse> {
    const org = await this.editableClinic(userId, slug);
    const savedProgress = await this.prisma.onboardingProgress.findUnique({
      where: { userId },
    });
    const draft = savedProgress?.draftData;
    if (
      draft &&
      typeof draft === "object" &&
      !Array.isArray(draft) &&
      "organizationId" in draft &&
      draft.organizationId !== org.id
    ) {
      throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
    }
    if (version !== org.detailsVersion) {
      throw new ApiError(
        "VERSION_CONFLICT",
        409,
        "A clínica foi alterada em outra sessão. Recarregue os dados.",
      );
    }
    if (!canSaveClinicStep(step, savedProgress)) {
      throw new ApiError(
        "STEP_ALREADY_COMPLETED",
        409,
        "Esta etapa não está disponível.",
      );
    }
    await this.prisma.$transaction(async (tx) => {
      const stillAdmin = await tx.membership.findFirst({
        where: {
          userId,
          organizationId: org.id,
          role: "ADMIN",
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (!stillAdmin)
        throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
      const currentProgress = await tx.onboardingProgress.findUnique({
        where: { userId },
      });
      if (!canSaveClinicStep(step, currentProgress)) {
        throw new ApiError(
          "STEP_ALREADY_COMPLETED",
          409,
          "Esta etapa não está disponível.",
        );
      }
      const updated = await tx.organization.updateMany({
        where: { id: org.id, detailsVersion: version },
        data: {
          ...stepData,
          detailsVersion: { increment: 1 },
        },
      });
      if (!updated.count)
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "A clínica foi alterada em outra sessão. Recarregue os dados.",
        );
      await tx.onboardingProgress.update({
        where: { userId },
        data: { currentStep: step, completed: true, version: { increment: 1 } },
      });
    });
    return this.getClinicDetails(userId, slug);
  }
}
