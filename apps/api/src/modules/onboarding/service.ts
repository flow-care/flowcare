import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { slugify } from "../../lib/slug";
import { Unauthenticated } from "../auth/errors";
import type {
  CreateOrganizationBody,
  ProfileBody,
  ProfileDraftBody,
  ScheduleRulesBody,
  SlugAvailabilityResponse,
} from "./model";
import { finalOnboardingStep, resolveOnboardingState } from "./steps";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Dependências do módulo (controller): prisma + secret para o authPlugin.
 */
export interface OnboardingDeps {
  prisma: PrismaClient;
  jwtSecret: string;
}

/**
 * Regras de negócio do onboarding (#215/#216/#218).
 * Service puro: sem Context, sem HTTP — só dependências injetadas.
 */
export class OnboardingService {
  constructor(private readonly deps: { prisma: PrismaClient }) {}

  private async createdOrganization(userId: string, prisma: PrismaClient) {
    const [user, progress] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { emailVerified: true },
      }),
      prisma.onboardingProgress.findUnique({ where: { userId } }),
    ]);
    if (!user) throw Unauthenticated();
    if (!user.emailVerified) {
      throw new ApiError(
        "ACCOUNT_NOT_VERIFIED",
        403,
        "Confirme seu e-mail primeiro.",
      );
    }
    const organizationId = asRecord(progress?.draftData)?.organizationId;
    if (typeof organizationId !== "string") {
      throw new ApiError(
        "ONBOARDING_INCOMPLETE",
        409,
        "Crie sua clínica primeiro.",
      );
    }
    const membership = await prisma.membership.findFirst({
      where: {
        userId,
        organizationId,
        role: "ADMIN",
        status: "ACTIVE",
        organization: { ownerId: userId },
      },
      select: { organization: { select: { slug: true } } },
    });
    if (!membership) {
      throw new ApiError(
        "ONBOARDING_INCOMPLETE",
        409,
        "Clínica indisponível para conclusão.",
      );
    }
    return { organizationId, slug: membership.organization.slug };
  }

  async saveScheduleRules(userId: string, body: ScheduleRulesBody) {
    const byDay = new Map<string, Array<{ start: number; end: number }>>();
    for (const rule of body.weeklySchedule) {
      const start =
        Number(rule.startTime.slice(0, 2)) * 60 +
        Number(rule.startTime.slice(3));
      const end =
        Number(rule.endTime.slice(0, 2)) * 60 + Number(rule.endTime.slice(3));
      if (start >= end || rule.slotDurationMinutes > end - start) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          "Intervalo ou duração de atendimento inválidos.",
        );
      }
      const intervals = byDay.get(rule.dayOfWeek) ?? [];
      if (intervals.some((other) => start < other.end && other.start < end)) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          "Há horários sobrepostos no mesmo dia.",
        );
      }
      intervals.push({ start, end });
      byDay.set(rule.dayOfWeek, intervals);
    }

    await this.deps.prisma.$transaction(async (tx) => {
      const { organizationId } = await this.createdOrganization(
        userId,
        tx as PrismaClient,
      );
      await tx.weeklyScheduleRule.deleteMany({ where: { organizationId } });
      if (body.weeklySchedule.length) {
        await tx.weeklyScheduleRule.createMany({
          data: body.weeklySchedule.map((rule) => ({
            organizationId,
            ...rule,
          })),
        });
      }
    });
    return body;
  }

  async complete(userId: string) {
    return this.deps.prisma.$transaction(async (tx) => {
      const { slug } = await this.createdOrganization(
        userId,
        tx as PrismaClient,
      );
      await tx.onboardingProgress.updateMany({
        where: {
          userId,
          OR: [
            { completed: false },
            { currentStep: { not: finalOnboardingStep } },
          ],
        },
        data: {
          completed: true,
          currentStep: finalOnboardingStep,
          version: { increment: 1 },
        },
      });
      return { redirectUrl: `/app/${slug}/dashboard` };
    });
  }

  /** #215 — progresso da própria conta; 404 sem registro é estado "novo". */
  async getProgress(userId: string) {
    const [progress, user, membershipCount] = await Promise.all([
      this.deps.prisma.onboardingProgress.findUnique({ where: { userId } }),
      this.deps.prisma.user.findUnique({
        where: { id: userId },
        select: { profileCompletedAt: true },
      }),
      this.deps.prisma.membership.count({
        where: { userId, status: "ACTIVE" },
      }),
    ]);
    if (!user) throw Unauthenticated();
    const state = resolveOnboardingState({
      profileCompleted: user.profileCompletedAt !== null,
      hasOrganization: membershipCount > 0,
      savedProgress: progress,
    });
    return {
      ...state,
      draftData: asRecord(progress?.draftData) ?? {},
      version: progress?.version ?? 0,
    };
  }

  async getProfile(userId: string) {
    const user = await this.deps.prisma.user.findUnique({
      where: { id: userId },
      include: { onboarding: true },
    });
    if (!user) throw Unauthenticated();
    const profileDraft = asRecord(
      asRecord(user.onboarding?.draftData)?.profile,
    );
    const field = (name: keyof ProfileDraftBody, fallback: string | null) =>
      !user.profileCompletedAt && typeof profileDraft?.[name] === "string"
        ? (profileDraft[name] as string)
        : fallback;
    return {
      fullName: field("fullName", user.fullName) ?? user.fullName,
      phone: field("phone", user.phone),
      professionalRole: field("professionalRole", user.professionalRole),
      professionalTitle: field("professionalTitle", user.professionalTitle),
      registrationNumber: field("registrationNumber", user.registrationNumber),
      completed: user.profileCompletedAt !== null,
    };
  }

  async saveProfileDraft(userId: string, body: ProfileDraftBody) {
    const user = await this.deps.prisma.user.findUnique({
      where: { id: userId },
      select: { profileCompletedAt: true },
    });
    if (!user) throw Unauthenticated();
    if (user.profileCompletedAt) {
      throw new ApiError(
        "STEP_ALREADY_COMPLETED",
        409,
        "Esta etapa já foi concluída.",
      );
    }
    await this.deps.prisma.onboardingProgress.upsert({
      where: { userId },
      create: {
        userId,
        currentStep: "PROFILE_SETUP",
        draftData: { profile: body },
        version: 1,
      },
      update: {
        draftData: { profile: body },
        version: { increment: 1 },
      },
    });
    return this.getProfile(userId);
  }

  async saveProfile(userId: string, body: ProfileBody) {
    const user = await this.deps.prisma.user.findUnique({
      where: { id: userId },
      select: { profileCompletedAt: true },
    });
    if (!user) throw Unauthenticated();
    if (user.profileCompletedAt) {
      throw new ApiError(
        "STEP_ALREADY_COMPLETED",
        409,
        "Esta etapa já foi concluída.",
      );
    }
    const fullName = body.fullName.trim();
    const phone = body.phone.replace(/\D/g, "");
    const professionalTitle = body.professionalTitle?.trim() || null;
    const registrationNumber = body.registrationNumber?.trim() || null;
    if (
      body.professionalRole === "CLINICAL" &&
      (!professionalTitle || !registrationNumber)
    ) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Informe a profissão e o registro profissional.",
      );
    }

    await this.deps.prisma.$transaction(async (tx) => {
      const saved = await tx.user.updateMany({
        where: { id: userId, profileCompletedAt: null },
        data: {
          fullName,
          phone,
          professionalRole: body.professionalRole,
          professionalTitle:
            body.professionalRole === "CLINICAL" ? professionalTitle : null,
          registrationNumber:
            body.professionalRole === "CLINICAL" ? registrationNumber : null,
          profileCompletedAt: new Date(),
        },
      });
      if (!saved.count) {
        throw new ApiError(
          "STEP_ALREADY_COMPLETED",
          409,
          "Esta etapa já foi concluída.",
        );
      }
      const savedProgress = await tx.onboardingProgress.findUnique({
        where: { userId },
        select: { currentStep: true },
      });
      await tx.onboardingProgress.upsert({
        where: { userId },
        create: { userId, currentStep: "ORGANIZATION_SETUP", version: 1 },
        update: {
          currentStep:
            savedProgress?.currentStep === "PROFILE_SETUP"
              ? "ORGANIZATION_SETUP"
              : (savedProgress?.currentStep ?? "ORGANIZATION_SETUP"),
          version: { increment: 1 },
        },
      });
    });
    return this.getProfile(userId);
  }

  /**
   * #216 — cria clínica + Membership ADMIN do criador numa transação única:
   * falha em qualquer parte não deixa clínica órfã.
   * Slug normalizado; colisão devolve erro de campo (ALREADY_EXISTS).
   * Repetição com o mesmo slug não cria segunda clínica.
   */
  async createOrganization(userId: string, body: CreateOrganizationBody) {
    const user = await this.deps.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw Unauthenticated();

    const slug = slugify(body.slug ?? body.name);
    const existing = await this.deps.prisma.organization.findUnique({
      where: { slug },
    });
    if (existing) {
      throw new ApiError(
        "ALREADY_EXISTS",
        409,
        "Este slug já está em uso. Escolha outro.",
      );
    }

    const organization = await this.deps.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: body.name.trim(), slug, ownerId: userId },
      });
      const membership = await tx.membership.create({
        data: {
          userId,
          organizationId: org.id,
          role: "ADMIN",
          status: "ACTIVE",
        },
      });
      // Cada clínica criada exige assinatura do dono (R$ 89/mês).
      // Cobrança é task futura; aqui apenas registramos o estado.
      const subscription = await tx.subscription.create({
        data: { organizationId: org.id },
      });
      await tx.onboardingProgress.upsert({
        where: { userId },
        create: {
          userId,
          currentStep: "ORGANIZATION_SETUP",
          completed: true,
          draftData: { organizationId: org.id },
        },
        update: { completed: true, draftData: { organizationId: org.id } },
      });
      return { org, membership, subscription };
    });

    return {
      organization: {
        id: organization.org.id,
        name: organization.org.name,
        slug: organization.org.slug,
        role: organization.membership.role,
        isOwner: true,
      },
    };
  }

  async checkSlugAvailability(
    rawSlug: string,
  ): Promise<SlugAvailabilityResponse> {
    const slug = slugify(rawSlug);
    if (!slug) {
      return { available: false, slug: "" };
    }
    const existing = await this.deps.prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    return { available: !existing, slug };
  }
}
