import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { z } from "zod";
import { destinationAfterLogin, safeReturnPath } from "../lib/auth";
import { proxy } from "../proxy";

// Next impõe server-only no build. Aqui substituímos apenas as fronteiras do runtime.
mock.module("server-only", () => ({}));
const cookieWrites: Array<Record<string, unknown>> = [];
let incomingHeaders = new Headers();
mock.module("next/headers", () => ({
  cookies: async () => ({
    set: (options: Record<string, unknown>) => cookieWrites.push(options),
  }),
  headers: async () => incomingHeaders,
}));

const {
  loginAction,
  registerAction,
  verifyEmailAction,
  resendVerificationAction,
  forgotPasswordAction,
  resetPasswordAction,
} = await import("../app/(auth)/actions");
const { postApi } = await import("../server/api-client");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalTrustProxy = process.env.TRUST_PROXY;
const credentials = { email: "ana@example.com", password: "senha12345" };
const session = {
  user: { id: "u1", email: credentials.email, fullName: "Ana" },
  availableOrganizations: [
    {
      id: "o1",
      name: "Clínica",
      slug: "clinica",
      role: "ADMIN" as const,
      isOwner: true,
    },
  ],
  activeOrganization: null,
  onboardingCompleted: false,
  onboardingCurrentStep: "PROFILE_SETUP",
};

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  process.env.NODE_ENV = "production";
  process.env.TRUST_PROXY = "false";
  cookieWrites.length = 0;
  incomingHeaders = new Headers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalTrustProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = originalTrustProxy;
});

function respondWith(body: unknown, status = 200) {
  globalThis.fetch = (async () =>
    Response.json(body, { status })) as unknown as typeof fetch;
}

test("returnTo aceita somente destinos internos do aplicativo", () => {
  expect(safeReturnPath("/app/clinica/dashboard?tab=agenda")).toBe(
    "/app/clinica/dashboard?tab=agenda",
  );
  for (const path of [
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "/login",
  ]) {
    expect(safeReturnPath(path)).toBeNull();
  }
});

test("proxy redireciona sessão ausente e preserva o destino interno", () => {
  const response = proxy(
    new NextRequest("http://localhost/app/clinica/dashboard?tab=agenda"),
  );
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe(
    "http://localhost/login?returnTo=%2Fapp%2Fclinica%2Fdashboard%3Ftab%3Dagenda",
  );
});

test("proxy deixa passar uma sessão presente sem validar autorização", () => {
  const request = new NextRequest("http://localhost/app", {
    headers: { Cookie: "mf_session=opaque-token" },
  });
  expect(proxy(request).status).toBe(200);
});

test("proxy envia sessão presente para a resolução do onboarding", () => {
  const request = new NextRequest("http://localhost/login?returnTo=%2Fapp", {
    headers: { Cookie: "__Host-mf_session=opaque-token" },
  });
  expect(proxy(request).status).toBe(307);
  expect(proxy(request).headers.get("location")).toBe("http://localhost/");
});

test("proxy deixa páginas públicas acessíveis sem sessão", () => {
  expect(proxy(new NextRequest("http://localhost/login")).status).toBe(200);
});

test("login escolhe onboarding, clínica única ou seleção", () => {
  expect(destinationAfterLogin(session, null)).toBe("/onboarding/profile");
  expect(
    destinationAfterLogin(session, "/accept-invite/tok_12345678901234567890"),
  ).toBe("/accept-invite/tok_12345678901234567890");
  expect(
    destinationAfterLogin(
      { ...session, pendingInviteId: "00000000-0000-0000-0000-000000000001" },
      null,
    ),
  ).toBe("/accept-invite/00000000-0000-0000-0000-000000000001");
  expect(
    destinationAfterLogin(
      { ...session, onboardingCurrentStep: "ORGANIZATION_SETUP" },
      "/app/clinica/dashboard",
    ),
  ).toBe("/onboarding/clinic");
  expect(
    destinationAfterLogin(
      { ...session, onboardingCurrentStep: "SCHEDULE_SETUP" },
      null,
    ),
  ).toBe("/onboarding/pending");
  expect(
    destinationAfterLogin({ ...session, onboardingCompleted: true }, null),
  ).toBe("/app/clinica/dashboard");
  expect(
    destinationAfterLogin(
      { ...session, onboardingCompleted: true, availableOrganizations: [] },
      null,
    ),
  ).toBe("/select-organization");
  const multiple = [
    ...session.availableOrganizations,
    { ...session.availableOrganizations[0], id: "o2", slug: "outra" },
  ];
  expect(
    destinationAfterLogin(
      {
        ...session,
        onboardingCompleted: true,
        availableOrganizations: multiple,
        activeOrganization: { id: "o2", slug: "outra" },
      },
      null,
    ),
  ).toBe("/app/outra/dashboard");
  expect(
    destinationAfterLogin(
      {
        ...session,
        onboardingCompleted: true,
        availableOrganizations: multiple,
        activeOrganization: { id: "o2", slug: "clinica" },
      },
      null,
    ),
  ).toBe("/select-organization");
});

test("login guarda token em cookie seguro e devolve apenas o DTO público", async () => {
  respondWith({
    ...session,
    token: "jwt-secreto",
    internalSecret: "privado",
    user: { ...session.user, passwordHash: "privado" },
    availableOrganizations: session.availableOrganizations.map(
      (organization) => ({ ...organization, billingSecret: "privado" }),
    ),
  });
  const result = await loginAction(credentials);
  expect(result).toEqual({ ok: true, data: session });
  expect(cookieWrites).toEqual([
    {
      name: "__Host-mf_session",
      value: "jwt-secreto",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    },
  ]);
});

test("login malformado não cria sessão", async () => {
  respondWith({ token: "jwt-secreto", user: session.user });
  const result = await loginAction(credentials);
  expect(result.ok).toBe(false);
  expect(cookieWrites).toHaveLength(0);
});

test("valida entradas no servidor antes de chamar o backend", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return Response.json({});
  }) as unknown as typeof fetch;
  const result = await loginAction({ email: "inválido", password: "" });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_ERROR" },
  });
  expect(called).toBe(false);
  expect(cookieWrites).toHaveLength(0);
});

test("credenciais inválidas preservam o código sem expor mensagem interna", async () => {
  respondWith(
    { error: { code: "INVALID_CREDENTIALS", message: "server-secret" } },
    401,
  );
  const result = await loginAction(credentials);
  expect(result).toMatchObject({
    ok: false,
    error: { code: "INVALID_CREDENTIALS" },
  });
  expect(JSON.stringify(result)).not.toContain("server-secret");
  expect(cookieWrites).toHaveLength(0);
});

test("configuração ausente não usa destino implícito", async () => {
  delete process.env.API_INTERNAL_URL;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return Response.json({});
  }) as unknown as typeof fetch;
  expect(await loginAction(credentials)).toMatchObject({
    ok: false,
    error: { code: "UPSTREAM_UNAVAILABLE" },
  });
  expect(called).toBe(false);
});

test("falhas de transporte não vazam detalhes", async () => {
  globalThis.fetch = (async () => {
    throw new Error("server-secret");
  }) as unknown as typeof fetch;
  const result = await forgotPasswordAction({ email: credentials.email });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "UPSTREAM_UNAVAILABLE" },
  });
  expect(JSON.stringify(result)).not.toContain("server-secret");
});

test("encaminha ao backend somente o último IP válido recebido do proxy", async () => {
  process.env.TRUST_PROXY = "true";
  incomingHeaders = new Headers({
    "x-forwarded-for": "198.51.100.99, 203.0.113.25",
  });
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const forwardedFor = new Headers(init?.headers).get("x-forwarded-for");
    expect(forwardedFor).toBe("203.0.113.25");
    expect(forwardedFor).not.toContain("198.51.100.99");
    return Response.json({ message: "OK" });
  }) as typeof fetch;

  expect(
    await postApi(
      "/auth/forgot-password",
      { email: credentials.email },
      z.object({ message: z.string() }),
      { requestHeaders: incomingHeaders },
    ),
  ).toEqual({ message: "OK" });
});

test("não encaminha IP informado pelo cliente quando o proxy não é confiável", async () => {
  incomingHeaders = new Headers({ "x-forwarded-for": "198.51.100.99" });
  globalThis.fetch = (async (
    _url: string | URL | Request,
    init?: RequestInit,
  ) => {
    expect(new Headers(init?.headers).has("x-forwarded-for")).toBe(false);
    return Response.json({ message: "OK" });
  }) as typeof fetch;

  expect(
    await postApi(
      "/auth/forgot-password",
      { email: credentials.email },
      z.object({ message: z.string() }),
      { requestHeaders: incomingHeaders },
    ),
  ).toEqual({ message: "OK" });
});

test("cadastro, confirmação, reenvio e recuperação chamam os endpoints Elysia", async () => {
  const paths: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    paths.push(String(url));
    if (String(url).endsWith("/auth/verify-email")) {
      return Response.json({
        token: "não expor",
        user: { id: "user-1", email: credentials.email, fullName: "Ana Silva" },
        availableOrganizations: [],
        onboardingCompleted: false,
        onboardingCurrentStep: "PROFILE_SETUP",
      });
    }
    return Response.json({ message: "OK", token: "não expor" });
  }) as typeof fetch;
  const results = [
    await registerAction({
      ...credentials,
      fullName: "Ana Silva",
      acceptedTerms: true,
    }),
    await verifyEmailAction({ token: "verificacao" }),
    await resendVerificationAction({ email: credentials.email }),
    await forgotPasswordAction({ email: credentials.email }),
  ];
  expect(results.every((result) => result.ok)).toBe(true);
  expect(JSON.stringify(results)).not.toContain("não expor");
  expect(paths).toEqual([
    "http://api.test/api/auth/register",
    "http://api.test/api/auth/verify-email",
    "http://api.test/api/auth/resend-verification",
    "http://api.test/api/auth/forgot-password",
  ]);
  expect(cookieWrites).toHaveLength(1);
  expect(cookieWrites[0]).toMatchObject({ httpOnly: true, value: "não expor" });
});

test("cadastro rejeita aceite de termos ausente no servidor", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return Response.json({ message: "OK" });
  }) as unknown as typeof fetch;
  const result = await registerAction({
    ...credentials,
    fullName: "Ana Silva",
    acceptedTerms: false as never,
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "VALIDATION_ERROR" },
  });
  expect(called).toBe(false);
});

test("reset limpa cookie somente depois do backend aceitar o token", async () => {
  respondWith({ error: { code: "INVALID_TOKEN" } }, 400);
  expect(
    await resetPasswordAction({ token: "usado", newPassword: "senha12345" }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_TOKEN" } });
  expect(cookieWrites).toHaveLength(0);
  respondWith({ message: "OK" });
  expect(
    await resetPasswordAction({ token: "valido", newPassword: "senha12345" }),
  ).toMatchObject({ ok: true });
  expect(cookieWrites).toEqual([
    expect.objectContaining({
      name: "__Host-mf_session",
      value: "",
      maxAge: 0,
    }),
  ]);
});
