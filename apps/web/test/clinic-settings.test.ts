import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

let mockSessionToken: string | null = "valid-session-jwt";
let capturedRevalidatedPaths: string[] = [];

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
    set: () => {},
  }),
}));
mock.module("next/cache", () => ({
  revalidatePath: (path: string, _type?: string) => {
    capturedRevalidatedPaths.push(path);
  },
}));

const { canOpenSection } = await import("../lib/app-navigation");
const { formatCnpj, validCnpj } = await import("../lib/clinic-details");
const { formatPhoneWithAreaCode } = await import("../lib/phone");
const { formatPostalCode, parsePostalCodeAddress, postalCodeDigits } =
  await import("../lib/postal-code");

const {
  ALLOWED_LOGO_MIME_TYPES,
  CLINIC_LOGO_MAX_BYTES,
  OrganizationSettingsApiError,
  getOrganizationLogoUrl,
  getOrganizationSettings,
  updateOrganizationSettings,
  uploadOrganizationLogo,
  validateLogoFile,
} = await import("../server/organization-settings");

const { updateOrganizationSettingsAction, uploadOrganizationLogoAction } =
  await import("../app/app/[orgSlug]/settings/organization/actions");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
  capturedRevalidatedPaths = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

describe("Clinic Settings - Role Protection & RBAC (#307)", () => {
  test("allows only ADMIN and ADMIN_PROFESSIONAL to access settings", () => {
    expect(canOpenSection("ADMIN", "settings")).toBe(true);
    expect(canOpenSection("ADMIN_PROFESSIONAL", "settings")).toBe(true);
    expect(canOpenSection("PROFESSIONAL", "settings")).toBe(false);
    expect(canOpenSection("RECEPTIONIST", "settings")).toBe(false);
  });

  test("getOrganizationSettings throws FORBIDDEN on 403 for unauthorized users", async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: "FORBIDDEN",
            message: "Acesso restrito a administradores.",
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    expect(getOrganizationSettings("clinica-vida")).rejects.toThrow(
      "Acesso restrito a administradores da clínica.",
    );
  });

  test("updateOrganizationSettings throws FORBIDDEN on 403", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 403 });
    }) as unknown as typeof fetch;

    expect(
      updateOrganizationSettings("clinica-vida", {
        version: 1,
        name: "Novo Nome",
      }),
    ).rejects.toThrow("Acesso restrito a administradores da clínica.");
  });

  test("uploadOrganizationLogo throws FORBIDDEN on 403", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 403 });
    }) as unknown as typeof fetch;

    const formData = new FormData();
    const file = new File(["valid image bytes"], "logo.png", {
      type: "image/png",
    });
    formData.append("file", file);

    expect(uploadOrganizationLogo("clinica-vida", formData)).rejects.toThrow(
      "Acesso restrito a administradores da clínica.",
    );
  });
});

describe("Clinic Settings - Logo Validation (PNG, JPG, WebP up to 5MB) (#307)", () => {
  test("validateLogoFile accepts valid PNG, JPG, and WebP within 5MB", () => {
    expect(validateLogoFile({ size: 1024 * 1024, type: "image/png" })).toEqual({
      valid: true,
    });

    expect(
      validateLogoFile({ size: 3 * 1024 * 1024, type: "image/jpeg" }),
    ).toEqual({ valid: true });

    expect(validateLogoFile({ size: 500 * 1024, type: "image/jpg" })).toEqual({
      valid: true,
    });

    expect(
      validateLogoFile({ size: 2 * 1024 * 1024, type: "image/webp" }),
    ).toEqual({ valid: true });
  });

  test("validateLogoFile rejects files exceeding 5MB limit", () => {
    const oversized = validateLogoFile({
      size: CLINIC_LOGO_MAX_BYTES + 1,
      type: "image/png",
    });
    expect(oversized.valid).toBe(false);
    expect(oversized.error).toContain("5MB");
  });

  test("validateLogoFile rejects zero-byte empty files", () => {
    const empty = validateLogoFile({ size: 0, type: "image/png" });
    expect(empty.valid).toBe(false);
    expect(empty.error).toContain("vazio");
  });

  test("validateLogoFile rejects non-image formats (PDF, GIF, SVG, text)", () => {
    for (const badType of [
      "application/pdf",
      "image/gif",
      "image/svg+xml",
      "text/plain",
      "",
    ]) {
      const res = validateLogoFile({ size: 1024, type: badType });
      expect(res.valid).toBe(false);
      expect(res.error).toContain("inválido");
    }
  });

  test("ALLOWED_LOGO_MIME_TYPES contains PNG, JPEG, JPG, and WebP", () => {
    expect(ALLOWED_LOGO_MIME_TYPES).toContain("image/png");
    expect(ALLOWED_LOGO_MIME_TYPES).toContain("image/jpeg");
    expect(ALLOWED_LOGO_MIME_TYPES).toContain("image/webp");
  });
});

describe("Clinic Settings - Upload Logo Server Layer (#307)", () => {
  test("uploadOrganizationLogo throws VALIDATION_ERROR when no file in formData", async () => {
    const formData = new FormData();
    expect(uploadOrganizationLogo("clinica-vida", formData)).rejects.toThrow(
      "Nenhum arquivo de logotipo fornecido.",
    );
  });

  test("uploadOrganizationLogo throws PAYLOAD_TOO_LARGE on client-side check for oversized file", async () => {
    const formData = new FormData();
    const oversizedBlob = new Blob(
      [new Uint8Array(CLINIC_LOGO_MAX_BYTES + 10)],
      {
        type: "image/png",
      },
    );
    formData.append("file", oversizedBlob, "huge-logo.png");

    try {
      await uploadOrganizationLogo("clinica-vida", formData);
      expect().fail("Should have thrown PAYLOAD_TOO_LARGE");
    } catch (err) {
      expect(err).toBeInstanceOf(OrganizationSettingsApiError);
      expect((err as OrganizationSettingsApiError).code).toBe(
        "PAYLOAD_TOO_LARGE",
      );
    }
  });

  test("uploadOrganizationLogo sends POST to upstream API and resolves logoUrl", async () => {
    const capturedCalls: { url: string; method: string }[] = [];

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedCalls.push({ url, method: init?.method ?? "GET" });
      if (url.includes("/download-url")) {
        return Response.json({
          downloadUrl: "https://storage.test/logo-cdn.png",
          expiresInSeconds: 3600,
        });
      }
      return Response.json({
        id: "org-1",
        name: "Clínica Vida",
        slug: "clinica-vida",
        version: 2,
        completed: true,
        legalName: "Clínica Vida Ltda",
        taxId: "12345678000195",
        contactEmail: "contato@vidaclinica.com",
        contactPhone: "11999998888",
        postalCode: "01310100",
        state: "SP",
        city: "São Paulo",
        district: "Bela Vista",
        street: "Av. Paulista",
        streetNumber: "1000",
        addressComplement: "Conjunto 10",
        logo: {
          contentType: "image/png",
          sizeBytes: 1024,
          updatedAt: "2026-10-17T12:00:00Z",
        },
      });
    }) as unknown as typeof fetch;

    const formData = new FormData();
    formData.append(
      "file",
      new File(["test image bytes"], "logo.png", { type: "image/png" }),
    );

    const result = await uploadOrganizationLogo("clinica-vida", formData);
    const postCall = capturedCalls.find((call) => call.method === "POST");
    expect(postCall).toBeDefined();
    expect(postCall?.url).toContain(
      "/organizations/clinica-vida/settings/logo",
    );
    expect(
      capturedCalls.some((call) => call.url.includes("/download-url")),
    ).toBe(true);
    expect(result.success).toBe(true);
    expect(result.logoUrl).toBe("https://storage.test/logo-cdn.png");
    expect(result.settings?.version).toBe(2);
  });

  test("uploadOrganizationLogo handles upstream 413 Payload Too Large", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 413 });
    }) as unknown as typeof fetch;

    const formData = new FormData();
    formData.append(
      "file",
      new File(["bytes"], "logo.png", { type: "image/png" }),
    );

    try {
      await uploadOrganizationLogo("clinica-vida", formData);
      expect().fail("Should have thrown PAYLOAD_TOO_LARGE");
    } catch (err) {
      expect((err as OrganizationSettingsApiError).code).toBe(
        "PAYLOAD_TOO_LARGE",
      );
    }
  });

  test("uploadOrganizationLogo handles upstream 503 Storage Unavailable", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 503 });
    }) as unknown as typeof fetch;

    const formData = new FormData();
    formData.append(
      "file",
      new File(["bytes"], "logo.png", { type: "image/png" }),
    );

    try {
      await uploadOrganizationLogo("clinica-vida", formData);
      expect().fail("Should have thrown STORAGE_UNAVAILABLE");
    } catch (err) {
      expect((err as OrganizationSettingsApiError).code).toBe(
        "STORAGE_UNAVAILABLE",
      );
    }
  });
});

describe("Clinic Settings - Address & ViaCEP Auto-Fill (#307)", () => {
  test("postalCodeDigits sanitizes nondigits and restricts length to 8", () => {
    expect(postalCodeDigits("01310-100")).toBe("01310100");
    expect(postalCodeDigits("01.310-100 ext 45")).toBe("01310100");
    expect(postalCodeDigits("123")).toBe("123");
    expect(postalCodeDigits("")).toBe("");
  });

  test("formatPostalCode formats valid 8-digit CEP with hyphen", () => {
    expect(formatPostalCode("01310100")).toBe("01310-100");
    expect(formatPostalCode("01310-100")).toBe("01310-100");
    expect(formatPostalCode("0131")).toBe("0131");
  });

  test("parsePostalCodeAddress parses ViaCEP response successfully", () => {
    const viaCepData = {
      uf: "SP",
      localidade: "São Paulo",
      bairro: "Bela Vista",
      logradouro: "Avenida Paulista",
    };
    const parsed = parsePostalCodeAddress(viaCepData);
    expect(parsed).toEqual({
      state: "SP",
      city: "São Paulo",
      district: "Bela Vista",
      street: "Avenida Paulista",
    });
  });

  test("parsePostalCodeAddress returns null for ViaCEP error response", () => {
    expect(parsePostalCodeAddress({ erro: true })).toBeNull();
    expect(parsePostalCodeAddress({})).toBeNull();
    expect(parsePostalCodeAddress(null)).toBeNull();
  });
});

describe("Clinic Settings - Update Settings & Revalidation (#307)", () => {
  test("getOrganizationSettings fetches settings and enriches with logoUrl", async () => {
    let capturedUrl = "";
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      if (url.includes("/download-url")) {
        return Response.json({
          downloadUrl: "https://storage.test/logo-active.png",
          expiresInSeconds: 3600,
        });
      }
      return Response.json({
        id: "org-1",
        name: "Clínica Saúde",
        slug: "clinica-saude",
        version: 1,
        completed: true,
        legalName: "Saúde Médica Ltda",
        taxId: "12345678000195",
        contactEmail: "contato@saude.med.br",
        contactPhone: "85988887777",
        postalCode: "60160230",
        state: "CE",
        city: "Fortaleza",
        district: "Aldeota",
        street: "Av. Santos Dumont",
        streetNumber: "1500",
        addressComplement: "Sala 204",
        logo: {
          contentType: "image/png",
          sizeBytes: 2048,
          updatedAt: "2026-10-17T10:00:00Z",
        },
      });
    }) as unknown as typeof fetch;

    const settings = await getOrganizationSettings("clinica-saude");
    expect(capturedUrl).toContain("/organizations/clinica-saude");
    expect(settings.name).toBe("Clínica Saúde");
    expect(settings.logoUrl).toBe("https://storage.test/logo-active.png");
    expect(settings.city).toBe("Fortaleza");
    expect(settings.state).toBe("CE");
  });

  test("updateOrganizationSettings sends PATCH with version and payload", async () => {
    let capturedMethod = "";
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedMethod = init?.method ?? "GET";
      capturedBody = JSON.parse((init?.body as string) || "{}");
      return Response.json({
        id: "org-1",
        name: "Clínica Vida Nova",
        slug: "clinica-vida",
        version: 2,
        completed: true,
        legalName: "Clínica Vida Nova Ltda",
        taxId: "12345678000195",
        contactEmail: "contato@vidanova.com",
        contactPhone: "11988889999",
        postalCode: "01310100",
        state: "SP",
        city: "São Paulo",
        district: "Bela Vista",
        street: "Av. Paulista",
        streetNumber: "2000",
        addressComplement: "",
        logo: null,
      });
    }) as unknown as typeof fetch;

    const updated = await updateOrganizationSettings("clinica-vida", {
      version: 1,
      name: "Clínica Vida Nova",
      streetNumber: "2000",
    });

    expect(capturedMethod).toBe("PATCH");
    expect(capturedBody.name).toBe("Clínica Vida Nova");
    expect(capturedBody.version).toBe(1);
    expect(updated.version).toBe(2);
    expect(updated.name).toBe("Clínica Vida Nova");
  });

  test("updateOrganizationSettings handles concurrency conflict (409)", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 409 });
    }) as unknown as typeof fetch;

    try {
      await updateOrganizationSettings("clinica-vida", {
        version: 1,
        name: "Clínica Outdated",
      });
      expect().fail("Should have thrown CONFLICT");
    } catch (err) {
      expect(err).toBeInstanceOf(OrganizationSettingsApiError);
      expect((err as OrganizationSettingsApiError).code).toBe("CONFLICT");
      expect((err as OrganizationSettingsApiError).message).toContain(
        "outra sessão",
      );
    }
  });

  test("updateOrganizationSettingsAction revalidates organization layout and headers", async () => {
    globalThis.fetch = (async () => {
      return Response.json({
        id: "org-1",
        name: "Clínica Atualizada",
        slug: "clinica-vida",
        version: 3,
        completed: true,
        legalName: "Clínica Atualizada Ltda",
        taxId: "12345678000195",
        contactEmail: "contato@atualizada.com",
        contactPhone: "11999998888",
        postalCode: "01310100",
        state: "SP",
        city: "São Paulo",
        district: "Bela Vista",
        street: "Av. Paulista",
        streetNumber: "1000",
        addressComplement: "",
        logo: null,
      });
    }) as unknown as typeof fetch;

    const res = await updateOrganizationSettingsAction("clinica-vida", {
      version: 2,
      name: "Clínica Atualizada",
    });

    expect(res.success).toBe(true);
    expect(capturedRevalidatedPaths).toContain("/app/clinica-vida");
    expect(capturedRevalidatedPaths).toContain(
      "/app/clinica-vida/settings/organization",
    );
  });

  test("uploadOrganizationLogoAction revalidates organization layout", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/download-url")) {
        return Response.json({
          downloadUrl: "https://storage.test/new-logo.png",
          expiresInSeconds: 3600,
        });
      }
      return Response.json({
        id: "org-1",
        name: "Clínica Vida",
        slug: "clinica-vida",
        version: 2,
        completed: true,
        legalName: "Vida Ltda",
        taxId: "12345678000195",
        contactEmail: "contato@vida.com",
        contactPhone: "11999998888",
        postalCode: "01310100",
        state: "SP",
        city: "São Paulo",
        district: "Bela Vista",
        street: "Av. Paulista",
        streetNumber: "1000",
        addressComplement: "",
        logo: {
          contentType: "image/png",
          sizeBytes: 4096,
          updatedAt: "2026-10-17T12:00:00Z",
        },
      });
    }) as unknown as typeof fetch;

    const formData = new FormData();
    formData.append(
      "file",
      new File(["image content"], "new-logo.png", { type: "image/png" }),
    );

    const res = await uploadOrganizationLogoAction("clinica-vida", formData);
    expect(res.success).toBe(true);
    expect(res.data?.logoUrl).toBe("https://storage.test/new-logo.png");
    expect(capturedRevalidatedPaths).toContain("/app/clinica-vida");
    expect(capturedRevalidatedPaths).toContain(
      "/app/clinica-vida/settings/organization",
    );
  });
});

describe("Clinic Settings - Error Mappings (#307)", () => {
  test("throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;

    expect(getOrganizationSettings("clinica-vida")).rejects.toThrow(
      "Entre novamente para continuar.",
    );
    expect(
      updateOrganizationSettings("clinica-vida", { version: 1 }),
    ).rejects.toThrow("Entre novamente para continuar.");
    expect(
      uploadOrganizationLogo("clinica-vida", new FormData()),
    ).rejects.toThrow("Entre novamente para continuar.");
  });

  test("handles 404 NOT_FOUND error", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    expect(getOrganizationSettings("clinica-fantasma")).rejects.toThrow(
      "Clínica não encontrada.",
    );
    expect(
      updateOrganizationSettings("clinica-fantasma", { version: 1 }),
    ).rejects.toThrow("Clínica não encontrada.");
  });

  test("handles network fetch failure with UNAVAILABLE error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Network offline");
    }) as unknown as typeof fetch;

    expect(getOrganizationSettings("clinica-vida")).rejects.toThrow(
      OrganizationSettingsApiError,
    );
  });

  test("getOrganizationLogoUrl returns null gracefully when logo not found or request fails", async () => {
    globalThis.fetch = (async () => {
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    const url = await getOrganizationLogoUrl("clinica-vida");
    expect(url).toBeNull();
  });
});

describe("Clinic Settings - Formatters & Input Validation (#307)", () => {
  test("formatCnpj formats 14 digits with dots, slash, and hyphen", () => {
    expect(formatCnpj("12345678000195")).toBe("12.345.678/0001-95");
    expect(formatCnpj("12.345.678/0001-95")).toBe("12.345.678/0001-95");
    expect(formatCnpj("")).toBe("");
  });

  test("validCnpj validates valid CNPJ checksum and rejects invalid ones", () => {
    // Valid Brazilian CNPJs
    expect(validCnpj("12.345.678/0001-95")).toBe(true);
    expect(validCnpj("00.000.000/0001-91")).toBe(true);
    expect(validCnpj("")).toBe(true); // Empty is handled by required check if needed

    // Invalid CNPJs (bad check digits or repeated digits)
    expect(validCnpj("11.111.111/1111-11")).toBe(false);
    expect(validCnpj("12.345.678/0001-00")).toBe(false);
    expect(validCnpj("123")).toBe(false);
  });

  test("formatPhoneWithAreaCode formats 10 and 11 digit phones", () => {
    expect(formatPhoneWithAreaCode("11999998888")).toBe("(11) 99999-8888");
    expect(formatPhoneWithAreaCode("8533334444")).toBe("(85) 3333-4444");
    expect(formatPhoneWithAreaCode("(11) 99999-8888")).toBe("(11) 99999-8888");
  });
});
