export interface TranscriptionRequest {
  jobId: string;
  organizationId: string;
  consultationId: string;
  audioId: string;
  objectKey: string;
  contentType: string;
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
