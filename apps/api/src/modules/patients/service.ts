import { fileType } from "elysia";
import type {
  AppointmentStatus,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { isValidCpf, normalizeCpf } from "../../lib/cpf";
import type { ProfilePhotoStore } from "../../services/profile-photo-store";
import {
  ALLOWED_PATIENT_UPDATE_FIELDS,
  type ArchivePatientAttachmentBody,
  type ArchivePatientAttachmentResponse,
  type CreatePatientBody,
  type ListPatientAttachmentsQuery,
  type ListPatientAttachmentsResponse,
  type ListPatientsQuery,
  type ListPatientsResponse,
  PATIENT_ATTACHMENT_ALLOWED_TYPES,
  PATIENT_ATTACHMENT_MAX_BYTES,
  PATIENT_ATTACHMENT_URL_TTL_SECONDS,
  type PatientAttachmentDownloadUrlResponse,
  type PatientAttachmentItem,
  type PatientDetailItem,
  type PatientDetailResponse,
  type PatientOverviewResponse,
  type PatientResponse,
  type UpdatePatientBody,
  type UploadPatientAttachmentBody,
  type UploadPatientAttachmentResponse,
} from "./model";

type PatientRecord = {
  id: string;
  fullName: string;
  cpf: string;
  birthDate: Date;
  phone: string;
  version: number;
  createdAt: Date;
};

type PatientDetailRecord = PatientRecord & {
  email?: string | null;
  healthInsurance?: string | null;
  insuranceNumber?: string | null;
  updatedAt?: Date;
};

type PatientOverviewRecord = PatientDetailRecord & {
  allergies?: string[];
  comorbidities?: string[];
  clinicalAlerts?: string[];
  medicalNotes?: string | null;
};

type UpcomingAppointmentRecord = {
  id: string;
  professionalId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
};

const ALLOWED_UPDATE_KEYS = new Set<string>(ALLOWED_PATIENT_UPDATE_FIELDS);

export function assertOnlyAllowedPatientUpdateFields(body: unknown) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("VALIDATION_ERROR", 400, "Dados inválidos.");
  }
  for (const [key, value] of Object.entries(body)) {
    if (!ALLOWED_UPDATE_KEYS.has(key) && value !== undefined) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Campos clínicos ou não cadastrais não podem ser alterados por este comando.",
        { field: key },
      );
    }
  }
}

type PatientAttachmentRecord = {
  id: string;
  organizationId: string;
  patientId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  objectKey: string;
  category: string | null;
  description: string | null;
  uploadedById: string;
  archivedAt: Date | null;
  archivedById: string | null;
  archiveReason: string | null;
  createdAt: Date;
};

const PDF_MAGIC_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

function hasPdfMagicHeader(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC_HEADER.length) return false;
  return PDF_MAGIC_HEADER.every((byte, idx) => bytes[idx] === byte);
}

async function validateAttachmentFile(file: File): Promise<Uint8Array> {
  if (!file || file.size <= 0) {
    throw new ApiError("VALIDATION_ERROR", 400, "Arquivo inválido ou vazio.", {
      field: "file",
    });
  }
  if (file.size > PATIENT_ATTACHMENT_MAX_BYTES) {
    throw new ApiError(
      "FILE_TOO_LARGE",
      413,
      "Arquivo excede o limite de 10 MiB.",
    );
  }
  if (
    !(PATIENT_ATTACHMENT_ALLOWED_TYPES as readonly string[]).includes(file.type)
  ) {
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Tipo de arquivo não permitido.",
      { field: "file" },
    );
  }
  try {
    const matches = await fileType(file, file.type);
    if (!matches) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Assinatura do arquivo não corresponde ao formato declarado.",
        { field: "file" },
      );
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Assinatura do arquivo não corresponde ao formato declarado.",
      { field: "file" },
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (file.type === "application/pdf" && !hasPdfMagicHeader(bytes)) {
    throw new ApiError("VALIDATION_ERROR", 400, "Assinatura PDF inválida.", {
      field: "file",
    });
  }
  return bytes;
}

function sanitizeFileName(rawName: string | undefined): string {
  const trimmed = (rawName ?? "").trim();
  const baseName = trimmed.split(/[/\\]/).pop()?.trim() ?? "";
  if (!baseName) return "attachment";
  return baseName.slice(0, 200);
}

function buildObjectKey(
  organizationId: string,
  patientId: string,
  fileName: string,
): string {
  const safeKeyName =
    fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "attachment";
  return `organizations/${organizationId}/patients/${patientId}/attachments/${crypto.randomUUID()}-${safeKeyName}`;
}

function toAttachmentItem(
  record: PatientAttachmentRecord,
): PatientAttachmentItem {
  return {
    id: record.id,
    attachmentId: record.id,
    patientId: record.patientId,
    fileName: record.fileName,
    contentType: record.contentType,
    sizeBytes: record.sizeBytes,
    category: record.category,
    description: record.description,
    uploadedById: record.uploadedById,
    status: record.archivedAt ? "ARCHIVED" : "ACTIVE",
    archivedAt: record.archivedAt ? record.archivedAt.toISOString() : null,
    archivedById: record.archivedById,
    archiveReason: record.archiveReason,
    createdAt: record.createdAt.toISOString(),
  };
}

function toUploadAttachmentResponse(
  record: PatientAttachmentRecord,
): UploadPatientAttachmentResponse {
  const item = toAttachmentItem(record);
  return {
    attachmentId: item.id,
    fileName: item.fileName,
    contentType: item.contentType,
    sizeBytes: item.sizeBytes,
    category: item.category,
    description: item.description,
    createdAt: item.createdAt,
    attachment: item,
  };
}

function parseBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Data de nascimento inválida.",
      {
        field: "birthDate",
      },
    );
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value)
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Data de nascimento inválida.",
      {
        field: "birthDate",
      },
    );
  if (date > new Date())
    throw new ApiError(
      "VALIDATION_ERROR",
      400,
      "Data de nascimento inválida.",
      {
        field: "birthDate",
      },
    );
  return date;
}

export function normalizePatientName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeFullName(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 160) {
    throw new ApiError("VALIDATION_ERROR", 400, "Nome completo inválido.", {
      field: "fullName",
    });
  }
  return normalized;
}

function validateAndNormalizeCpf(value: string) {
  if (value.length < 11 || value.length > 14 || !isValidCpf(value)) {
    throw new ApiError("VALIDATION_ERROR", 400, "CPF inválido.", {
      field: "cpf",
    });
  }
  return normalizeCpf(value);
}

export function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function validateAndNormalizePhone(value: string) {
  const digits = normalizePhone(value);
  if (
    value.length < 10 ||
    value.length > 20 ||
    digits.length < 10 ||
    digits.length > 13
  ) {
    throw new ApiError("VALIDATION_ERROR", 400, "Telefone inválido.", {
      field: "phone",
    });
  }
  return digits;
}

function responseFor(patient: PatientRecord): PatientResponse {
  return {
    patient: {
      id: patient.id,
      fullName: patient.fullName,
      cpf: patient.cpf,
      birthDate: patient.birthDate.toISOString().slice(0, 10),
      phone: patient.phone,
      version: patient.version,
      createdAt: patient.createdAt.toISOString(),
    },
  };
}

function toPatientDetailItem(patient: PatientDetailRecord): PatientDetailItem {
  return {
    id: patient.id,
    fullName: patient.fullName,
    cpf: patient.cpf,
    birthDate: patient.birthDate.toISOString().slice(0, 10),
    phone: patient.phone,
    email: patient.email ?? null,
    healthInsurance: patient.healthInsurance ?? null,
    insuranceNumber: patient.insuranceNumber ?? null,
    version: patient.version,
    createdAt: patient.createdAt.toISOString(),
    updatedAt: (patient.updatedAt ?? patient.createdAt).toISOString(),
  };
}

function isUniqueConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

export class PatientsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly attachmentStore?: ProfilePhotoStore | null,
  ) {}

  async list(
    organizationId: string,
    query: ListPatientsQuery = {},
  ): Promise<ListPatientsResponse> {
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Limite de página inválido.",
        { field: "limit" },
      );
    }

    if (query.cursor) {
      const cursorRecord = await this.prisma.patient.findFirst({
        where: { id: query.cursor, organizationId },
        select: { id: true },
      });
      if (!cursorRecord) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          "Cursor de paginação inválido.",
          { field: "cursor" },
        );
      }
    }

    const rawSearch = (query.search ?? query.q ?? "").trim();
    const orClauses: Prisma.PatientWhereInput[] = [];

    if (rawSearch.length > 0) {
      const collapsedSearch = rawSearch.replace(/\s+/g, " ");
      const normalizedNameQuery = normalizePatientName(collapsedSearch);
      const hasLetters = /[a-z]/i.test(normalizedNameQuery);
      const digits = normalizePhone(collapsedSearch);

      if (!hasLetters && digits.length === 0) {
        return {
          data: [],
          pageInfo: {
            nextCursor: null,
            hasNextPage: false,
          },
        };
      }

      if (hasLetters) {
        orClauses.push(
          {
            normalizedName: {
              contains: normalizedNameQuery,
              mode: "insensitive",
            },
          },
          {
            fullName: {
              contains: collapsedSearch,
              mode: "insensitive",
            },
          },
        );
      }

      if (digits.length > 0) {
        orClauses.push(
          { cpf: { contains: digits } },
          { phone: { contains: digits } },
        );
        if (digits.length >= 12 && digits.startsWith("55")) {
          orClauses.push({ phone: { contains: digits.slice(2) } });
        }
      }
    }

    const where: Prisma.PatientWhereInput = {
      organizationId,
      ...(orClauses.length > 0 ? { OR: orClauses } : {}),
    };

    const rows = await this.prisma.patient.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        fullName: true,
        cpf: true,
        birthDate: true,
        phone: true,
        email: true,
        healthInsurance: true,
        insuranceNumber: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const hasNextPage = rows.length > limit;
    const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage
      ? (pageRows[pageRows.length - 1]?.id ?? null)
      : null;

    return {
      data: pageRows.map(toPatientDetailItem),
      pageInfo: {
        nextCursor,
        hasNextPage,
      },
    };
  }

  async getById(
    organizationId: string,
    patientId: string,
  ): Promise<PatientDetailResponse> {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, organizationId },
      select: {
        id: true,
        fullName: true,
        cpf: true,
        birthDate: true,
        phone: true,
        email: true,
        healthInsurance: true,
        insuranceNumber: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!patient) {
      throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
    }

    return {
      patient: toPatientDetailItem(patient),
    };
  }

  async getOverview(
    organizationId: string,
    patientId: string,
    options: { canReadClinicalHistory: boolean; now?: Date },
  ): Promise<PatientOverviewResponse> {
    const patient = (await this.prisma.patient.findFirst({
      where: { id: patientId, organizationId },
      select: {
        id: true,
        fullName: true,
        cpf: true,
        birthDate: true,
        phone: true,
        email: true,
        healthInsurance: true,
        insuranceNumber: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        ...(options.canReadClinicalHistory
          ? {
              allergies: true,
              comorbidities: true,
              clinicalAlerts: true,
              medicalNotes: true,
            }
          : {}),
      },
    })) as PatientOverviewRecord | null;

    if (!patient) {
      throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
    }

    const now = options.now ?? new Date();
    const upcomingRows: UpcomingAppointmentRecord[] =
      await this.prisma.appointment.findMany({
        where: {
          organizationId,
          patientId: patient.id,
          status: { in: ["RESERVED", "CONFIRMED"] },
          scheduledAt: { gte: now },
        },
        orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
        take: 10,
        select: {
          id: true,
          professionalId: true,
          scheduledAt: true,
          durationMinutes: true,
          status: true,
        },
      });

    const healthInsurance = patient.healthInsurance ?? null;
    const insuranceNumber = patient.insuranceNumber ?? null;
    const activeInsurance = healthInsurance
      ? {
          name: healthInsurance,
          number: insuranceNumber,
        }
      : null;

    const baseOverview: PatientOverviewResponse = {
      patient: {
        id: patient.id,
        fullName: patient.fullName,
        cpf: patient.cpf,
        birthDate: patient.birthDate.toISOString().slice(0, 10),
        phone: patient.phone,
        email: patient.email ?? null,
        healthInsurance,
        insuranceNumber,
        version: patient.version,
      },
      contact: {
        phone: patient.phone,
        email: patient.email ?? null,
      },
      activeInsurance,
      healthInsurance,
      insuranceNumber,
      upcomingAppointments: upcomingRows.map((item) => ({
        id: item.id,
        professionalId: item.professionalId,
        scheduledAt: item.scheduledAt.toISOString(),
        durationMinutes: item.durationMinutes,
        status: item.status,
      })),
    };

    if (!options.canReadClinicalHistory) {
      return baseOverview;
    }

    const allergies = [...(patient.allergies ?? [])];
    const comorbidities = [...(patient.comorbidities ?? [])];
    const clinicalAlerts = [...(patient.clinicalAlerts ?? [])];
    const medicalNotes = patient.medicalNotes ?? null;

    return {
      ...baseOverview,
      allergies,
      comorbidities,
      clinicalAlerts,
      medicalNotes,
      clinicalSummary: {
        allergies,
        comorbidities,
        clinicalAlerts,
        medicalNotes,
      },
    };
  }

  async create(
    organizationId: string,
    idempotencyKey: string,
    body: CreatePatientBody,
  ): Promise<PatientResponse> {
    const input = {
      fullName: normalizeFullName(body.fullName),
      cpf: validateAndNormalizeCpf(body.cpf),
      birthDate: parseBirthDate(body.birthDate),
      phone: validateAndNormalizePhone(body.phone),
      distinctPersonConfirmed: body.distinctPersonConfirmed === true,
    };
    const requestHash = new Bun.CryptoHasher("sha256")
      .update(
        JSON.stringify({
          ...input,
          birthDate: input.birthDate.toISOString().slice(0, 10),
        }),
      )
      .digest("hex");

    const replay = await this.findReplay(
      organizationId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return responseFor(replay);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const duplicate = await tx.patient.findFirst({
          where: { organizationId, cpf: input.cpf },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (duplicate && !input.distinctPersonConfirmed)
          throw new ApiError(
            "POSSIBLE_DUPLICATE",
            409,
            "Foi encontrado um possível paciente duplicado nesta clínica.",
            { existingPatientId: duplicate.id, matchedOn: "cpf" },
          );

        const patient = await tx.patient.create({
          data: {
            organizationId,
            fullName: input.fullName,
            normalizedName: normalizePatientName(input.fullName),
            cpf: input.cpf,
            birthDate: input.birthDate,
            phone: input.phone,
          },
        });
        await tx.patientCreationRequest.create({
          data: {
            organizationId,
            idempotencyKey,
            requestHash,
            patientId: patient.id,
          },
        });
        return responseFor(patient);
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const concurrentReplay = await this.findReplay(
        organizationId,
        idempotencyKey,
        requestHash,
      );
      if (concurrentReplay) return responseFor(concurrentReplay);
      throw new ApiError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "A chave de idempotência está em uso.",
      );
    }
  }

  async update(
    organizationId: string,
    actorUserId: string,
    patientId: string,
    body: UpdatePatientBody,
    now = new Date(),
  ): Promise<PatientResponse> {
    assertOnlyAllowedPatientUpdateFields(body);

    if (
      typeof body.version !== "number" ||
      !Number.isInteger(body.version) ||
      body.version < 0
    ) {
      throw new ApiError("VALIDATION_ERROR", 400, "Versão inválida.", {
        field: "version",
      });
    }

    const normalizedFullName =
      body.fullName !== undefined
        ? normalizeFullName(body.fullName)
        : undefined;
    const normalizedCpf =
      body.cpf !== undefined ? validateAndNormalizeCpf(body.cpf) : undefined;
    const parsedBirthDate =
      body.birthDate !== undefined ? parseBirthDate(body.birthDate) : undefined;
    const normalizedPhone =
      body.phone !== undefined
        ? validateAndNormalizePhone(body.phone)
        : undefined;

    const providedFields: string[] = [];
    if (normalizedFullName !== undefined) providedFields.push("fullName");
    if (normalizedCpf !== undefined) providedFields.push("cpf");
    if (parsedBirthDate !== undefined) providedFields.push("birthDate");
    if (normalizedPhone !== undefined) providedFields.push("phone");

    if (providedFields.length === 0) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Informe ao menos um campo cadastral para atualização.",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.patient.findFirst({
        where: { id: patientId, organizationId },
        select: {
          id: true,
          fullName: true,
          cpf: true,
          birthDate: true,
          phone: true,
          version: true,
          createdAt: true,
        },
      });

      if (!current) {
        throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
      }

      if (current.version !== body.version) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "O cadastro do paciente foi atualizado por outra pessoa. Recarregue os dados antes de salvar.",
        );
      }

      if (normalizedCpf !== undefined && normalizedCpf !== current.cpf) {
        const duplicate = await tx.patient.findFirst({
          where: {
            organizationId,
            cpf: normalizedCpf,
            id: { not: patientId },
          },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        if (
          duplicate &&
          duplicate.id !== patientId &&
          body.distinctPersonConfirmed !== true
        ) {
          throw new ApiError(
            "POSSIBLE_DUPLICATE",
            409,
            "Foi encontrado um possível paciente duplicado nesta clínica.",
            { existingPatientId: duplicate.id, matchedOn: "cpf" },
          );
        }
      }

      const nextFullName = normalizedFullName ?? current.fullName;
      const nextCpf = normalizedCpf ?? current.cpf;
      const nextBirthDate = parsedBirthDate ?? current.birthDate;
      const nextPhone = normalizedPhone ?? current.phone;

      const modifiedFields: string[] = [];
      if (
        normalizedFullName !== undefined &&
        normalizedFullName !== current.fullName
      ) {
        modifiedFields.push("fullName");
      }
      if (normalizedCpf !== undefined && normalizedCpf !== current.cpf) {
        modifiedFields.push("cpf");
      }
      if (
        parsedBirthDate !== undefined &&
        parsedBirthDate.toISOString().slice(0, 10) !==
          current.birthDate.toISOString().slice(0, 10)
      ) {
        modifiedFields.push("birthDate");
      }
      if (normalizedPhone !== undefined && normalizedPhone !== current.phone) {
        modifiedFields.push("phone");
      }
      const changedFields =
        modifiedFields.length > 0 ? modifiedFields : providedFields;

      const nextVersion = current.version + 1;
      const updated = await tx.patient.updateMany({
        where: {
          id: patientId,
          organizationId,
          version: body.version,
        },
        data: {
          fullName: nextFullName,
          normalizedName: normalizePatientName(nextFullName),
          cpf: nextCpf,
          birthDate: nextBirthDate,
          phone: nextPhone,
          updatedAt: now,
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw new ApiError(
          "VERSION_CONFLICT",
          409,
          "O cadastro do paciente foi atualizado por outra pessoa. Recarregue os dados antes de salvar.",
        );
      }

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: "PATIENT_UPDATED",
          targetType: "PATIENT",
          targetId: current.id,
          metadata: {
            changedFields,
            previousVersion: current.version,
            newVersion: nextVersion,
            updatedAt: now.toISOString(),
          },
        },
      });

      return {
        patient: {
          id: current.id,
          fullName: nextFullName,
          cpf: nextCpf,
          birthDate: nextBirthDate.toISOString().slice(0, 10),
          phone: nextPhone,
          version: nextVersion,
          createdAt: current.createdAt.toISOString(),
          updatedAt: now.toISOString(),
        },
      };
    });
  }

  async uploadAttachment(
    organizationId: string,
    patientId: string,
    actorUserId: string,
    body: UploadPatientAttachmentBody,
  ): Promise<UploadPatientAttachmentResponse> {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, organizationId },
      select: { id: true },
    });
    if (!patient) {
      throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
    }

    const bytes = await validateAttachmentFile(body.file);
    const store = this.attachmentStore;
    if (!store) {
      throw new ApiError(
        "STORAGE_UNAVAILABLE",
        503,
        "Armazenamento indisponível.",
      );
    }

    const fileName = sanitizeFileName(body.file.name);
    const category = body.category?.trim() || null;
    const description = body.description?.trim() || null;
    const objectKey = buildObjectKey(organizationId, patientId, fileName);

    await store.put(objectKey, bytes, body.file.type);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const verifiedPatient = await tx.patient.findFirst({
          where: { id: patientId, organizationId },
          select: { id: true },
        });
        if (!verifiedPatient) {
          throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
        }

        const attachment = await tx.patientAttachment.create({
          data: {
            organizationId,
            patientId,
            fileName,
            contentType: body.file.type,
            sizeBytes: bytes.length,
            objectKey,
            category,
            description,
            uploadedById: actorUserId,
          },
        });

        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId,
            action: "PATIENT_ATTACHMENT_UPLOADED",
            targetType: "PATIENT_ATTACHMENT",
            targetId: attachment.id,
            metadata: {
              patientId,
              fileName: attachment.fileName,
              contentType: attachment.contentType,
              sizeBytes: attachment.sizeBytes,
              category: attachment.category,
            },
          },
        });

        return attachment;
      });

      return toUploadAttachmentResponse(created);
    } catch (error) {
      await store.delete(objectKey).catch(() => {});
      throw error;
    }
  }

  async listAttachments(
    organizationId: string,
    patientId: string,
    query: ListPatientAttachmentsQuery = {},
  ): Promise<ListPatientAttachmentsResponse> {
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, organizationId },
      select: { id: true },
    });
    if (!patient) {
      throw new ApiError("NOT_FOUND", 404, "Paciente não encontrado.");
    }

    const records = await this.prisma.patientAttachment.findMany({
      where: {
        organizationId,
        patientId,
        ...(query.includeArchived ? {} : { archivedAt: null }),
        ...(query.category ? { category: query.category.trim() } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });

    const items = records.map(toAttachmentItem);
    return {
      data: items,
      attachments: items,
    };
  }

  async createDownloadUrl(
    organizationId: string,
    patientId: string,
    attachmentId: string,
    actorUserId: string,
  ): Promise<PatientAttachmentDownloadUrlResponse> {
    const attachment = await this.prisma.patientAttachment.findFirst({
      where: {
        id: attachmentId,
        patientId,
        organizationId,
      },
    });
    if (!attachment || attachment.archivedAt !== null) {
      throw new ApiError("NOT_FOUND", 404, "Anexo não encontrado.");
    }

    const store = this.attachmentStore;
    if (!store) {
      throw new ApiError(
        "STORAGE_UNAVAILABLE",
        503,
        "Armazenamento indisponível.",
      );
    }

    const downloadUrl = await store.downloadUrl(attachment.objectKey);
    const expiresInSeconds = PATIENT_ATTACHMENT_URL_TTL_SECONDS;
    const expiresAt = new Date(
      Date.now() + expiresInSeconds * 1000,
    ).toISOString();

    await this.prisma.auditLog.create({
      data: {
        organizationId,
        actorUserId,
        action: "PATIENT_ATTACHMENT_DOWNLOAD_AUTHORIZED",
        targetType: "PATIENT_ATTACHMENT",
        targetId: attachment.id,
        metadata: {
          patientId: attachment.patientId,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          expiresInSeconds,
          expiresAt,
        },
      },
    });

    return {
      attachmentId: attachment.id,
      downloadUrl,
      expiresInSeconds,
      expiresAt,
    };
  }

  async archiveAttachment(
    organizationId: string,
    patientId: string,
    attachmentId: string,
    actorUserId: string,
    body?: ArchivePatientAttachmentBody | null,
  ): Promise<ArchivePatientAttachmentResponse> {
    const reason = body?.reason?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.patientAttachment.findFirst({
        where: {
          id: attachmentId,
          patientId,
          organizationId,
        },
      });
      if (!existing) {
        throw new ApiError("NOT_FOUND", 404, "Anexo não encontrado.");
      }
      if (existing.archivedAt !== null) {
        return {
          archived: true as const,
          attachment: toAttachmentItem(existing),
        };
      }

      const now = new Date();
      const claimed = await tx.patientAttachment.updateMany({
        where: { id: existing.id, organizationId, patientId, archivedAt: null },
        data: {
          archivedAt: now,
          archivedById: actorUserId,
          archiveReason: reason,
        },
      });
      if (claimed.count === 0) {
        const archived = await tx.patientAttachment.findFirst({
          where: { id: existing.id, organizationId, patientId },
        });
        if (!archived) {
          throw new ApiError("NOT_FOUND", 404, "Anexo não encontrado.");
        }
        return {
          archived: true as const,
          attachment: toAttachmentItem(archived),
        };
      }

      const updated = {
        ...existing,
        archivedAt: now,
        archivedById: actorUserId,
        archiveReason: reason,
      };

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: "PATIENT_ATTACHMENT_ARCHIVED",
          targetType: "PATIENT_ATTACHMENT",
          targetId: existing.id,
          metadata: {
            patientId: existing.patientId,
            fileName: existing.fileName,
            reason,
          },
        },
      });

      return {
        archived: true as const,
        attachment: toAttachmentItem(updated),
      };
    });
  }

  private async findReplay(
    organizationId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<PatientRecord | null> {
    const request = await this.prisma.patientCreationRequest.findUnique({
      where: {
        organizationId_idempotencyKey: { organizationId, idempotencyKey },
      },
      select: {
        requestHash: true,
        patient: {
          select: {
            id: true,
            fullName: true,
            cpf: true,
            birthDate: true,
            phone: true,
            version: true,
            createdAt: true,
          },
        },
      },
    });
    if (!request) return null;
    if (request.requestHash !== requestHash)
      throw new ApiError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "A chave de idempotência já foi usada com outros dados.",
      );
    return request.patient;
  }
}
