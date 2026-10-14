import type {
  PrismaClient,
  TranscriptionJobStatus,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type { TranscriptionProvider } from "../../services/transcription-provider";
import type { TranscriptionResponse } from "./model";

export class ConsultationTranscriptionService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: TranscriptionProvider | null = null,
  ) {}

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = previous.then(() => current);
    this.locks.set(key, chain);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chain) {
        this.locks.delete(key);
      }
    }
  }

  async transcribe(
    organizationId: string,
    consultationId: string,
    actorUserId: string,
    idempotencyKey?: string,
  ): Promise<TranscriptionResponse> {
    const key = idempotencyKey?.trim();
    if (!key) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Cabeçalho Idempotency-Key é obrigatório.",
        { field: "idempotencyKey" },
      );
    }

    const lockKey = `${organizationId}:consultation:${consultationId}:transcribe`;
    return this.withLock(lockKey, async () => {
      const consultation = await this.prisma.consultation.findFirst({
        where: {
          id: consultationId,
          organizationId,
        },
        include: {
          audios: {
            where: {
              status: "UPLOADED",
              objectDeletedAt: null,
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });

      if (!consultation) {
        throw new ApiError("NOT_FOUND", 404, "Atendimento não encontrado.");
      }

      if (consultation.professionalId !== actorUserId) {
        throw new ApiError(
          "PERMISSION_DENIED",
          403,
          "Profissional não autorizado para este atendimento.",
        );
      }

      if (consultation.status === "CANCELLED") {
        throw new ApiError(
          "BUSINESS_RULE_VIOLATION",
          422,
          "Atendimento cancelado.",
        );
      }

      const validAudio = consultation.audios.find(
        (audio) =>
          audio.status === "UPLOADED" &&
          audio.consentConfirmedAt &&
          !audio.objectDeletedAt,
      );

      if (!validAudio) {
        throw new ApiError(
          "BUSINESS_RULE_VIOLATION",
          422,
          "Consulta não possui áudio com consentimento confirmado.",
        );
      }

      // 1. Idempotency by key: return existing job representation without creating duplicate
      const existingByKey = await this.prisma.transcriptionJob.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId,
            idempotencyKey: key,
          },
        },
      });

      if (existingByKey) {
        if (existingByKey.consultationId !== consultationId) {
          throw new ApiError(
            "IDEMPOTENCY_CONFLICT",
            409,
            "A chave de idempotência já foi utilizada em outra consulta.",
          );
        }
        return {
          jobId: existingByKey.id,
          status: existingByKey.status,
        };
      }

      // 2. Prevent duplicate active jobs for the same consultation:
      // If a job is currently PROCESSING or QUEUED, return it idempotently
      const activeJob = await this.prisma.transcriptionJob.findFirst({
        where: {
          organizationId,
          consultationId,
          status: { in: ["PROCESSING", "QUEUED"] },
        },
        orderBy: { createdAt: "desc" },
      });

      if (activeJob) {
        return {
          jobId: activeJob.id,
          status: activeJob.status,
        };
      }

      // 3. Create new transcription job and audit log in transaction
      try {
        const job = await this.prisma.$transaction(async (tx) => {
          const created = await tx.transcriptionJob.create({
            data: {
              organizationId,
              consultationId,
              audioId: validAudio.id,
              idempotencyKey: key,
              status: "PROCESSING",
              provider: this.provider ? "external" : "simulated",
            },
          });

          await tx.auditLog.create({
            data: {
              organizationId,
              actorUserId,
              action: "CONSULTATION_TRANSCRIPTION_REQUESTED",
              targetType: "CONSULTATION",
              targetId: consultationId,
              metadata: {
                consultationId,
                jobId: created.id,
                audioId: validAudio.id,
                idempotencyKey: key,
              },
            },
          });

          return created;
        });

        // 4. Safely trigger provider dispatch in the background without unhandled rejection
        if (this.provider) {
          void this.dispatchProvider(
            job.id,
            organizationId,
            consultationId,
            validAudio,
          );
        }

        return {
          jobId: job.id,
          status: job.status as TranscriptionJobStatus,
        };
      } catch (err: unknown) {
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          err.code === "P2002"
        ) {
          const replay = await this.prisma.transcriptionJob.findUnique({
            where: {
              organizationId_idempotencyKey: {
                organizationId,
                idempotencyKey: key,
              },
            },
          });
          if (replay) {
            return {
              jobId: replay.id,
              status: replay.status,
            };
          }
        }
        throw err;
      }
    });
  }

  async dispatchProvider(
    jobId: string,
    organizationId: string,
    consultationId: string,
    audio: { id: string; objectKey: string; contentType: string },
  ): Promise<void> {
    if (!this.provider) return;
    try {
      const result = await this.provider.transcribe({
        jobId,
        organizationId,
        consultationId,
        audioId: audio.id,
        objectKey: audio.objectKey,
        contentType: audio.contentType,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.transcriptionJob.update({
          where: { id: jobId },
          data: {
            status: "COMPLETED",
            providerJobId: result.providerJobId ?? null,
          },
        });

        await tx.audioProcessing.updateMany({
          where: { audioId: audio.id },
          data: { status: "COMPLETED" },
        });
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Erro desconhecido no provedor";

      await this.prisma
        .$transaction(async (tx) => {
          await tx.transcriptionJob.update({
            where: { id: jobId },
            data: {
              status: "FAILED",
              errorReason: message,
              retryCount: { increment: 1 },
            },
          });

          await tx.audioProcessing.updateMany({
            where: { audioId: audio.id },
            data: { status: "FAILED" },
          });
        })
        .catch(() => {});
    }
  }
}
