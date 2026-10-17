import { afterEach, describe, expect, test } from "bun:test";
import type { ApiError } from "../src/lib/api-error";
import { WahaClient, type WahaSendError } from "../src/services/waha-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("WAHA client", () => {
  test("keeps the API key in a backend header and rejects redirects", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), init });
      return Response.json({
        status: "WORKING",
        me: { id: "5511999998888@c.us" },
      });
    }) as typeof fetch;
    const client = new WahaClient({
      baseUrl: "https://provider.invalid/",
      apiKey: "private-key",
    });

    await expect(client.getSession("private name")).resolves.toEqual({
      status: "WORKING",
      me: { id: "5511999998888@c.us" },
    });
    const observed = requests[0];
    if (!observed) throw new Error("Expected provider request");
    expect(observed.url).toBe(
      "https://provider.invalid/api/sessions/private%20name",
    );
    expect(new Headers(observed.init?.headers).get("x-api-key")).toBe(
      "private-key",
    );
    expect(observed.init?.redirect).toBe("error");
  });

  test("maps malformed, invalid JSON and oversized responses to stable 503 errors", async () => {
    const client = new WahaClient({
      baseUrl: "https://provider.invalid",
      apiKey: null,
    });
    for (const response of [
      Response.json({ status: 123 }),
      new Response("not-json", {
        headers: { "content-type": "application/json" },
      }),
      new Response("{}", { headers: { "content-length": "3000000" } }),
    ]) {
      globalThis.fetch = (async () => response) as unknown as typeof fetch;
      await expect(client.getSession("session")).rejects.toMatchObject({
        code: "COMMUNICATION_PROVIDER_UNAVAILABLE",
        httpStatus: 503,
      } satisfies Partial<ApiError>);
    }
  });

  test("does not classify timeout or HTTP 5xx as safely retryable", async () => {
    const client = new WahaClient({
      baseUrl: "https://provider.invalid",
      apiKey: null,
    });
    globalThis.fetch = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    await expect(
      client.sendText("private", "5511987654321@c.us", "message"),
    ).rejects.toMatchObject({
      outcome: "uncertain",
      code: "PROVIDER_OUTCOME_UNKNOWN",
    } satisfies Partial<WahaSendError>);

    globalThis.fetch = (async () =>
      new Response(null, { status: 503 })) as unknown as typeof fetch;
    await expect(
      client.sendText("private", "5511987654321@c.us", "message"),
    ).rejects.toMatchObject({
      outcome: "uncertain",
      code: "WAHA_HTTP_503",
    } satisfies Partial<WahaSendError>);
  });

  test("treats rate limiting as uncertain without a provider guarantee", async () => {
    const client = new WahaClient({
      baseUrl: "https://provider.invalid",
      apiKey: null,
    });
    globalThis.fetch = (async () =>
      new Response(null, { status: 429 })) as unknown as typeof fetch;
    await expect(
      client.sendText("private", "5511987654321@c.us", "message"),
    ).rejects.toMatchObject({
      outcome: "uncertain",
      code: "WAHA_HTTP_429",
    } satisfies Partial<WahaSendError>);
  });
});
