import { createHmac, timingSafeEqual } from "node:crypto";
import { Elysia } from "elysia";

/**
 * Webhook de eventos da API B2B do Sintesy.
 *
 * O Flowcare consulta o estado dos jobs por polling, então este endpoint não é
 * uma dependência do fluxo de transcrição: ele existe para que a Sintesy tenha
 * um destino válido, responde 200 sem efeitos colaterais e registra nada além
 * do necessário. A validação de assinatura impede que terceiros usem a rota.
 *
 * Assinatura (ver `apps/b2b/services/webhooks.py` no sintesy-me-api):
 * `X-Sintesy-Signature: v1=<hex>` sobre `${timestamp}.${rawBody}`, com
 * HMAC-SHA256 usando o segredo do parceiro.
 */
const SIGNATURE_VERSION = "v1";
const MAX_TIMESTAMP_SKEW_SECONDS = 300;

function safeEqual(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(received, "utf8");
  if (expectedBytes.length !== receivedBytes.length) return false;
  return timingSafeEqual(expectedBytes, receivedBytes);
}

export function createSintesyWebhook(secret: string | null) {
  return new Elysia({ name: "sintesy-webhook" }).post(
    "/webhooks/sintesy",
    async ({ request, set }) => {
      if (!secret) {
        set.status = 503;
        return { error: { code: "WEBHOOK_NOT_CONFIGURED" } };
      }

      const signature = request.headers.get("x-sintesy-signature") ?? "";
      const timestamp = request.headers.get("x-sintesy-timestamp") ?? "";
      const rawBody = await request.text();

      const timestampSeconds = Number.parseInt(timestamp, 10);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (
        !Number.isFinite(timestampSeconds) ||
        Math.abs(nowSeconds - timestampSeconds) > MAX_TIMESTAMP_SKEW_SECONDS
      ) {
        set.status = 401;
        return { error: { code: "STALE_TIMESTAMP" } };
      }

      const expected = `${SIGNATURE_VERSION}=${createHmac("sha256", secret)
        .update(`${timestamp}.${rawBody}`)
        .digest("hex")}`;

      if (!safeEqual(expected, signature)) {
        set.status = 401;
        return { error: { code: "INVALID_SIGNATURE" } };
      }

      return { received: true };
    },
  );
}
