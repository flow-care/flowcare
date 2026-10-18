/**
 * Env tipado — carregado uma única vez no boot (fail-fast).
 *
 * Regras:
 * - Variável obrigatória NUNCA tem default: erro de boot com nome claro.
 * - URLs e segredos vêm do ambiente; produção define tudo
 *   via /root/flowcare/.env (ver docs/infra/SECRETS.md).
 */
export interface Env {
  port: number;
  nodeEnv: string;
  version: string;
  jwtSecret: string;
  databaseUrl: string;
  corsOrigin: string;
  trustProxy: boolean;
  wahaBaseUrl: string;
  wahaApiKey: string | null;
  wahaWebhookSecret?: string | null;
  whatsappSendEnabled?: boolean;
  /** Base pública do front (usada nos links de e-mail). */
  webAppUrl: string;
  mailProvider: "disabled" | "console" | "ses";
  sesRegion: string | null;
  mailFrom: string | null;
  snsTopicArn?: string | null;
  sesConfigurationSet?: string | null;
  storageEndpoint?: string | null;
  storageBucket?: string | null;
  storageRegion?: string;
  storageAccessKeyId?: string | null;
  storageSecretAccessKey?: string | null;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[boot] Variável obrigatória ausente: ${name}. Copie .env.example → .env e preencha (docs/infra/SECRETS.md).`,
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`[boot] ${name} deve ser true ou false.`);
}

export function loadEnv(): Env {
  const nodeEnv = optional("NODE_ENV", "development");
  const whatsappSendEnabled = optionalBoolean("WHATSAPP_SEND_ENABLED", false);
  const wahaWebhookSecret = process.env.WAHA_WEBHOOK_SECRET?.trim() || null;
  if (whatsappSendEnabled && !wahaWebhookSecret) {
    throw new Error(
      "[boot] WAHA_WEBHOOK_SECRET é obrigatório quando WHATSAPP_SEND_ENABLED=true.",
    );
  }
  const sesRegion = process.env.AWS_REGION?.trim() || null;
  const mailFrom = process.env.MAIL_FROM?.trim() || null;
  const snsTopicArn = process.env.SNS_TOPIC_ARN?.trim() || null;
  const sesConfigurationSet = process.env.SES_CONFIGURATION_SET?.trim() || null;
  const storageEndpoint = process.env.STORAGE_ENDPOINT?.trim() || null;
  const storageBucket = process.env.STORAGE_BUCKET?.trim() || null;
  const storageAccessKeyId = process.env.STORAGE_ACCESS_KEY_ID?.trim() || null;
  const storageSecretAccessKey =
    process.env.STORAGE_SECRET_ACCESS_KEY?.trim() || null;
  const storageRegion = optional("STORAGE_REGION", "auto");
  const storageValues = [
    storageEndpoint,
    storageBucket,
    storageAccessKeyId,
    storageSecretAccessKey,
  ];
  if (storageValues.some(Boolean) && storageValues.some((value) => !value)) {
    throw new Error(
      "[boot] STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID e STORAGE_SECRET_ACCESS_KEY devem ser configurados juntos.",
    );
  }
  const mailProvider = optional(
    "MAIL_PROVIDER",
    nodeEnv === "production" ? "disabled" : "console",
  );
  if (
    mailProvider !== "disabled" &&
    mailProvider !== "console" &&
    mailProvider !== "ses"
  ) {
    throw new Error("[boot] MAIL_PROVIDER deve ser disabled, console ou ses.");
  }
  if (nodeEnv === "production" && mailProvider === "console") {
    throw new Error(
      "[boot] MAIL_PROVIDER=console não é permitido em produção.",
    );
  }
  if (nodeEnv !== "production" && mailProvider === "ses") {
    throw new Error(
      "[boot] MAIL_PROVIDER=ses exige NODE_ENV=production; dev e testes não enviam e-mails externos.",
    );
  }
  if (mailProvider === "ses" && (!sesRegion || !mailFrom)) {
    throw new Error(
      "[boot] AWS_REGION e MAIL_FROM são obrigatórios para MAIL_PROVIDER=ses.",
    );
  }
  return {
    port: Number(optional("PORT", "3000")),
    nodeEnv,
    version: optional("APP_VERSION", "0.1.0"),
    jwtSecret: required("JWT_SECRET"),
    databaseUrl: required("DATABASE_URL"),
    corsOrigin: required("CORS_ORIGIN"),
    trustProxy: optionalBoolean("TRUST_PROXY", false),
    wahaBaseUrl: required("WAHA_BASE_URL"),
    wahaApiKey: process.env.WAHA_API_KEY ?? null,
    wahaWebhookSecret,
    whatsappSendEnabled,
    webAppUrl: required("APP_WEB_URL"),
    mailProvider,
    sesRegion,
    mailFrom,
    snsTopicArn,
    sesConfigurationSet,
    storageEndpoint,
    storageBucket,
    storageRegion,
    storageAccessKeyId,
    storageSecretAccessKey,
  };
}
