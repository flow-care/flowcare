import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { isValidCpf, normalizeCpf } from "../../lib/cpf";
import {
  ALLOWED_PATIENT_UPDATE_FIELDS,
  type CreatePatientBody,
  type PatientResponse,
  type UpdatePatientBody,
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

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
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

  async create(
    organizationId: string,
    idempotencyKey: string,
    body: CreatePatientBody,
  ): Promise<PatientResponse> {
    const input = {
      fullName: normalizeFullName(body.fullName),
      cpf: validateAndNormalizeCpf(body.cpf),
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
      body.phone !== undefined ? normalizePhone(body.phone) : undefined;

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
