import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { WhatsAppQueueWorker } from "./modules/communications/worker";
import { createPrismaClient } from "./services/db";
import { createMailer } from "./services/mailer";
import { WahaClient } from "./services/waha-client";

// Raiz de composição: monta env, infra e aplicação.
const env = loadEnv();
const prisma = createPrismaClient(env.databaseUrl);
const mailer = createMailer(env);
const whatsappProvider = new WahaClient({
  baseUrl: env.wahaBaseUrl,
  apiKey: env.wahaApiKey,
});

const app = createApp(env, { prisma, mailer, whatsappProvider }).listen(
  env.port,
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
