import { fileType } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { slugify } from "../../lib/slug";
import { recordAuditEvent } from "../../services/audit-logger";
import {
  PROFILE_PHOTO_URL_TTL_SECONDS,
  type ProfilePhotoStore,
} from "../../services/profile-photo-store";
import type {
  ClinicAddressBody,
  ClinicContactBody,
  ClinicDetailsResponse,
  ClinicLogoUrlResponse,
  ClinicSettingsResponse,
  ClinicUsageQuery,
  ClinicUsageResponse,
  CreateAdditionalOrganizationBody,
  OrganizationsResponse,
  PatchClinicSettingsBody,
  PutClinicSettingsBody,
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

type SettingsFieldKey = Exclude<
  keyof PatchClinicSettingsBody,
  "version" | "id" | "organizationId" | "slug" | "ownerId"
>;

const SETTINGS_FIELD_NORMALIZERS: {
  [K in SettingsFieldKey]-?: (
    value: NonNullable<PatchClinicSettingsBody[K]>,
  ) => string | null;
} = {
  name: (v) => v.trim(),
  legalName: (v) => v.trim(),
  taxId: (v) => v.replace(/\D/g, "") || null,
  contactEmail: (v) => v.trim().toLowerCase(),
  contactPhone: (v) => v.replace(/\D/g, ""),
  postalCode: (v) => v.replace(/\D/g, ""),
  state: (v) => v.toUpperCase(),
  city: (v) => v.trim(),
  district: (v) => v.trim(),
  street: (v) => v.trim(),
  streetNumber: (v) => v.trim(),
  addressComplement: (v) => v.trim() || null,
};

const REQUIRED_CLINIC_DETAIL_FIELDS = [
  "legalName",
  "contactEmail",
  "contactPhone",
  "postalCode",
  "state",
  "city",
  "district",
  "street",
  "streetNumber",
] as const;

function normalizeClinicSettingsUpdate(
  body: PatchClinicSettingsBody | PutClinicSettingsBody,
): { data: Record<string, string | null>; changedFields: string[] } {
  const data: Record<string, string | null> = {};
  const changedFields: string[] = [];
  for (const key of Object.keys(
    SETTINGS_FIELD_NORMALIZERS,
  ) as SettingsFieldKey[]) {
    const raw = body[key];
    if (raw !== undefined) {
      data[key] = SETTINGS_FIELD_NORMALIZERS[key](raw);
      changedFields.push(key);
    }
  }
  return { data, changedFields };
}

function isClinicDetailsComplete(
  record: Partial<
    Record<(typeof REQUIRED_CLINIC_DETAIL_FIELDS)[number], string | null>
  >,
): boolean {
  return REQUIRED_CLINIC_DETAIL_FIELDS.every((field) => Boolean(record[field]));
}

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
  constructor(
    private readonly prisma: PrismaClient,
    private readonly logoStore?: ProfilePhotoStore | null,
  ) {}

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

  private async memberClinic(userId: string, slug: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        organization: { slug },
      },
      select: { organization: true },
    });
    if (!membership)
      throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
    return membership.organization;
  }

  private async editableClinic(userId: string, slug: string) {
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        role: { in: ["ADMIN", "ADMIN_PROFESSIONAL"] },
        organization: { slug },
      },
      select: { organization: true },
    });
    if (!membership)
      throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
    return membership.organization;
  }

  private toClinicDetailsResponse(org: {
    name: string;
    slug: string;
    detailsVersion: number;
    detailsCompletedAt: Date | null;
    legalName?: string | null;
    taxId?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    postalCode?: string | null;
    state?: string | null;
    city?: string | null;
    district?: string | null;
    street?: string | null;
    streetNumber?: string | null;
    addressComplement?: string | null;
  }): ClinicDetailsResponse {
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

  private toClinicSettingsResponse(org: {
    id: string;
    name: string;
    slug: string;
    detailsVersion: number;
    detailsCompletedAt: Date | null;
    legalName?: string | null;
    taxId?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    postalCode?: string | null;
    state?: string | null;
    city?: string | null;
    district?: string | null;
    street?: string | null;
    streetNumber?: string | null;
    addressComplement?: string | null;
    logoContentType?: string | null;
    logoSizeBytes?: number | null;
    logoUpdatedAt?: Date | null;
  }): ClinicSettingsResponse {
    return {
      id: org.id,
      ...this.toClinicDetailsResponse(org),
      logo:
        org.logoContentType &&
        org.logoSizeBytes !== null &&
        org.logoSizeBytes !== undefined &&
        org.logoUpdatedAt
          ? {
              contentType: org.logoContentType,
              sizeBytes: org.logoSizeBytes,
              updatedAt: org.logoUpdatedAt.toISOString(),
            }
          : null,
    };
  }

  async getOrganizationBySlug(
    userId: string,
    slug: string,
  ): Promise<ClinicSettingsResponse> {
    const org = await this.memberClinic(userId, slug);
    return this.toClinicSettingsResponse(org);
  }

  async getClinicSettings(
    userId: string,
    slug: string,
  ): Promise<ClinicSettingsResponse> {
    const org = await this.editableClinic(userId, slug);
    return this.toClinicSettingsResponse(org);
  }

  async updateClinicSettings(
    userId: string,
    slug: string,
    body: PatchClinicSettingsBody | PutClinicSettingsBody,
  ): Promise<ClinicSettingsResponse> {
    const org = await this.editableClinic(userId, slug);
    if (body.version !== org.detailsVersion) {
      throw new ApiError(
        "VERSION_CONFLICT",
        409,
        "A clínica foi alterada em outra sessão. Recarregue os dados.",
      );
    }
    const { data, changedFields } = normalizeClinicSettingsUpdate(body);
    const merged = { ...org, ...data };
    const shouldCompleteDetails =
      org.detailsCompletedAt === null && isClinicDetailsComplete(merged);

    await this.prisma.$transaction(async (tx) => {
      const stillAdmin = await tx.membership.findFirst({
        where: {
          userId,
          organizationId: org.id,
          role: { in: ["ADMIN", "ADMIN_PROFESSIONAL"] },
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (!stillAdmin)
        throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
      const updated = await tx.organization.updateMany({
        where: { id: org.id, detailsVersion: body.version },
        data: {
          ...data,
          ...(shouldCompleteDetails ? { detailsCompletedAt: new Date() } : {}),
          detailsVersion: { increment: 1 },
        },
      });
      if (!updated.count) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "A clínica foi alterada em outra sessão. Recarregue os dados.",
        );
      }
      await recordAuditEvent(tx, {
        organizationId: org.id,
        actorUserId: userId,
        action: "ORGANIZATION_SETTINGS_UPDATED",
        targetType: "ORGANIZATION",
        targetId: org.id,
        metadata: {
          changedFields,
          version: body.version + 1,
        },
      });
    });

    return this.getClinicSettings(userId, slug);
  }

  async uploadClinicLogo(
    userId: string,
    slug: string,
    file: File,
  ): Promise<ClinicSettingsResponse> {
    await fileType(file, file.type);
    const store = this.logoStore;
    if (!store) {
      throw new ApiError(
        "STORAGE_UNAVAILABLE",
        503,
        "Armazenamento indisponível.",
      );
    }
    const org = await this.editableClinic(userId, slug);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const key = `organizations/${org.id}/logo/${crypto.randomUUID()}`;
    const now = new Date();
    await store.put(key, bytes, file.type);
    try {
      await this.prisma.$transaction(async (tx) => {
        const stillAdmin = await tx.membership.findFirst({
          where: {
            userId,
            organizationId: org.id,
            role: { in: ["ADMIN", "ADMIN_PROFESSIONAL"] },
            status: "ACTIVE",
          },
          select: { id: true },
        });
        if (!stillAdmin)
          throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
        const updated = await tx.organization.updateMany({
          where: { id: org.id },
          data: {
            logoObjectKey: key,
            logoContentType: file.type,
            logoSizeBytes: bytes.length,
            logoUpdatedAt: now,
            detailsVersion: { increment: 1 },
          },
        });
        if (!updated.count)
          throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
        await recordAuditEvent(tx, {
          organizationId: org.id,
          actorUserId: userId,
          action: "ORGANIZATION_LOGO_UPDATED",
          targetType: "ORGANIZATION",
          targetId: org.id,
          metadata: {
            contentType: file.type,
            sizeBytes: bytes.length,
            replacedPreviousLogo: Boolean(org.logoObjectKey),
          },
        });
      });
    } catch (error) {
      await store.delete(key).catch(() => {});
      throw error;
    }
    if (org.logoObjectKey) {
      await store.delete(org.logoObjectKey).catch(() => {});
    }
    return this.getClinicSettings(userId, slug);
  }

  async getClinicLogoDownloadUrl(
    userId: string,
    slug: string,
  ): Promise<ClinicLogoUrlResponse> {
    const org = await this.memberClinic(userId, slug);
    if (!org.logoObjectKey) {
      throw new ApiError("NOT_FOUND", 404, "Logotipo não encontrado.");
    }
    const store = this.logoStore;
    if (!store) {
      throw new ApiError(
        "STORAGE_UNAVAILABLE",
        503,
        "Armazenamento indisponível.",
      );
    }
    return {
      downloadUrl: await store.downloadUrl(org.logoObjectKey),
      expiresInSeconds: PROFILE_PHOTO_URL_TTL_SECONDS,
    };
  }

  async getClinicDetails(
    userId: string,
    slug: string,
  ): Promise<ClinicDetailsResponse> {
    const org = await this.editableClinic(userId, slug);
    return this.toClinicDetailsResponse(org);
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
      postalCode: body.postalCode.replace(/\D/g, ""),
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
          role: { in: ["ADMIN", "ADMIN_PROFESSIONAL"] },
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
      await recordAuditEvent(tx, {
        organizationId: org.id,
        actorUserId: userId,
        action: "ORGANIZATION_SETTINGS_UPDATED",
        targetType: "ORGANIZATION",
        targetId: org.id,
        metadata: {
          step,
          changedFields: Object.keys(stepData).filter(
            (key) => key !== "detailsCompletedAt",
          ),
          version: version + 1,
        },
      });
    });
    return this.getClinicDetails(userId, slug);
  }

  async getTranscriptionUsage(
    organizationId: string,
    query?: ClinicUsageQuery,
  ): Promise<ClinicUsageResponse> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { timezone: true },
    });
    if (!org) {
      throw new ApiError("NOT_FOUND", 404, "Clínica não encontrada.");
    }

    let timeZone = org.timezone || "America/Sao_Paulo";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone });
    } catch {
      timeZone = "America/Sao_Paulo";
    }

    let targetMonth: string;
    if (query?.month) {
      const trimmed = query.month.trim();
      if (!/^\d{4}-\d{2}$/.test(trimmed)) {
        throw new ApiError("VALIDATION_ERROR", 400, "Mês inválido.");
      }
      const [yearStr, monthStr] = trimmed.split("-");
      const year = Number(yearStr);
      const monthNum = Number(monthStr);
      if (year < 1970 || year > 2100 || monthNum < 1 || monthNum > 12) {
        throw new ApiError("VALIDATION_ERROR", 400, "Mês inválido.");
      }
      targetMonth = trimmed;
    } else {
      targetMonth = getLocalDateString(new Date(), timeZone).slice(0, 7);
    }

    const [yearStr, monthStr] = targetMonth.split("-");
    const year = Number(yearStr);
    const monthNum = Number(monthStr);
    const startDay = `${targetMonth}-01`;
    const nextMonthYear = monthNum === 12 ? year + 1 : year;
    const nextMonthNum = monthNum === 12 ? 1 : monthNum + 1;
    const endDay = `${nextMonthYear}-${String(nextMonthNum).padStart(2, "0")}-01`;

    const periodStart = getLocalMidnightUtc(startDay, timeZone);
    const periodEnd = getLocalMidnightUtc(endDay, timeZone);

    const jobs = await this.prisma.transcriptionJob.findMany({
      where: {
        organizationId,
        finishedAt: {
          gte: periodStart,
          lt: periodEnd,
        },
        status: {
          in: ["COMPLETED", "FAILED"],
        },
      },
      select: {
        id: true,
        audioId: true,
        consultationId: true,
        status: true,
        durationSeconds: true,
        finishedAt: true,
        consultation: {
          select: {
            id: true,
            professionalId: true,
            professional: {
              select: {
                id: true,
                fullName: true,
              },
            },
          },
        },
      },
      orderBy: {
        finishedAt: "asc",
      },
    });

    const audioMap = new Map<
      string,
      {
        audioKey: string;
        jobs: typeof jobs;
        consultationId: string;
        professionalId: string;
        professionalName: string;
      }
    >();

    for (const job of jobs) {
      const audioKey = job.audioId ?? `job_${job.id}`;
      let entry = audioMap.get(audioKey);
      if (!entry) {
        const prof = job.consultation?.professional;
        const professionalId =
          prof?.id ?? (job.consultation?.professionalId || "unassigned");
        const professionalName = prof?.fullName ?? "Não atribuído";

        entry = {
          audioKey,
          jobs: [],
          consultationId: job.consultationId,
          professionalId: prof ? professionalId : "unassigned",
          professionalName: prof ? professionalName : "Não atribuído",
        };
        audioMap.set(audioKey, entry);
      }
      entry.jobs.push(job);
    }

    let processedSeconds = 0;
    let successfulAudioCount = 0;
    let failedAudioCount = 0;
    const successfulConsultationIds = new Set<string>();

    interface ProfessionalAgg {
      professionalId: string;
      professionalName: string;
      processedSeconds: number;
      successfulAudioIds: Set<string>;
    }

    const profMap = new Map<string, ProfessionalAgg>();

    for (const entry of audioMap.values()) {
      const completedJobs = entry.jobs.filter((j) => j.status === "COMPLETED");

      if (completedJobs.length > 0) {
        successfulAudioCount += 1;
        successfulConsultationIds.add(entry.consultationId);

        // Duration is counted once per distinct audio completed
        const duration = completedJobs[0]?.durationSeconds ?? 0;
        processedSeconds += duration;

        let prof = profMap.get(entry.professionalId);
        if (!prof) {
          prof = {
            professionalId: entry.professionalId,
            professionalName: entry.professionalName,
            processedSeconds: 0,
            successfulAudioIds: new Set<string>(),
          };
          profMap.set(entry.professionalId, prof);
        }
        prof.processedSeconds += duration;
        prof.successfulAudioIds.add(entry.audioKey);
      } else {
        failedAudioCount += 1;
      }
    }

    const processedMinutes = Math.round((processedSeconds / 60) * 100) / 100;

    const byProfessional = Array.from(profMap.values())
      .map((p) => ({
        professionalId: p.professionalId,
        professionalName: p.professionalName,
        processedSeconds: p.processedSeconds,
        processedMinutes: Math.round((p.processedSeconds / 60) * 100) / 100,
        successfulAudioCount: p.successfulAudioIds.size,
      }))
      .sort((a, b) => {
        if (b.processedSeconds !== a.processedSeconds) {
          return b.processedSeconds - a.processedSeconds;
        }
        return a.professionalName.localeCompare(b.professionalName);
      });

    return {
      month: targetMonth,
      timeZone,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      processedSeconds,
      processedMinutes,
      successfulAudioCount,
      transcribedConsultations: successfulConsultationIds.size,
      failedAudioCount,
      byProfessional,
    };
  }
}

function parseIsoDateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new ApiError("VALIDATION_ERROR", 400, "Período inválido.");
  }
  return date;
}

function getLocalDateString(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function getLocalMidnightUtc(value: string, timeZone: string): Date {
  const target = parseIsoDateOnly(value).getTime();
  let instant = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const represented = parseIsoDateOnly(
      getLocalDateString(new Date(instant), timeZone),
    ).getTime();
    const hourParts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const clock = Object.fromEntries(
      hourParts.map((part) => [part.type, part.value]),
    );
    const localTime =
      represented +
      Number(clock.hour) * 3_600_000 +
      Number(clock.minute) * 60_000 +
      Number(clock.second) * 1_000;
    instant += target - localTime;
  }
  if (getLocalDateString(new Date(instant), timeZone) !== value) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Data inválida para o fuso horário.",
    );
  }
  return new Date(instant);
}
