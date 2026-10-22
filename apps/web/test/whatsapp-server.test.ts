import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let mockSessionToken: string | null = "valid-session-jwt";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
    set: () => {},
  }),
}));

const {
  getPatientNames,
  getWhatsAppStatus,
  listWhatsAppMessages,
  listWhatsAppTemplates,
  requestWhatsAppQr,
  resendWhatsAppMessage,
  saveWhatsAppTemplate,
  WhatsAppApiError,
  whatsappErrorBody,
  whatsappErrorHttpStatus,
} = await import("../server/whatsapp");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

interface Captured {
  url: string;
  init: RequestInit;
}

function mockFetch(
  responder: (call: Captured) => Response | Promise<Response>,
): Captured[] {
  const calls: Captured[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
  return calls;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function headersOf(call: Captured): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

describe("whatsapp BFF connection", () => {
  test("reads the status scoped to the organization without caching", async () => {
    const calls = mockFetch(() =>
      json({ status: "CONNECTED", phoneNumber: "5511999998888" }),
    );
    const status = await getWhatsAppStatus("vida e saude");

    expect(status).toEqual({
      status: "CONNECTED",
      phoneNumber: "5511999998888",
    });
    expect(calls[0]?.url).toBe(
      "http://api.test/api/organizations/vida%20e%20saude/communications/whatsapp/status",
    );
    expect(calls[0]?.init.cache).toBe("no-store");
    expect(headersOf(calls[0] as Captured).Authorization).toBe(
      "Bearer valid-session-jwt",
    );
  });

  test("fails without a session before calling the API", async () => {
    mockSessionToken = null;
    const calls = mockFetch(() => json({}));
    await expect(getWhatsAppStatus("clinic")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(calls).toHaveLength(0);
  });

  test("returns the QR with a server-side validity window", async () => {
    const expiresAt = new Date(Date.now() + 20_000).toISOString();
    const calls = mockFetch(() =>
      json({
        status: "QR_CODE_REQUIRED",
        phoneNumber: null,
        qrCode: "data:image/png;base64,iVBORw0KGgo=",
        qrExpiresAt: expiresAt,
      }),
    );
    const session = await requestWhatsAppQr("clinic");

    expect(calls[0]?.init.method).toBe("POST");
    expect(session.qrCode).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(session.qrExpiresInMs).toBeGreaterThan(15_000);
    expect(session.qrExpiresInMs).toBeLessThanOrEqual(20_000);
    expect("qrExpiresAt" in session).toBe(false);
  });

  test("rejects a QR that is not an inline image", async () => {
    mockFetch(() =>
      json({
        status: "QR_CODE_REQUIRED",
        phoneNumber: null,
        qrCode: "https://tracker.example/qr.png",
        qrExpiresAt: new Date(Date.now() + 20_000).toISOString(),
      }),
    );
    await expect(requestWhatsAppQr("clinic")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  test("maps permission and provider failures without leaking bodies", async () => {
    mockFetch(() => json({ error: { code: "PERMISSION_DENIED" } }, 403));
    await expect(requestWhatsAppQr("clinic")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    mockFetch(() =>
      json(
        {
          error: {
            code: "COMMUNICATION_PROVIDER_UNAVAILABLE",
            message: "waha at 10.0.0.5 refused",
          },
        },
        503,
      ),
    );
    const error = await requestWhatsAppQr("clinic").catch((e) => e);
    expect(error).toBeInstanceOf(WhatsAppApiError);
    expect(error.code).toBe("COMMUNICATION_PROVIDER_UNAVAILABLE");
    expect(error.message).not.toContain("10.0.0.5");
    expect(whatsappErrorHttpStatus(error)).toBe(503);
    expect(whatsappErrorBody(error).message).not.toContain("10.0.0.5");

    mockFetch(() => {
      throw new Error("connect ECONNREFUSED 10.0.0.5:3000");
    });
    const network = await getWhatsAppStatus("clinic").catch((e) => e);
    expect(network.code).toBe("UNAVAILABLE");
    expect(network.message).not.toContain("10.0.0.5");
  });
});

describe("whatsapp BFF messages", () => {
  test("lists with status, period lower bound, cursor and limit", async () => {
    const calls = mockFetch(() => json({ items: [], nextCursor: null }));
    await listWhatsAppMessages("clinic", {
      status: "FAILED",
      from: "2026-10-01T00:00:00.000Z",
      cursor: "7f2c8a3e-1111-4222-8333-444455556666",
      limit: 25,
    });
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe(
      "/api/organizations/clinic/communications/messages",
    );
    expect(url.searchParams.get("status")).toBe("FAILED");
    expect(url.searchParams.get("from")).toBe("2026-10-01T00:00:00.000Z");
    expect(url.searchParams.get("cursor")).toBe(
      "7f2c8a3e-1111-4222-8333-444455556666",
    );
    expect(url.searchParams.get("limit")).toBe("25");
  });

  test("parses masked items and rejects unknown statuses", async () => {
    mockFetch(() =>
      json({
        items: [
          {
            id: "m1",
            type: "APPOINTMENT_REMINDER",
            status: "FAILED",
            patientId: "p1",
            appointmentId: "a1",
            phoneMasked: "(11) 98765-****",
            createdAt: "2026-10-20T10:00:00.000Z",
            sentAt: null,
            errorCode: "WAHA_ACK_ERROR",
            errorReason: "O provedor confirmou falha na entrega.",
          },
        ],
        nextCursor: "m1",
      }),
    );
    const page = await listWhatsAppMessages("clinic");
    expect(page.items[0]?.phoneMasked).toBe("(11) 98765-****");
    expect(page.nextCursor).toBe("m1");

    mockFetch(() =>
      json({
        items: [{ id: "m1", status: "WEIRD" }],
        nextCursor: null,
      }),
    );
    await expect(listWhatsAppMessages("clinic")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  test("resend sends the Idempotency-Key header and no body", async () => {
    const calls = mockFetch(() => json({ status: "QUEUED" }));
    const result = await resendWhatsAppMessage(
      "clinic",
      "7f2c8a3e-1111-4222-8333-444455556666",
      "key-12345678",
    );
    expect(result).toEqual({ status: "QUEUED" });
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.url).toBe(
      "http://api.test/api/organizations/clinic/communications/messages/7f2c8a3e-1111-4222-8333-444455556666/resend",
    );
    expect(headersOf(calls[0] as Captured)["Idempotency-Key"]).toBe(
      "key-12345678",
    );
    expect(calls[0]?.init.body).toBeUndefined();
  });

  test("surfaces the state conflict of a message that is not FAILED", async () => {
    mockFetch(() =>
      json(
        {
          error: {
            code: "MESSAGE_STATE_CONFLICT",
            message: "A mensagem não pode ser reenviada.",
          },
        },
        409,
      ),
    );
    const error = await resendWhatsAppMessage(
      "clinic",
      "m",
      "key-12345678",
    ).catch((e) => e);
    expect(error.code).toBe("MESSAGE_STATE_CONFLICT");
    expect(whatsappErrorHttpStatus(error)).toBe(409);
  });

  test("resolves patient names best-effort", async () => {
    mockFetch((call) =>
      call.url.endsWith("/patients/p1")
        ? json({ id: "p1", fullName: "Maria da Silva" })
        : json({}, 404),
    );
    const names = await getPatientNames("clinic", ["p1", "p2", "p1"]);
    expect(names.get("p1")).toBe("Maria da Silva");
    expect(names.has("p2")).toBe(false);
  });
});

describe("whatsapp BFF templates", () => {
  const template = {
    type: "APPOINTMENT_REMINDER_24H",
    content: "Olá, {paciente_nome}.",
    version: 2,
    allowedVariables: ["{paciente_nome}"],
    maxLength: 4096,
    approvedById: "u1",
    approvedAt: "2026-10-20T10:00:00.000Z",
    createdAt: "2026-10-19T10:00:00.000Z",
    updatedAt: "2026-10-20T10:00:00.000Z",
  };

  test("lists the configured templates", async () => {
    mockFetch(() => json({ data: [template] }));
    const templates = await listWhatsAppTemplates("clinic");
    expect(templates[0]?.version).toBe(2);
  });

  test("saves with optimistic concurrency", async () => {
    const calls = mockFetch(() => json(template));
    const saved = await saveWhatsAppTemplate(
      "clinic",
      "APPOINTMENT_REMINDER_24H",
      {
        content: "Olá, {paciente_nome}.",
        version: 1,
      },
    );
    expect(saved.version).toBe(2);
    expect(calls[0]?.init.method).toBe("PUT");
    expect(calls[0]?.url).toEndWith(
      "/communications/whatsapp/templates/APPOINTMENT_REMINDER_24H",
    );
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      content: "Olá, {paciente_nome}.",
      version: 1,
    });
  });

  test("keeps API validation messages for invalid variables", async () => {
    mockFetch(() =>
      json(
        {
          error: {
            code: "INVALID_TEMPLATE_VARIABLE",
            message: "Variável não permitida: {medicamento}.",
          },
        },
        422,
      ),
    );
    const error = await saveWhatsAppTemplate(
      "clinic",
      "APPOINTMENT_CONFIRMATION",
      {
        content: "{medicamento}",
        version: 0,
      },
    ).catch((e) => e);
    expect(error.code).toBe("INVALID_TEMPLATE_VARIABLE");
    expect(error.message).toContain("{medicamento}");
  });

  test("reports a version conflict with guidance to reload", async () => {
    mockFetch(() =>
      json({ error: { code: "VERSION_CONFLICT", message: "conflict" } }, 409),
    );
    const error = await saveWhatsAppTemplate(
      "clinic",
      "APPOINTMENT_CONFIRMATION",
      {
        content: "Olá",
        version: 1,
      },
    ).catch((e) => e);
    expect(error.code).toBe("VERSION_CONFLICT");
    expect(error.message).toContain("Recarregue");
  });
});
