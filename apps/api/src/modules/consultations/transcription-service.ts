import type {
  PrismaClient,
  TranscriptionJobStatus,
} from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type { ConsultationAudioStore } from "../../services/consultation-audio-store";
import type {
  AnamnesisTopicDefinition,
  ExtractionProvider,
} from "../../services/extraction-provider";
import type {
  TranscriptionProvider,
  TranscriptionResult,
} from "../../services/transcription-provider";
import type {
  TranscriptionResponse,
  TranscriptionStatusResponse,
} from "./model";

/** Tópicos que a tela de revisão sempre exibe (espelho do front). */
const CANONICAL_TOPICS: AnamnesisTopicDefinition[] = [
  {
    key: "chief_complaint",
    label: "Queixa principal",
    description: "Motivo relatado pelo paciente na consulta.",
  },
  {
    key: "hda",
    label: "História da doença atual (HDA)",
    description:
      "Evolução cronológica dos sintomas, início e fatores de piora/melhora.",
  },
  {
    key: "antecedents",
    label: "Antecedentes pessoais e familiares",
    description:
      "Comorbidades, histórico familiar, medicamentos em uso e alergias.",
  },
  {
    key: "physical_exam",
    label: "Exame físico",
    description: "Achados objetivos, sinais vitais e avaliação física.",
  },
  {
    key: "conduct",
    label: "Conduta e hipótese diagnóstica",
    description:
      "Conclusão diagnóstica, prescrições, encaminhamentos e plano terapêutico.",
  },
];

export class ConsultationTranscriptionService {
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: TranscriptionProvider | null = null,
    private readonly audioStore: ConsultationAudioStore | null = null,
    private readonly extractionProvider: ExtractionProvider | null = null,
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

  /** Retorna o job de transcrição mais recente da consulta (polling da web). */
  async status(
    organizationId: string,
    consultationId: string,
    options: { professionalId?: string } = {},
  ): Promise<TranscriptionStatusResponse> {
    const consultation = await this.prisma.consultation.findFirst({
      where: {
        id: consultationId,
        organizationId,
        ...(options.professionalId
          ? { professionalId: options.professionalId }
          : {}),
      },
      select: { id: true },
    });
    if (!consultation) {
      throw new ApiError("NOT_FOUND", 404, "Atendimento não encontrado.");
    }

    const job = await this.prisma.transcriptionJob.findFirst({
      where: { organizationId, consultationId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        text: true,
        errorReason: true,
      },
    });

    if (!job) {
      throw new ApiError(
        "NOT_FOUND",
        404,
        "Nenhuma transcrição solicitada para este atendimento.",
      );
    }

    return {
      jobId: job.id,
      status: job.status,
      text: job.text ?? null,
      error: job.errorReason ?? null,
    };
  }

  async dispatchProvider(
    jobId: string,
    organizationId: string,
    consultationId: string,
    audio: { id: string; objectKey: string; contentType: string },
  ): Promise<void> {
    if (!this.provider) return;
    try {
      // Provedores externos só recebem o áudio por URL assinada e temporária:
      // o bucket permanece privado e o Sintesy nunca tem credencial de storage.
      const sourceUrlExpiresAt = new Date(Date.now() + 60 * 60_000);
      const sourceUrl = this.audioStore
        ? await this.audioStore.signedDownloadUrl(audio.objectKey, 3600)
        : undefined;

      const result = await this.provider.transcribe({
        jobId,
        organizationId,
        consultationId,
        audioId: audio.id,
        objectKey: audio.objectKey,
        contentType: audio.contentType,
        sourceUrl,
        sourceUrlExpiresAt: sourceUrlExpiresAt.toISOString(),
      });

      // A extração de tópicos é acessório: se o gateway falhar, o job conclui
      // com o texto salvo e o profissional revisa/preenche manualmente.
      const extracted = await this.extractTopics(
        organizationId,
        consultationId,
        result,
      );

      await this.prisma.$transaction(async (tx) => {
        await tx.transcriptionJob.update({
          where: { id: jobId },
          data: {
            status: "COMPLETED",
            providerJobId: result.providerJobId ?? null,
            durationSeconds: result.durationSeconds ?? 0,
            text: result.text,
            ...(extracted ? { topics: extracted } : {}),
            finishedAt: new Date(),
          },
        });

        await tx.audioProcessing.updateMany({
          where: { audioId: audio.id },
          data: { status: "COMPLETED" },
        });

        if (extracted && Object.keys(extracted).length > 0) {
          await this.applyDraft(organizationId, consultationId, extracted);
        }
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
              errorReason: message.slice(0, 1000),
              retryCount: { increment: 1 },
              durationSeconds: 0,
              finishedAt: new Date(),
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

  /** Catálogo de tópicos: os canônicos da tela + os ativos configurados. */
  private async resolveTopics(
    organizationId: string,
    consultationId: string,
    professionalId: string,
  ): Promise<AnamnesisTopicDefinition[]> {
    const consultation = await this.prisma.consultation.findFirst({
      where: { id: consultationId, organizationId },
      select: {
        anamnesisTopicRevision: { select: { topics: true } },
        patient: { select: { fullName: true } },
      },
    });

    let configured = consultation?.anamnesisTopicRevision?.topics;
    if (!configured) {
      const config = await this.prisma.anamnesisTopicConfig.findUnique({
        where: {
          organizationId_professionalId: { organizationId, professionalId },
        },
        select: {
          revisions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { topics: true },
          },
        },
      });
      configured = config?.revisions[0]?.topics;
    }

    const custom: AnamnesisTopicDefinition[] = Array.isArray(configured)
      ? configured
          .filter(
            (
              topic,
            ): topic is { key: string; label: string; active?: boolean } =>
              Boolean(topic) &&
              typeof topic === "object" &&
              typeof (topic as { key?: unknown }).key === "string" &&
              typeof (topic as { label?: unknown }).label === "string" &&
              (topic as { active?: unknown }).active !== false,
          )
          .map((topic) => ({ key: topic.key, label: topic.label }))
      : [];

    const seen = new Set(CANONICAL_TOPICS.map((topic) => topic.key));
    return [
      ...CANONICAL_TOPICS,
      ...custom.filter((topic) => !seen.has(topic.key)),
    ];
  }

  private async extractTopics(
    organizationId: string,
    consultationId: string,
    result: TranscriptionResult,
  ): Promise<Record<string, string> | null> {
    if (!this.extractionProvider) return null;
    try {
      const consultation = await this.prisma.consultation.findFirst({
        where: { id: consultationId, organizationId },
        select: {
          professionalId: true,
          anamnesisStatus: true,
          patient: { select: { fullName: true } },
        },
      });
      // Nunca sobrescreve anamnese já aprovada nem rascunho editado à mão.
      if (!consultation || consultation.anamnesisStatus !== "PENDING") {
        return null;
      }

      const topics = await this.resolveTopics(
        organizationId,
        consultationId,
        consultation.professionalId,
      );
      return await this.extractionProvider.extractTopics({
        transcript: result.text,
        topics,
        patientName: consultation.patient?.fullName ?? null,
      });
    } catch {
      return null;
    }
  }

  /** Escreve os tópicos no rascunho, preservando o que já existia. */
  private async applyDraft(
    organizationId: string,
    consultationId: string,
    extracted: Record<string, string>,
  ): Promise<void> {
    const consultation = await this.prisma.consultation.findFirst({
      where: { id: consultationId, organizationId },
      select: { anamnesisDraft: true },
    });
    if (!consultation) return;

    const existingDraft =
      consultation.anamnesisDraft &&
      typeof consultation.anamnesisDraft === "object" &&
      !Array.isArray(consultation.anamnesisDraft)
        ? (consultation.anamnesisDraft as Record<string, unknown>)
        : {};
    const existingTopics =
      existingDraft.topics &&
      typeof existingDraft.topics === "object" &&
      !Array.isArray(existingDraft.topics)
        ? (existingDraft.topics as Record<string, unknown>)
        : {};

    await this.prisma.consultation.update({
      where: { id: consultationId },
      data: {
        anamnesisDraft: {
          ...existingDraft,
          topics: { ...existingTopics, ...extracted },
        } as unknown as Record<string, string>,
        anamnesisStatus: "DRAFT",
        draftSavedAt: new Date(),
      },
    });
  }
}
