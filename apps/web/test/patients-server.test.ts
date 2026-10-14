import { afterEach, beforeEach, expect, mock, test } from "bun:test";

let mockSessionToken: string | null = "valid-session-jwt";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
  }),
}));

const { getPatients, PatientsApiError } = await import("../server/patients");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

test("getPatients throws UNAUTHENTICATED when session token is missing", async () => {
  mockSessionToken = null;
  expect(getPatients("clinica-vida")).rejects.toThrow(PatientsApiError);
});

test("getPatients fetches patients with search and pagination query params", async () => {
  let requestedUrl = "";
  let authHeader = "";

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requestedUrl = url;
    authHeader = (init?.headers as Record<string, string>)?.Authorization ?? "";
    return Response.json({
      data: [
        {
          id: "pt_1",
          fullName: "Ana Silva",
          cpf: "12345678900",
          birthDate: "1990-05-15",
          phone: "11987654321",
          email: "ana@example.com",
          healthInsurance: "Unimed",
          insuranceNumber: "98765",
          version: 1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      pageInfo: {
        nextCursor: "pt_2",
        hasNextPage: true,
      },
    });
  }) as unknown as typeof fetch;

  const result = await getPatients("clinica-vida", {
    search: "Ana",
    cursor: "pt_0",
    limit: 10,
  });

  expect(authHeader).toBe("Bearer valid-session-jwt");
  expect(requestedUrl).toContain("/organizations/clinica-vida/patients");
  expect(requestedUrl).toContain("search=Ana");
  expect(requestedUrl).toContain("cursor=pt_0");
  expect(requestedUrl).toContain("limit=10");
  expect(result.data).toHaveLength(1);
  expect(result.data[0].fullName).toBe("Ana Silva");
  expect(result.pageInfo.hasNextPage).toBe(true);
});

test("getPatients handles 403 Forbidden error", async () => {
  globalThis.fetch = (async () => {
    return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
  }) as unknown as typeof fetch;

  expect(getPatients("clinica-vida")).rejects.toThrow(
    "Você não tem permissão para visualizar os pacientes desta clínica.",
  );
});

test("getPatients handles 404 Not Found error", async () => {
  globalThis.fetch = (async () => {
    return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
  }) as unknown as typeof fetch;

  expect(getPatients("clinica-vida")).rejects.toThrow(
    "Clínica não encontrada.",
  );
});
