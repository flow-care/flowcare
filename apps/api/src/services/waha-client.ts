import { ApiError } from "../lib/api-error";

export type WahaSession = {
  status: string;
  me?: { id?: string | null } | null;
};

export type WahaQr = { mimetype: string; data: string };

export interface WhatsAppProvider {
  getSession(name: string): Promise<WahaSession | null>;
  createSession(name: string): Promise<WahaSession>;
  restartSession(name: string): Promise<void>;
  getQr(name: string): Promise<WahaQr | null>;
  sendText?(session: string, chatId: string, text: string): Promise<string>;
}

export class WahaSendError extends Error {
  constructor(
    readonly outcome: "temporary" | "permanent" | "uncertain",
    readonly code: string,
  ) {
    super(code);
  }
}

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class WahaClient implements WhatsAppProvider {
  constructor(
    private readonly config: { baseUrl: string; apiKey: string | null },
  ) {}

  async getSession(name: string): Promise<WahaSession | null> {
    const response = await this.request(
      `/api/sessions/${encodeURIComponent(name)}`,
    );
    if (response.status === 404) return null;
    await this.ensureOk(response);
    return this.readSession(response);
  }

  async createSession(name: string): Promise<WahaSession> {
    const response = await this.request("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ name, start: true }),
    });
    await this.ensureOk(response);
    return this.readSession(response);
  }

  async restartSession(name: string): Promise<void> {
    const response = await this.request(
      `/api/sessions/${encodeURIComponent(name)}/restart`,
      { method: "POST", body: "{}" },
    );
    await this.ensureOk(response);
  }

  async getQr(name: string): Promise<WahaQr | null> {
    const response = await this.request(
      `/api/${encodeURIComponent(name)}/auth/qr?format=image`,
      { headers: { accept: "application/json" } },
    );
    if (
      response.status === 404 ||
      response.status === 409 ||
      response.status === 422
    )
      return null;
    await this.ensureOk(response);
    const value = await this.readJson(response);
    if (
      !isRecord(value) ||
      value.mimetype !== "image/png" ||
      typeof value.data !== "string" ||
      !value.data ||
      value.data.length > MAX_RESPONSE_BYTES
    )
      throw providerUnavailable();
    return { mimetype: value.mimetype, data: value.data };
  }

  async sendText(
    session: string,
    chatId: string,
    text: string,
  ): Promise<string> {
    let response: Response;
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (this.config.apiKey) headers["x-api-key"] = this.config.apiKey;
      response = await fetch(
        `${this.config.baseUrl.replace(/\/$/, "")}/api/sendText`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ session, chatId, text }),
          redirect: "error",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new WahaSendError("uncertain", "PROVIDER_OUTCOME_UNKNOWN");
    }
    if (!response.ok)
      throw new WahaSendError(
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
          ? "uncertain"
          : "permanent",
        `WAHA_HTTP_${response.status}`,
      );
    let value: unknown;
    try {
      value = await this.readJson(response);
    } catch {
      throw new WahaSendError("uncertain", "PROVIDER_RESPONSE_INVALID");
    }
    if (
      !isRecord(value) ||
      (typeof value.id !== "string" &&
        !(isRecord(value.id) && typeof value.id._serialized === "string"))
    )
      throw new WahaSendError("uncertain", "PROVIDER_RESPONSE_INVALID");
    return typeof value.id === "string"
      ? value.id
      : (value.id as { _serialized: string })._serialized;
  }

  private async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.config.apiKey) headers.set("x-api-key", this.config.apiKey);
    if (init.body) headers.set("content-type", "application/json");
    try {
      return await fetch(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
        ...init,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw providerUnavailable();
    }
  }

  private async ensureOk(response: Response) {
    if (!response.ok) throw providerUnavailable();
  }

  private async readSession(response: Response): Promise<WahaSession> {
    const value = await this.readJson(response);
    if (!isRecord(value) || typeof value.status !== "string")
      throw providerUnavailable();
    const me = value.me;
    if (
      me !== undefined &&
      me !== null &&
      (!isRecord(me) ||
        (me.id !== undefined && me.id !== null && typeof me.id !== "string"))
    )
      throw providerUnavailable();
    return {
      status: value.status,
      me:
        me === undefined || me === null
          ? me
          : { id: typeof me.id === "string" ? me.id : null },
    };
  }

  private async readJson(response: Response): Promise<unknown> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (declaredLength > MAX_RESPONSE_BYTES) throw providerUnavailable();
    if (!response.body) throw providerUnavailable();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw providerUnavailable();
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw providerUnavailable();
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function providerUnavailable() {
  return new ApiError(
    "COMMUNICATION_PROVIDER_UNAVAILABLE",
    503,
    "Integração de WhatsApp indisponível.",
  );
}
