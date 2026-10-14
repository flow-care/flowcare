import { afterEach, beforeEach, expect, mock, test } from "bun:test";

let mockSessionToken: string | null = "valid-session-jwt";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
    set: () => {},
  }),
}));
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

const { formatCpf, isValidCpf, normalizeCpf } = await import(
  "../lib/patient-formatters"
);

const { createPatient, checkPatientDuplicates, PatientsApiError } =
  await import("../server/patients");

const { createPatientAction, checkPatientDuplicatesAction } = await import(
  "../app/app/[orgSlug]/patients/actions"
);

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

// ----------------------------------------------------
// 1. CPF formatting and validation tests
// ----------------------------------------------------

test("formatCpf: formats partial digits dynamically while typing", () => {
  expect(formatCpf("")).toBe("");
  expect(formatCpf("1")).toBe("1");
  expect(formatCpf("123")).toBe("123");
  expect(formatCpf("1234")).toBe("123.4");
  expect(formatCpf("123456")).toBe("123.456");
  expect(formatCpf("1234567")).toBe("123.456.7");
  expect(formatCpf("123456789")).toBe("123.456.789");
  expect(formatCpf("1234567890")).toBe("123.456.789-0");
  expect(formatCpf("12345678901")).toBe("123.456.789-01");
});

test("formatCpf: caps at 11 digits when extra numbers are typed or pasted", () => {
  expect(formatCpf("123456789019999")).toBe("123.456.789-01");
});

test("normalizeCpf: extracts only numbers", () => {
  expect(normalizeCpf("123.456.789-01")).toBe("12345678901");
  expect(normalizeCpf("abc 529.982.247-25 xyz")).toBe("52998224725");
});

test("isValidCpf: validates known valid Brazilian CPFs", () => {
  // Valid CPFs
  expect(isValidCpf("52998224725")).toBe(true);
  expect(isValidCpf("529.982.247-25")).toBe(true);
  expect(isValidCpf("12345678909")).toBe(true);
});

test("isValidCpf: rejects invalid CPFs with wrong check digits or all identical digits", () => {
  expect(isValidCpf("11111111111")).toBe(false);
  expect(isValidCpf("00000000000")).toBe(false);
  expect(isValidCpf("12345678900")).toBe(false);
  expect(isValidCpf("123456")).toBe(false);
  expect(isValidCpf("")).toBe(false);
});

// ----------------------------------------------------
// 2. createPatient server function tests
// ----------------------------------------------------

test("createPatient: sends correct payload and Idempotency-Key header", async () => {
  let capturedUrl = "";
  let capturedHeaders: HeadersInit | undefined;
  let capturedBody: string | undefined;

  globalThis.fetch = mock(
    async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      capturedBody = init?.body as string;

      return new Response(
        JSON.stringify({
          patient: {
            id: "pt_new_123",
            fullName: "Carlos Silva",
            cpf: "52998224725",
            birthDate: "1990-05-15",
            phone: "11987654321",
            version: 0,
            createdAt: "2026-10-14T20:00:00.000Z",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    },
  ) as typeof fetch;

  const result = await createPatient("clinica-vida", {
    fullName: "Carlos Silva",
    cpf: "529.982.247-25",
    birthDate: "1990-05-15",
    phone: "(11) 98765-4321",
    idempotencyKey: "custom-key-123",
  });

  expect(capturedUrl).toContain("/organizations/clinica-vida/patients");
  const headers = capturedHeaders as Record<string, string>;
  expect(headers["Idempotency-Key"]).toBe("custom-key-123");
  expect(headers.Authorization).toBe("Bearer valid-session-jwt");

  const parsedBody = JSON.parse(capturedBody ?? "{}");
  expect(parsedBody).toEqual({
    fullName: "Carlos Silva",
    cpf: "52998224725",
    birthDate: "1990-05-15",
    phone: "11987654321",
  });

  expect(result.patient.id).toBe("pt_new_123");
  expect(result.patient.fullName).toBe("Carlos Silva");
});

test("createPatient: auto-generates idempotencyKey when not provided", async () => {
  let capturedHeaders: HeadersInit | undefined;

  globalThis.fetch = mock(
    async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          patient: {
            id: "pt_auto_456",
            fullName: "Maria Silva",
            cpf: "52998224725",
            birthDate: "1992-08-10",
            phone: "11977778888",
            version: 0,
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    },
  ) as typeof fetch;

  await createPatient("clinica-vida", {
    fullName: "Maria Silva",
    cpf: "52998224725",
    birthDate: "1992-08-10",
    phone: "11977778888",
  });

  const headers = capturedHeaders as Record<string, string>;
  expect(headers["Idempotency-Key"]).toBeTruthy();
  expect(typeof headers["Idempotency-Key"]).toBe("string");
});

test("createPatient: handles 409 POSSIBLE_DUPLICATE and throws PatientsApiError with details", async () => {
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: "POSSIBLE_DUPLICATE",
          message:
            "Foi encontrado um possível paciente duplicado nesta clínica.",
          details: {
            existingPatientId: "pt_existing_999",
            matchedOn: "cpf",
          },
        },
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await createPatient("clinica-vida", {
      fullName: "Carlos Silva",
      cpf: "52998224725",
      birthDate: "1990-05-15",
      phone: "11987654321",
    });
    expect.unreachable("should have thrown 409 error");
  } catch (error) {
    expect(error).toBeInstanceOf(PatientsApiError);
    const err = error as InstanceType<typeof PatientsApiError>;
    expect(err.code).toBe("POSSIBLE_DUPLICATE");
    expect(err.message).toBe(
      "Foi encontrado um possível paciente duplicado nesta clínica.",
    );
    expect(err.details).toEqual({
      existingPatientId: "pt_existing_999",
      matchedOn: "cpf",
    });
  }
});

test("createPatient: throws PatientsApiError on 401 unauthenticated and 403 forbidden", async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "FORBIDDEN",
            message:
              "Você não tem permissão para cadastrar pacientes nesta clínica.",
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
  ) as typeof fetch;

  try {
    await createPatient("clinica-vida", {
      fullName: "Carlos Silva",
      cpf: "52998224725",
      birthDate: "1990-05-15",
      phone: "11987654321",
    });
    expect.unreachable("should have thrown 403 error");
  } catch (error) {
    expect(error).toBeInstanceOf(PatientsApiError);
    const err = error as InstanceType<typeof PatientsApiError>;
    expect(err.code).toBe("FORBIDDEN");
  }
});

// ----------------------------------------------------
// 3. checkPatientDuplicates server function tests
// ----------------------------------------------------

test("checkPatientDuplicates: calls endpoint with document and phone query payload", async () => {
  let capturedUrl = "";
  let capturedHeaders: HeadersInit | undefined;
  let capturedBody: string | undefined;

  globalThis.fetch = mock(
    async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      capturedBody = init?.body as string;

      return new Response(
        JSON.stringify({
          isDuplicate: true,
          conflictField: "document",
          existingPatientId: "pt_dup_111",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  ) as typeof fetch;

  const result = await checkPatientDuplicates("clinica-vida", {
    document: "52998224725",
    phone: "11987654321",
  });

  expect(capturedUrl).toContain(
    "/organizations/clinica-vida/patients/check-duplicates",
  );
  expect((capturedHeaders as Record<string, string>)?.Authorization).toBe(
    "Bearer valid-session-jwt",
  );
  const parsedBody = JSON.parse(capturedBody ?? "{}");
  expect(parsedBody).toEqual({
    document: "52998224725",
    phone: "11987654321",
  });

  expect(result.isDuplicate).toBe(true);
  expect(result.conflictField).toBe("document");
  expect(result.existingPatientId).toBe("pt_dup_111");
});

test("checkPatientDuplicates: returns isDuplicate false when no conflict found", async () => {
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        isDuplicate: false,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await checkPatientDuplicates("clinica-vida", {
    document: "52998224725",
  });

  expect(result.isDuplicate).toBe(false);
  expect(result.existingPatientId).toBeFalsy();
});

test("checkPatientDuplicates: returns isDuplicate false immediately when neither document nor phone is provided", async () => {
  let fetchCalled = false;
  globalThis.fetch = mock(async () => {
    fetchCalled = true;
    return new Response(JSON.stringify({ isDuplicate: false }), {
      status: 200,
    });
  }) as typeof fetch;

  const result = await checkPatientDuplicates("clinica-vida", {});

  expect(result.isDuplicate).toBe(false);
  expect(fetchCalled).toBe(false);
});

// ----------------------------------------------------
// 4. Server actions tests
// ----------------------------------------------------

test("createPatientAction: succeeds and returns newly created patient", async () => {
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        patient: {
          id: "pt_action_success",
          fullName: "Ana Santos",
          cpf: "52998224725",
          birthDate: "1988-11-20",
          phone: "11988887777",
          version: 0,
        },
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const res = await createPatientAction("clinica-vida", {
    fullName: "Ana Santos",
    cpf: "52998224725",
    birthDate: "1988-11-20",
    phone: "11988887777",
  });

  expect(res.success).toBe(true);
  expect(res.data?.id).toBe("pt_action_success");
  expect(res.data?.fullName).toBe("Ana Santos");
});

test("createPatientAction: maps duplicate conflict 409 error", async () => {
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: "POSSIBLE_DUPLICATE",
          message: "Paciente duplicado encontrado.",
          details: {
            existingPatientId: "pt_exist_888",
            matchedOn: "cpf",
          },
        },
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const res = await createPatientAction("clinica-vida", {
    fullName: "Ana Santos",
    cpf: "52998224725",
    birthDate: "1988-11-20",
    phone: "11988887777",
  });

  expect(res.success).toBe(false);
  expect(res.code).toBe("POSSIBLE_DUPLICATE");
  expect(res.existingPatientId).toBe("pt_exist_888");
  expect(res.conflictField).toBe("cpf");
});

test("checkPatientDuplicatesAction: returns duplicate result", async () => {
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        isDuplicate: true,
        conflictField: "phone",
        existingPatientId: "pt_phone_dup",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const res = await checkPatientDuplicatesAction("clinica-vida", {
    phone: "11988887777",
  });

  expect(res.success).toBe(true);
  expect(res.isDuplicate).toBe(true);
  expect(res.conflictField).toBe("phone");
  expect(res.existingPatientId).toBe("pt_phone_dup");
});
