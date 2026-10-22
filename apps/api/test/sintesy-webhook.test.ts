import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createSintesyWebhook } from "../src/modules/webhooks/sintesy";

const SECRET = "partner-webhook-secret";

function buildApp(secret: string | null) {
  return new Elysia().use(createSintesyWebhook(secret));
}

function headersFor(
  body: string,
  options: { timestamp?: number; secret?: string } = {},
) {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const expected = `v1=${createHmac("sha256", options.secret ?? SECRET)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;
  return {
    "content-type": "application/json",
    "x-sintesy-timestamp": String(timestamp),
    "x-sintesy-signature": expected,
  };
}

function post(
  app: { handle: (request: Request) => Promise<Response> },
  body: string,
  headers: Record<string, string>,
) {
  return app.handle(
    new Request("http://localhost/webhooks/sintesy", {
      method: "POST",
      headers,
      body,
    }),
  );
}

describe("sintesy webhook", () => {
  test("aceita evento com assinatura válida", async () => {
    const app = buildApp(SECRET);
    const body = JSON.stringify({ id: "evt_1", type: "job.completed" });
    const res = await post(app, body, headersFor(body));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
  });

  test("rejeita assinatura inválida com 401", async () => {
    const app = buildApp(SECRET);
    const body = JSON.stringify({ id: "evt_1" });
    const headers = {
      ...headersFor(body),
      "x-sintesy-signature": `v1=${"0".repeat(64)}`,
    };

    const res = await post(app, body, headers);

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_SIGNATURE",
    );
  });

  test("rejeita timestamp fora da janela de tolerância com 401", async () => {
    const app = buildApp(SECRET);
    const body = JSON.stringify({ id: "evt_1" });
    const stale = Math.floor(Date.now() / 1000) - 3600;

    const res = await post(app, body, headersFor(body, { timestamp: stale }));

    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "STALE_TIMESTAMP",
    );
  });

  test("responde 503 quando o segredo não está configurado", async () => {
    const app = buildApp(null);
    const body = JSON.stringify({ id: "evt_1" });

    const res = await post(app, body, headersFor(body));

    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "WEBHOOK_NOT_CONFIGURED",
    );
  });
});
