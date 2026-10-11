import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { safeReturnPath } from "../lib/auth";
import { formatInviteRole, inviteDetailsSchema } from "../lib/invites";

mock.module("server-only", () => ({}));
const cookieWrites: Array<Record<string, unknown>> = [];
mock.module("next/headers", () => ({
  cookies: async () => ({
    set: (options: Record<string, unknown>) => cookieWrites.push(options),
    get: (_name: string) => ({ value: "valid-session-jwt" }),
  }),
}));

const { acceptInviteAction, declineInviteAction } = await import(
  "../app/(auth)/accept-invite/actions"
);

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  cookieWrites.length = 0;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

function respondWith(body: unknown, status = 200) {
  globalThis.fetch = (async () =>
    Response.json(body, { status })) as unknown as typeof fetch;
}

test("formatInviteRole mapeia os perfis de membro para rótulos legíveis", () => {
  expect(formatInviteRole("ADMIN")).toBe("Administrador");
  expect(formatInviteRole("ADMIN_PROFESSIONAL")).toBe(
    "Administrador e Clínico",
  );
  expect(formatInviteRole("PROFESSIONAL")).toBe("Profissional Clínico");
  expect(formatInviteRole("RECEPTIONIST")).toBe("Recepção");
  expect(formatInviteRole("CUSTOM")).toBe("CUSTOM");
});

test("inviteDetailsSchema valida payload correto e recusa e-mail inválido", () => {
  const valid = {
    organizationName: "Clínica Vida",
    organizationSlug: "clinica-vida",
    email: "medico@clinica.com",
    role: "PROFESSIONAL",
    expiresAt: "2026-10-16T12:00:00.000Z",
  };
  expect(inviteDetailsSchema.safeParse(valid).success).toBe(true);
  expect(
    inviteDetailsSchema.safeParse({ ...valid, email: "invalido" }).success,
  ).toBe(false);
});

test("safeReturnPath permite rota de aceite de convite", () => {
  expect(safeReturnPath("/accept-invite/tok_12345678901234567890")).toBe(
    "/accept-invite/tok_12345678901234567890",
  );
  expect(
    safeReturnPath("//evil.example/accept-invite/tok_12345678901234567890"),
  ).toBeNull();
});

test("acceptInviteAction recusa token menor que 20 caracteres antes de chamar backend", async () => {
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return Response.json({});
  }) as unknown as typeof fetch;

  const result = await acceptInviteAction("curto");
  expect(result).toMatchObject({
    ok: false,
    error: { code: "INVALID_TOKEN" },
  });
  expect(called).toBe(false);
});

test("acceptInviteAction aceita convite com sucesso e retorna organizationSlug", async () => {
  respondWith({ organizationSlug: "clinica-vida" }, 200);
  const result = await acceptInviteAction(
    "token_valido_com_mais_de_vinte_caracteres",
  );
  expect(result).toEqual({
    ok: true,
    data: { organizationSlug: "clinica-vida" },
  });
});

test("acceptInviteAction mapeia erro de e-mail diferente (FORBIDDEN)", async () => {
  respondWith(
    {
      error: {
        code: "FORBIDDEN",
        message: "Este convite pertence a outro e-mail.",
      },
    },
    403,
  );
  const result = await acceptInviteAction(
    "token_valido_com_mais_de_vinte_caracteres",
  );
  expect(result).toMatchObject({
    ok: false,
    error: { code: "FORBIDDEN" },
  });
});

test("acceptInviteAction mapeia convite expirado ou inexistente (INVITE_EXPIRED)", async () => {
  respondWith(
    {
      error: {
        code: "INVITE_EXPIRED",
        message: "Convite expirado ou inválido.",
      },
    },
    410,
  );
  const result = await acceptInviteAction(
    "token_valido_com_mais_de_vinte_caracteres",
  );
  expect(result).toMatchObject({
    ok: false,
    error: { code: "INVITE_EXPIRED" },
  });
});

test("declineInviteAction recusa convite com sucesso", async () => {
  respondWith({ message: "Convite recusado." }, 200);
  const result = await declineInviteAction(
    "token_valido_com_mais_de_vinte_caracteres",
  );
  expect(result).toEqual({
    ok: true,
    data: { message: "Convite recusado." },
  });
});
