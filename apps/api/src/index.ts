import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { WhatsAppQueueWorker } from "./modules/communications/worker";
import { createPrismaClient } from "./services/db";
import { GorouterExtractionProvider } from "./services/extraction-provider";
import { createMailer } from "./services/mailer";
import { SintesyClient } from "./services/sintesy-client";
import {
  MockTranscriptionProvider,
  SintesyTranscriptionProvider,
} from "./services/transcription-provider";
import { WahaClient } from "./services/waha-client";

// Raiz de composição: monta env, infra e aplicação.
const env = loadEnv();
const prisma = createPrismaClient(env.databaseUrl);
const mailer = createMailer(env);
const whatsappProvider = new WahaClient({
  baseUrl: env.wahaBaseUrl,
  apiKey: env.wahaApiKey,
});

// Transcrição: com SINTESEY_MODE=live e chave B2B configurada, o áudio vai para
// o Sintesy; sem isso o provedor simulado mantém o fluxo utilizável em dev.
const transcriptionProvider =
  env.sintesyMode === "live" && env.sintesyB2bApiKey
    ? new SintesyTranscriptionProvider(
        new SintesyClient({
          baseUrl: env.sintesyBaseUrl ?? "https://api.sintesy.me",
          apiKey: env.sintesyB2bApiKey,
        }),
      )
    : new MockTranscriptionProvider();

const extractionProvider =
  env.gorouterBaseUrl && env.gorouterModel
    ? new GorouterExtractionProvider({
        baseUrl: env.gorouterBaseUrl,
        apiKey: env.gorouterApiKey ?? null,
        model: env.gorouterModel,
      })
    : null;

const app = createApp(env, {
  prisma,
  mailer,
  whatsappProvider,
  transcriptionProvider,
  extractionProvider,
}).listen(env.port);
console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    msg: "transcription-config",
    sintesyMode: env.sintesyMode ?? "mock",
    transcriptionProvider:
      transcriptionProvider instanceof SintesyTranscriptionProvider
        ? "sintesy-b2b"
        : "mock",
    extractionProvider:
      extractionProvider instanceof GorouterExtractionProvider
        ? `gorouter:${env.gorouterModel}`
        : "disabled",
    webhookSignature:
      (env.sintesyWebhookSecret ?? null) === null ? "disabled" : "enabled",
  }),
);
const queueWorker = new WhatsAppQueueWorker(prisma, whatsappProvider);
let processing = false;
if (env.whatsappSendEnabled)
  setInterval(async () => {
    if (processing) return;
    processing = true;
    try {
      await queueWorker.processBatch();
    } catch {
      console.error(
        JSON.stringify({ level: "error", msg: "whatsapp_queue_worker_failed" }),
      );
    } finally {
      processing = false;
    }
  }, 10_000);

// Log estruturado de boot — uma linha JSON, mesmo formato do request-logger
console.log(
  JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    msg: "boot",
    service: "flowcare-api",
    version: env.version,
    env: env.nodeEnv,
    port: app.server?.port ?? env.port,
  }),
);
