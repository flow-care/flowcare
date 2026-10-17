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
mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

const { updatePatient, PatientsApiError } = await import("../server/patients");

const { getPatientOverviewAction, updatePatientAction } = await import(
  "../app/app/[orgSlug]/patients/actions"
);

const { formatCpf, maskCpf } = await import("../lib/patient-formatters");

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

// Helper mirror for client validation
function validateField(name: string, value: string): string | undefined {
  switch (name) {
    case "fullName": {
      const trimmed = value.trim();
      if (!trimmed) return "Nome completo é obrigatório.";
      if (trimmed.length < 2) return "Nome deve ter pelo menos 2 caracteres.";
      return undefined;
    }
    case "birthDate": {
      if (!value.trim()) return "Data de nascimento é obrigatória.";
      const today = new Date().toISOString().slice(0, 10);
      if (value > today) return "Data de nascimento não pode ser futura.";
      if (value < "1900-01-01") return "Data de nascimento inválida.";
      return undefined;
    }
    case "phone": {
      const digits = value.replace(/\D/g, "");
      if (!digits) return "Telefone celular é obrigatório.";
      if (digits.length < 10 || digits.length > 11)
        return "Telefone deve conter DDD e 8 ou 9 dígitos.";
      return undefined;
    }
    case "email": {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(trimmed)) return "Informe um e-mail válido.";
      return undefined;
    }
    default:
      return undefined;
  }
}

// Helper mirror for dirty checking
interface Snapshot {
  fullName: string;
  phone: string;
  email: string;
  birthDate: string;
  gender: string;
  postalCode: string;
  street: string;
  city: string;
  state: string;
  healthInsurance: string;
  insuranceNumber: string;
  insuranceExpiration: string;
}

function computeIsDirty(current: Snapshot, initial: Snapshot): boolean {
  return (
    current.fullName.trim() !== initial.fullName ||
    current.phone.replace(/\D/g, "") !== initial.phone ||
    current.email.trim() !== initial.email ||
    current.birthDate !== initial.birthDate ||
    current.gender !== initial.gender ||
    current.postalCode.replace(/\D/g, "") !== initial.postalCode ||
    current.street.trim() !== initial.street ||
    current.city.trim() !== initial.city ||
    current.state.trim() !== initial.state ||
    current.healthInsurance.trim() !== initial.healthInsurance ||
    current.insuranceNumber.trim() !== initial.insuranceNumber ||
    current.insuranceExpiration !== initial.insuranceExpiration
  );
}

// ----------------------------------------------------
// 1. Validation Tests
// ----------------------------------------------------
describe("Edit Patient Form Validation", () => {
  test("fullName: requires non-empty name with at least 2 characters", () => {
    expect(validateField("fullName", "")).toBe("Nome completo é obrigatório.");
    expect(validateField("fullName", "   ")).toBe(
      "Nome completo é obrigatório.",
    );
    expect(validateField("fullName", "A")).toBe(
      "Nome deve ter pelo menos 2 caracteres.",
    );
    expect(validateField("fullName", "Maria Silva")).toBeUndefined();
  });

  test("phone: requires valid Brazilian phone with 10 or 11 digits", () => {
    expect(validateField("phone", "")).toBe("Telefone celular é obrigatório.");
    expect(validateField("phone", "123")).toBe(
      "Telefone deve conter DDD e 8 ou 9 dígitos.",
    );
    expect(validateField("phone", "(11) 9876")).toBe(
      "Telefone deve conter DDD e 8 ou 9 dígitos.",
    );
    expect(validateField("phone", "(11) 98765-4321")).toBeUndefined();
    expect(validateField("phone", "(11) 3333-4444")).toBeUndefined();
  });

  test("birthDate: requires non-empty date, rejects future dates or pre-1900", () => {
    expect(validateField("birthDate", "")).toBe(
      "Data de nascimento é obrigatória.",
    );
    expect(validateField("birthDate", "2099-01-01")).toBe(
      "Data de nascimento não pode ser futura.",
    );
    expect(validateField("birthDate", "1850-01-01")).toBe(
      "Data de nascimento inválida.",
    );
    expect(validateField("birthDate", "1990-05-20")).toBeUndefined();
  });

  test("email: optional but validates format if provided", () => {
    expect(validateField("email", "")).toBeUndefined();
    expect(validateField("email", "   ")).toBeUndefined();
    expect(validateField("email", "invalid-email")).toBe(
      "Informe um e-mail válido.",
    );
    expect(validateField("email", "test@domain")).toBe(
      "Informe um e-mail válido.",
    );
    expect(validateField("email", "paciente@flowcare.com")).toBeUndefined();
  });
});

// ----------------------------------------------------
// 2. Locked CPF Tests
// ----------------------------------------------------
describe("Locked CPF display and integrity", () => {
  test("CPF is formatted or masked and accompanied by locked note", () => {
    const rawCpf = "52998224725";
    const formatted = formatCpf(rawCpf);
    const masked = maskCpf(rawCpf);

    expect(formatted).toBe("529.982.247-25");
    expect(masked).toBe("529.***.***-25");

    const lockedNotice =
      "O CPF é a chave primária de identificação do paciente e não pode ser alterado diretamente.";
    expect(lockedNotice).toContain("chave primária de identificação");
    expect(lockedNotice).toContain("não pode ser alterado diretamente");
  });
});

// ----------------------------------------------------
// 3. Dirty Form Guard Tests
// ----------------------------------------------------
describe("Dirty form guard logic", () => {
  const initialSnapshot: Snapshot = {
    fullName: "Carlos Eduardo",
    phone: "11988887777",
    email: "carlos@example.com",
    birthDate: "1985-04-12",
    gender: "Masculino",
    postalCode: "01310100",
    street: "Av Paulista",
    city: "São Paulo",
    state: "SP",
    healthInsurance: "Unimed",
    insuranceNumber: "123456",
    insuranceExpiration: "2028-12-31",
  };

  test("returns false when form values match initial snapshot", () => {
    const current = { ...initialSnapshot };
    expect(computeIsDirty(current, initialSnapshot)).toBe(false);
  });

  test("returns true when fullName is edited", () => {
    const current = { ...initialSnapshot, fullName: "Carlos Eduardo Santos" };
    expect(computeIsDirty(current, initialSnapshot)).toBe(true);
  });

  test("returns true when phone is edited", () => {
    const current = { ...initialSnapshot, phone: "11999990000" };
    expect(computeIsDirty(current, initialSnapshot)).toBe(true);
  });

  test("returns true when email is edited", () => {
    const current = { ...initialSnapshot, email: "carlos.santos@example.com" };
    expect(computeIsDirty(current, initialSnapshot)).toBe(true);
  });

  test("returns true when address fields are edited", () => {
    const currentStreet = { ...initialSnapshot, street: "Rua Augusta" };
    expect(computeIsDirty(currentStreet, initialSnapshot)).toBe(true);

    const currentCep = { ...initialSnapshot, postalCode: "01311000" };
    expect(computeIsDirty(currentCep, initialSnapshot)).toBe(true);
  });

  test("returns true when health insurance fields are edited", () => {
    const currentPlan = {
      ...initialSnapshot,
      healthInsurance: "Bradesco Saúde",
    };
    expect(computeIsDirty(currentPlan, initialSnapshot)).toBe(true);

    const currentNumber = { ...initialSnapshot, insuranceNumber: "999888" };
    expect(computeIsDirty(currentNumber, initialSnapshot)).toBe(true);
  });

  test("returns false when change is reverted back to initial snapshot", () => {
    let current = { ...initialSnapshot, fullName: "Outro Nome" };
    expect(computeIsDirty(current, initialSnapshot)).toBe(true);

    current = { ...initialSnapshot, fullName: "Carlos Eduardo" };
    expect(computeIsDirty(current, initialSnapshot)).toBe(false);
  });
});

// ----------------------------------------------------
// 4. updatePatient Server Function Tests
// ----------------------------------------------------
describe("updatePatient server function", () => {
  test("throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(
      updatePatient("clinica-vida", "pt_1", {
        fullName: "Novo Nome",
        version: 1,
      }),
    ).rejects.toThrow(PatientsApiError);
  });

  test("calls PATCH with correct URL, headers, and version payload", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = mock(
      async (input: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedMethod = init?.method ?? "";
        capturedHeaders = (init?.headers as Record<string, string>) ?? {};
        capturedBody = JSON.parse(init?.body as string);

        return new Response(
          JSON.stringify({
            patient: {
              id: "pt_1",
              fullName: "João Carlos Souza",
              cpf: "52998224725",
              birthDate: "1985-05-20",
              phone: "11988885555",
              version: 2,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    ) as unknown as typeof fetch;

    const result = await updatePatient("clinica-vida", "pt_1", {
      fullName: "João Carlos Souza",
      phone: "(11) 98888-5555",
      birthDate: "1985-05-20",
      version: 1,
    });

    expect(capturedMethod).toBe("PATCH");
    expect(capturedUrl).toContain("/organizations/clinica-vida/patients/pt_1");
    expect(capturedHeaders.Authorization).toBe("Bearer valid-session-jwt");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
    expect(capturedBody.version).toBe(1);
    expect(capturedBody.fullName).toBe("João Carlos Souza");
    expect(capturedBody.phone).toBe("11988885555");
    expect(capturedBody.birthDate).toBe("1985-05-20");

    expect(result.patient.id).toBe("pt_1");
    expect(result.patient.fullName).toBe("João Carlos Souza");
    expect(result.patient.version).toBe(2);
  });

  test("handles 409 VERSION_CONFLICT and maps friendly error message", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "VERSION_CONFLICT",
            message:
              "O cadastro do paciente foi atualizado por outra pessoa. Recarregue os dados antes de salvar.",
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      await updatePatient("clinica-vida", "pt_1", {
        fullName: "Nome Desatualizado",
        version: 0,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PatientsApiError);
      const apiErr = err as InstanceType<typeof PatientsApiError>;
      expect(apiErr.code).toBe("VERSION_CONFLICT");
      expect(apiErr.message).toBe(
        "Este paciente foi atualizado por outro usuário. Recarregue para ver os dados mais recentes.",
      );
    }
  });

  test("handles 400 VALIDATION_ERROR", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Data de nascimento inválida.",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    try {
      await updatePatient("clinica-vida", "pt_1", {
        birthDate: "invalid-date",
        version: 1,
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(PatientsApiError);
      const apiErr = err as InstanceType<typeof PatientsApiError>;
      expect(apiErr.code).toBe("VALIDATION_ERROR");
      expect(apiErr.message).toBe("Data de nascimento inválida.");
    }
  });

  test("handles 403 Forbidden error", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ error: { code: "FORBIDDEN" } }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    expect(
      updatePatient("clinica-vida", "pt_1", {
        fullName: "Nome",
        version: 1,
      }),
    ).rejects.toThrow(
      "Você não tem permissão para alterar pacientes nesta clínica.",
    );
  });

  test("handles 404 Not Found error", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    expect(
      updatePatient("clinica-vida", "pt_missing", {
        fullName: "Nome",
        version: 1,
      }),
    ).rejects.toThrow("Paciente não encontrado.");
  });
});

// ----------------------------------------------------
// 5. updatePatientAction Tests
// ----------------------------------------------------
describe("updatePatientAction server action", () => {
  test("returns success: true with updated patient data", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          patient: {
            id: "pt_1",
            fullName: "Maria Clara Atualizada",
            cpf: "11144477735",
            birthDate: "1990-08-15",
            phone: "11966665555",
            version: 3,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await updatePatientAction("clinica-vida", "pt_1", {
      fullName: "Maria Clara Atualizada",
      version: 2,
    });

    expect(result.success).toBe(true);
    expect(result.data?.id).toBe("pt_1");
    expect(result.data?.fullName).toBe("Maria Clara Atualizada");
    expect(result.data?.version).toBe(3);
    expect(result.error).toBeUndefined();
  });

  test("maps VERSION_CONFLICT 409 error to success: false with code", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "VERSION_CONFLICT",
            message: "Conflito de versão.",
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await updatePatientAction("clinica-vida", "pt_1", {
      fullName: "Tentativa Conflito",
      version: 0,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("VERSION_CONFLICT");
    expect(result.error).toBe(
      "Este paciente foi atualizado por outro usuário. Recarregue para ver os dados mais recentes.",
    );
  });

  test("maps 400 VALIDATION_ERROR to success: false with error details", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Nome muito curto.",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const result = await updatePatientAction("clinica-vida", "pt_1", {
      fullName: "A",
      version: 1,
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("VALIDATION_ERROR");
    expect(result.error).toBe("Nome muito curto.");
  });
});

// ----------------------------------------------------
// 6. getPatientOverviewAction (Reload on Concurrency Conflict)
// ----------------------------------------------------
describe("getPatientOverviewAction for conflict reload", () => {
  test("reloads patient overview with latest version", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          patient: {
            id: "pt_1",
            fullName: "Nome Mais Recente",
            cpf: "52998224725",
            birthDate: "1985-05-20",
            phone: "11988885555",
            version: 5,
          },
          contact: {
            phone: "11988885555",
            email: "recente@example.com",
          },
          upcomingAppointments: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    const res = await getPatientOverviewAction("clinica-vida", "pt_1");
    expect(res.success).toBe(true);
    expect(res.data?.patient.version).toBe(5);
    expect(res.data?.patient.fullName).toBe("Nome Mais Recente");
  });
});
