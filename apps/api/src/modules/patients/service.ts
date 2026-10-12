import type {
  AppointmentStatus,
  Prisma,
  PrismaClient,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { normalizeCpf } from "../../lib/cpf";
import type {
  CreatePatientBody,
  ListPatientsQuery,
  ListPatientsResponse,
  PatientDetailItem,
  PatientDetailResponse,
  PatientOverviewResponse,
  PatientResponse,
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

function parseBirthDate(value: string) {
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

export function normalizePhone(value: string): string {
  return value.replace(/\D/g, "");
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
  constructor(private readonly prisma: PrismaClient) {}

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
    const appointmentDelegate = (
      this.prisma as unknown as {
        appointment?: {
          findMany?: (
            args: Record<string, unknown>,
          ) => Promise<UpcomingAppointmentRecord[]>;
        };
      }
    ).appointment;

    const upcomingRows = appointmentDelegate?.findMany
      ? await appointmentDelegate.findMany({
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
        })
      : [];

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
      fullName: body.fullName.trim().replace(/\s+/g, " "),
      cpf: normalizeCpf(body.cpf),
      birthDate: parseBirthDate(body.birthDate),
      phone: normalizePhone(body.phone),
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
