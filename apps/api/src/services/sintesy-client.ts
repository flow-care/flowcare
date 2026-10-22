/**
 * Cliente da API B2B do Sintesy (api.sintesy.me/b2b/v1).
 *
 * Contrato verificado direto no serviço:
 * - POST /b2b/v1/jobs/       header Authorization: Bearer sb2b_…  + Idempotency-Key
 * - GET  /b2b/v1/jobs/{id}/  mesma autenticação
 * - O job é assíncrono (pode levar minutos); o resultado traz o texto
 *   integral e a duração medida pelo Sintesy.
 *
 * Segredo só no backend: nunca chamar da web.
 */

export type SintesyJobStatus = "queued" | "processing" | "succeeded" | "failed";

export interface SintesyExtractionResult {
  text: string;
  duration_seconds: number;
  language: string | null;
  title: string | null;
  method: string;
  metadata?: Record<string, unknown>;
}

export interface SintesyJob {
  id: string;
  external_id: string;
  status: SintesyJobStatus;
  result: SintesyExtractionResult | null;
  error: unknown;
  source_refresh_required?: boolean;
}

export interface CreateSintesyJobInput {
  externalId: string;
  /** URL pública/assinada do áudio; o Sintesy precisa alcançá-la. */
  sourceUrl: string;
  sourceType?: "file" | "pdf" | "youtube" | "vimeo" | "web";
  /** ISO-8601 com fuso, exigido pelo Sintesy para URLs assinadas. */
  sourceExpiresAt?: string;
  language?: string | null;
}

export class SintesyApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SintesyApiError";
  }
}

export class SintesyClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: {
    baseUrl: string;
    apiKey: string;
    timeoutMs?: number;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  private async request<T>(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      // O Cloudflare em frente a api.sintesy.me bloqueia clientes sem
      // User-Agent de aplicação (erro 1010). Identificamos o serviço.
      "User-Agent": "flowcare-api/1.0 (+https://flowcare.me)",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new SintesyApiError(
        "UPSTREAM_UNAVAILABLE",
        "Serviço de transcrição indisponível.",
      );
    }

    const raw = await response.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      const detail =
        parsed && typeof parsed === "object"
          ? ((parsed as Record<string, unknown>).detail ??
            (parsed as Record<string, unknown>).error)
          : null;
      throw new SintesyApiError(
        response.status === 401 || response.status === 403
          ? "UPSTREAM_UNAUTHORIZED"
          : "UPSTREAM_ERROR",
        typeof detail === "string"
          ? `Sintesy recusou a requisição: ${detail.slice(0, 200)}`
          : `Sintesy respondeu ${response.status}.`,
        response.status,
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new SintesyApiError(
        "INVALID_RESPONSE",
        "Resposta inválida do serviço de transcrição.",
      );
    }
    return parsed as T;
  }

  async createJob(
    input: CreateSintesyJobInput,
    idempotencyKey: string,
  ): Promise<SintesyJob> {
    const body: Record<string, unknown> = {
      external_id: input.externalId,
      source_type: input.sourceType ?? "file",
      source_url: input.sourceUrl,
    };
    if (input.sourceExpiresAt) body.source_expires_at = input.sourceExpiresAt;
    if (input.language) body.language = input.language;

    return this.request<SintesyJob>("/b2b/v1/jobs/", {
      method: "POST",
      body,
      idempotencyKey,
    });
  }

  getJob(jobId: string): Promise<SintesyJob> {
    return this.request<SintesyJob>(
      `/b2b/v1/jobs/${encodeURIComponent(jobId)}/`,
      { method: "GET" },
    );
  }
}
