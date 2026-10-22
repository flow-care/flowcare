import type { SintesyClient } from "./sintesy-client";

export interface TranscriptionRequest {
  jobId: string;
  organizationId: string;
  consultationId: string;
  audioId: string;
  objectKey: string;
  contentType: string;
  /** URL assinada de leitura do áudio (necessária para provedores externos). */
  sourceUrl?: string;
  sourceUrlExpiresAt?: string;
}

export interface TranscriptionResult {
  text: string;
  durationSeconds?: number;
  providerJobId?: string;
}

export interface TranscriptionProvider {
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  constructor(
    private readonly options: {
      fail?: boolean;
      errorMessage?: string;
      delayMs?: number;
      durationSeconds?: number;
      text?: string;
    } = {},
  ) {}

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    if (this.options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }
    if (this.options.fail) {
      throw new Error(
        this.options.errorMessage ?? "Transcription provider unavailable",
      );
    }
    return {
      text: this.options.text ?? "Transcrição simulada do atendimento clínico.",
      durationSeconds: this.options.durationSeconds ?? 60,
      providerJobId: `provider_${request.jobId}`,
    };
  }
}

/**
 * Provedor real: usa a API B2B do Sintesy.
 *
 * O Sintesy processa de forma assíncrona, então aqui criamos o job e
 * consultamos até o estado terminal. O consumo do texto final continua sendo
 * responsabilidade do `ConsultationTranscriptionService`.
 */
export class SintesyTranscriptionProvider implements TranscriptionProvider {
  constructor(
    private readonly client: SintesyClient,
    private readonly options: {
      pollIntervalMs?: number;
      maxWaitMs?: number;
      language?: string | null;
    } = {},
  ) {}

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    if (!request.sourceUrl) {
      throw new Error(
        "Áudio sem URL assinada: não é possível enviar para o Sintesy.",
      );
    }

    const pollIntervalMs = this.options.pollIntervalMs ?? 5_000;
    const deadline = Date.now() + (this.options.maxWaitMs ?? 15 * 60_000);

    const created = await this.client.createJob(
      {
        externalId: request.jobId,
        sourceUrl: request.sourceUrl,
        sourceType: "file",
        sourceExpiresAt: request.sourceUrlExpiresAt,
        language: this.options.language ?? "pt",
      },
      request.jobId,
    );

    let job = created;
    while (job.status === "queued" || job.status === "processing") {
      if (Date.now() >= deadline) {
        throw new Error(`Transcrição não concluída no prazo (job ${job.id}).`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      job = await this.client.getJob(job.id);
    }

    if (job.status === "failed") {
      const detail =
        job.error && typeof job.error === "object"
          ? String(
              (job.error as Record<string, unknown>).message ??
                (job.error as Record<string, unknown>).code ??
                "falha no provedor",
            )
          : "falha no provedor";
      throw new Error(`Sintesy não transcreveu o áudio: ${detail}`);
    }

    const result = job.result;
    if (!result?.text?.trim()) {
      throw new Error("Sintesy concluiu o job sem texto de transcrição.");
    }

    return {
      text: result.text.trim(),
      durationSeconds: Math.max(0, Math.round(result.duration_seconds ?? 0)),
      providerJobId: job.id,
    };
  }
}
