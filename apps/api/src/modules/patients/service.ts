import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { normalizeCpf } from "../../lib/cpf";
import type { CreatePatientBody, PatientResponse } from "./model";

type PatientRecord = {
  id: string;
  fullName: string;
  cpf: string;
  birthDate: Date;
  phone: string;
  version: number;
  createdAt: Date;
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

function normalizePhone(value: string) {
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
