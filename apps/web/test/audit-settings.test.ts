import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("server-only", () => ({}));

let mockSessionToken: string | null = "valid-session-jwt";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
  }),
}));

mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

const mockPush = mock(() => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockPush }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const { getAuditLogs, AuditApiError } = await import("../server/audit");

const {
  maskIpAddress,
  extractMaskedIp,
  formatAuditDate,
  getAuditCategory,
  formatAuditAction,
  formatAuditTarget,
  formatAuditActor,
  isSensitiveKey,
  maskTaxIdValue,
  sanitizeMetadataForDisplay,
  matchesAuditFilter,
  AUDIT_CATEGORIES,
} = await import("../lib/audit");

const { AuditLogsView } = await import(
  "../app/app/[orgSlug]/settings/audit/audit-logs-view"
);

const {
  AuditSettingsForbidden,
  AuditSettingsError,
  default: AuditSettingsPage,
} = await import("../app/app/[orgSlug]/settings/audit/page");

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
  mockPush.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

const sampleAuditEvents = [
  {
    id: "log-1",
    organizationId: "org-1",
    actorUserId: "admin-1",
    actorName: "Dr. Carlos Administrador",
    actorUser: {
      id: "admin-1",
      fullName: "Dr. Carlos Administrador",
      email: "carlos@clinica.com",
    },
    action: "PATIENT_VIEWED",
    targetType: "PATIENT",
    targetId: "pat-101",
    metadata: {
      ip: "192.168.1.50",
      patientName: "Maria Souza",
      section: "ANAMNESIS",
    },
    createdAt: "2026-10-17T15:45:00.000Z",
  },
  {
    id: "log-2",
    organizationId: "org-1",
    actorUserId: "prof-1",
    actorName: "Dra. Renata Médica",
    actorUser: {
      id: "prof-1",
      fullName: "Dra. Renata Médica",
      email: "renata@clinica.com",
    },
    action: "DOCUMENT_ISSUED",
    targetType: "DOCUMENT",
    targetId: "doc-202",
    metadata: {
      clientIp: "209.126.11.124",
      documentType: "PRESCRIPTION",
      version: 1,
    },
    createdAt: "2026-10-17T14:30:00.000Z",
  },
  {
    id: "log-3",
    organizationId: "org-1",
    actorUserId: "admin-1",
    actorName: "Dr. Carlos Administrador",
    actorUser: {
      id: "admin-1",
      fullName: "Dr. Carlos Administrador",
      email: "carlos@clinica.com",
    },
    action: "MEMBER_ROLE_UPDATED",
    targetType: "MEMBERSHIP",
    targetId: "mem-303",
    metadata: {
      ip: "200.180.10.5",
      previousRole: "PROFESSIONAL",
      newRole: "ADMIN_PROFESSIONAL",
    },
    createdAt: "2026-10-16T10:00:00.000Z",
  },
  {
    id: "log-4",
    organizationId: "org-1",
    actorUserId: "system",
    actorName: null,
    actorUser: null,
    action: "AUTH_LOGIN_SUCCEEDED",
    targetType: "SESSION",
    targetId: "sess-404",
    metadata: {
      ip: "127.0.0.1",
    },
    createdAt: "2026-10-15T08:00:00.000Z",
  },
  {
    id: "log-5",
    organizationId: "org-1",
    actorUserId: "admin-1",
    actorName: "Dr. Carlos Administrador",
    actorUser: {
      id: "admin-1",
      fullName: "Dr. Carlos Administrador",
      email: "carlos@clinica.com",
    },
    action: "WEEKLY_SCHEDULE_UPDATED",
    targetType: "ORGANIZATION",
    targetId: "org-1",
    metadata: {
      timezone: "America/Sao_Paulo",
      ruleCount: 5,
    },
    createdAt: "2026-10-14T09:00:00.000Z",
  },
];

describe("Clinic Audit Logs - Server Layer (#329)", () => {
  test("getAuditLogs throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(getAuditLogs("clinica-vida")).rejects.toThrow(AuditApiError);
  });

  test("getAuditLogs calls GET /organizations/:orgSlug/audit-logs with bearer token and query params", async () => {
    let capturedUrl = "";
    let capturedAuth = "";

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedAuth =
        (init?.headers as Record<string, string>)?.Authorization ?? "";
      return Response.json({
        data: sampleAuditEvents,
        pagination: {
          page: 1,
          limit: 20,
          totalCount: 5,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      });
    }) as unknown as typeof fetch;

    const result = await getAuditLogs("clinica-vida", {
      action: "PATIENT_VIEWED",
      actorUserId: "admin-1",
      startDate: "2026-10-01",
      endDate: "2026-10-17",
      page: 1,
      limit: 20,
    });

    expect(capturedUrl).toContain("/organizations/clinica-vida/audit-logs");
    expect(capturedUrl).toContain("action=PATIENT_VIEWED");
    expect(capturedUrl).toContain("actorUserId=admin-1");
    expect(capturedUrl).toContain("startDate=2026-10-01");
    expect(capturedUrl).toContain("endDate=2026-10-17");
    expect(capturedAuth).toBe("Bearer valid-session-jwt");
    expect(result.data).toHaveLength(5);
    expect(result.pagination?.totalCount).toBe(5);
  });

  test("getAuditLogs handles 403 Forbidden properly", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Acesso restrito a administradores da clínica.",
          },
        },
        { status: 403 },
      );
    }) as unknown as typeof fetch;

    await expect(getAuditLogs("clinica-vida")).rejects.toThrow(
      "Acesso restrito",
    );
  });

  test("getAuditLogs handles 400 Validation Error properly", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Intervalo de consulta não pode exceder 90 dias.",
          },
        },
        { status: 400 },
      );
    }) as unknown as typeof fetch;

    await expect(getAuditLogs("clinica-vida")).rejects.toThrow(
      "Intervalo de consulta",
    );
  });

  test("getAuditLogs handles network failure with UNAVAILABLE", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Network timeout");
    }) as unknown as typeof fetch;

    await expect(getAuditLogs("clinica-vida")).rejects.toThrow(AuditApiError);
  });
});

describe("Privacy & LGPD Compliance: IP Masking & Sensitive Data Protection (#329)", () => {
  test("maskIpAddress masks IPv4 addresses (replaces last 2 octets with ***.***)", () => {
    expect(maskIpAddress("192.168.1.50")).toBe("192.168.***.***");
    expect(maskIpAddress("209.126.11.124")).toBe("209.126.***.***");
    expect(maskIpAddress("200.180.10.5")).toBe("200.180.***.***");
    expect(maskIpAddress("10.0.0.1")).toBe("10.0.***.***");
  });

  test("maskIpAddress masks IPv6 addresses and localhost", () => {
    expect(maskIpAddress("::1")).toBe("::***");
    expect(maskIpAddress("2001:0db8:85a3:0000:0000:8a2e:0370:7334")).toBe(
      "2001:0db8:***:***",
    );
    expect(maskIpAddress("::ffff:192.168.1.100")).toBe("192.168.***.***");
  });

  test("maskIpAddress safely handles empty, null or undefined values", () => {
    expect(maskIpAddress(null)).toBe("—");
    expect(maskIpAddress(undefined)).toBe("—");
    expect(maskIpAddress("")).toBe("—");
    expect(maskIpAddress("   ")).toBe("—");
  });

  test("extractMaskedIp retrieves and masks IP from metadata object", () => {
    expect(extractMaskedIp({ ip: "192.168.10.20" })).toBe("192.168.***.***");
    expect(extractMaskedIp({ clientIp: "209.126.11.124" })).toBe(
      "209.126.***.***",
    );
    expect(extractMaskedIp({ ipAddress: "200.180.10.5" })).toBe(
      "200.180.***.***",
    );
    expect(extractMaskedIp({})).toBe("—");
    expect(extractMaskedIp(null)).toBe("—");
  });

  test("isSensitiveKey identifies passwords, tokens, API keys, credentials, CVV, and secrets", () => {
    expect(isSensitiveKey("password")).toBe(true);
    expect(isSensitiveKey("user_password")).toBe(true);
    expect(isSensitiveKey("token")).toBe(true);
    expect(isSensitiveKey("accessToken")).toBe(true);
    expect(isSensitiveKey("apiKey")).toBe(true);
    expect(isSensitiveKey("api_key")).toBe(true);
    expect(isSensitiveKey("secretKey")).toBe(true);
    expect(isSensitiveKey("clientSecret")).toBe(true);
    expect(isSensitiveKey("credential")).toBe(true);
    expect(isSensitiveKey("creditCard")).toBe(true);
    expect(isSensitiveKey("cardNumber")).toBe(true);
    expect(isSensitiveKey("cvv")).toBe(true);
    expect(isSensitiveKey("cvc")).toBe(true);
    expect(isSensitiveKey("salt")).toBe(true);
    expect(isSensitiveKey("hash")).toBe(true);
    expect(isSensitiveKey("fullTaxId")).toBe(true);

    // Non-sensitive keys
    expect(isSensitiveKey("patientName")).toBe(false);
    expect(isSensitiveKey("documentType")).toBe(false);
    expect(isSensitiveKey("timezone")).toBe(false);
    expect(isSensitiveKey("ruleCount")).toBe(false);
  });

  test("maskTaxIdValue properly masks CPF and CNPJ", () => {
    expect(maskTaxIdValue("123.456.789-00")).toBe("***.***.789-**");
    expect(maskTaxIdValue("11.222.333/0001-81")).toBe("**.***.***/0001-**");
  });

  test("sanitizeMetadataForDisplay completely strips sensitive keys and masks taxId/IP", () => {
    const rawMetadata = {
      password: "dummy-password",
      token: "dummy-token",
      apiKey: "dummy-api-key",
      creditCard: "dummy-credit-card",
      cvv: "000",
      fullTaxId: "123.456.789-00",
      cpf: "123.456.789-00",
      ip: "192.168.1.1",
      patientName: "João Silva",
      documentType: "PRESCRIPTION",
      nested: {
        secretToken: "dummy-secret-token",
        allowedField: "safe-value",
      },
    };

    const sanitized = sanitizeMetadataForDisplay(rawMetadata);
    const keys = sanitized.map((item) => item.key);

    // Sensitive keys must NEVER appear
    expect(keys).not.toContain("password");
    expect(keys).not.toContain("token");
    expect(keys).not.toContain("apiKey");
    expect(keys).not.toContain("creditCard");
    expect(keys).not.toContain("cvv");
    expect(keys).not.toContain("fullTaxId");

    // Masked CPF & IP
    const cpfItem = sanitized.find((i) => i.key === "cpf");
    expect(cpfItem?.value).toBe("***.***.789-**");

    const ipItem = sanitized.find((i) => i.key === "ip");
    expect(ipItem?.value).toBe("192.168.***.***");

    // Safe fields preserved
    const patientItem = sanitized.find((i) => i.key === "patientName");
    expect(patientItem?.value).toBe("João Silva");

    // Nested secret stripped
    const nestedItem = sanitized.find((i) => i.key === "nested");
    expect(nestedItem?.value).not.toContain("dummy-secret-token");
    expect(nestedItem?.value).toContain("safe-value");
  });
});

describe("Formatters and Categorization (#329)", () => {
  test("formatAuditDate formats date in pt-BR timezone America/Sao_Paulo (DD/MM/YYYY às HH:mm)", () => {
    const formatted = formatAuditDate(
      "2026-10-17T15:45:00.000Z",
      "America/Sao_Paulo",
    );
    expect(formatted).toContain("17/10/2026");
    expect(formatted).toContain("às 12:45");
  });

  test("getAuditCategory correctly maps actions to 5 LGPD categories", () => {
    expect(getAuditCategory("AUTH_LOGIN_SUCCEEDED").label).toBe("Autenticação");
    expect(getAuditCategory("SESSION_REVOKED").label).toBe("Autenticação");
    expect(getAuditCategory("PATIENT_CREATED").label).toBe("Prontuário");
    expect(getAuditCategory("PATIENT_VIEWED").label).toBe("Prontuário");
    expect(getAuditCategory("APPOINTMENT_CREATED").label).toBe("Prontuário");
    expect(getAuditCategory("DOCUMENT_ISSUED").label).toBe("Documento");
    expect(getAuditCategory("TEMPLATE_CREATED").label).toBe("Documento");
    expect(getAuditCategory("TEAM_INVITE_CREATED").label).toBe("Equipe");
    expect(getAuditCategory("MEMBER_ROLE_UPDATED").label).toBe("Equipe");
    expect(getAuditCategory("WEEKLY_SCHEDULE_UPDATED").label).toBe(
      "Configurações",
    );
    expect(getAuditCategory("ORGANIZATION_UPDATED").label).toBe(
      "Configurações",
    );
  });

  test("formatAuditAction provides human-friendly Portuguese labels", () => {
    expect(formatAuditAction("PATIENT_VIEWED")).toBe("Visualizou prontuário");
    expect(formatAuditAction("DOCUMENT_ISSUED")).toBe(
      "Emitiu documento clínico",
    );
    expect(formatAuditAction("MEMBER_ROLE_UPDATED")).toBe(
      "Alterou papel de membro",
    );
    expect(formatAuditAction("AUTH_LOGIN_SUCCEEDED")).toBe(
      "Login realizado com sucesso",
    );
    expect(formatAuditAction("CUSTOM_ACTION_EVENT")).toBe(
      "Custom action event",
    );
  });

  test("formatAuditTarget formats resource labels accurately", () => {
    expect(formatAuditTarget("PATIENT", "123")).toBe("Paciente #123");
    expect(formatAuditTarget("PATIENT", "123", { patientName: "Maria" })).toBe(
      "Paciente: Maria (#123)",
    );
    expect(
      formatAuditTarget("DOCUMENT", "456", { documentType: "RECEITA" }),
    ).toBe("Documento (RECEITA) #456");
    expect(formatAuditTarget("ORGANIZATION", "org-1")).toBe("Clínica");
  });

  test("formatAuditActor resolves user names, emails and system", () => {
    expect(
      formatAuditActor("admin-1", {
        fullName: "Dr. Carlos",
        email: "carlos@clinica.com",
      }),
    ).toEqual({ label: "Dr. Carlos", email: "carlos@clinica.com" });

    expect(formatAuditActor("system", null, null)).toEqual({
      label: "Sistema",
    });
  });

  test("AUDIT_CATEGORIES includes 'Todas' and all 5 specific categories", () => {
    const ids = AUDIT_CATEGORIES.map((c) => c.id);
    expect(ids).toEqual([
      "all",
      "auth",
      "records",
      "documents",
      "team",
      "settings",
    ]);
  });
});

describe("Client View Filtering and Immutability (#329)", () => {
  test("matchesAuditFilter filters by category", () => {
    const authEvent = sampleAuditEvents[3];
    const patientEvent = sampleAuditEvents[0];

    expect(matchesAuditFilter(authEvent, { category: "auth" })).toBe(true);
    expect(matchesAuditFilter(authEvent, { category: "records" })).toBe(false);
    expect(matchesAuditFilter(patientEvent, { category: "records" })).toBe(
      true,
    );
    expect(matchesAuditFilter(patientEvent, { category: "all" })).toBe(true);
  });

  test("matchesAuditFilter filters by action query string", () => {
    const patientEvent = sampleAuditEvents[0];
    expect(matchesAuditFilter(patientEvent, { action: "prontuário" })).toBe(
      true,
    );
    expect(matchesAuditFilter(patientEvent, { action: "PATIENT" })).toBe(true);
    expect(matchesAuditFilter(patientEvent, { action: "receita" })).toBe(false);
  });

  test("matchesAuditFilter filters by actor query string", () => {
    const carlosEvent = sampleAuditEvents[0];
    expect(matchesAuditFilter(carlosEvent, { actor: "Carlos" })).toBe(true);
    expect(
      matchesAuditFilter(carlosEvent, { actor: "carlos@clinica.com" }),
    ).toBe(true);
    expect(matchesAuditFilter(carlosEvent, { actor: "Renata" })).toBe(false);
  });

  test("AuditLogsView renders table headers, events, masked IPs, and categories", () => {
    const html = renderToStaticMarkup(
      createElement(AuditLogsView, {
        orgSlug: "clinica-vida",
        initialEvents: sampleAuditEvents,
        pagination: {
          page: 1,
          limit: 20,
          totalCount: 5,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
        currentFilters: {},
      }),
    );

    // Title and LGPD badge
    expect(html).toContain("Trilha de Auditoria");
    expect(html).toContain("Trilha Imutável (LGPD)");

    // Column headers
    expect(html).toContain("Data e Hora");
    expect(html).toContain("Categoria");
    expect(html).toContain("Ação Realizada");
    expect(html).toContain("Recurso / Alvo");
    expect(html).toContain("Autor (Usuário)");
    expect(html).toContain("IP Mascarado");

    // Masked IP addresses rendered
    expect(html).toContain("192.168.***.***");
    expect(html).toContain("209.126.***.***");
    expect(html).toContain("200.180.***.***");

    // Category badges
    expect(html).toContain("Prontuário");
    expect(html).toContain("Documento");
    expect(html).toContain("Equipe");
    expect(html).toContain("Autenticação");
    expect(html).toContain("Configurações");

    // Friendly action names
    expect(html).toContain("Visualizou prontuário");
    expect(html).toContain("Emitiu documento clínico");
    expect(html).toContain("Alterou papel de membro");
  });

  test("AuditLogsView enforces strictly immutable trail: NO edit, update, or delete buttons", () => {
    const html = renderToStaticMarkup(
      createElement(AuditLogsView, {
        orgSlug: "clinica-vida",
        initialEvents: sampleAuditEvents,
        currentFilters: {},
      }),
    );

    expect(html).not.toContain("Editar");
    expect(html).not.toContain("Excluir");
    expect(html).not.toContain("Remover");
    expect(html).not.toContain("Atualizar");
    expect(html).not.toContain("Delete");
    expect(html).not.toContain("Edit");
  });

  test("AuditLogsView renders clean empty state when no events exist in period", () => {
    const html = renderToStaticMarkup(
      createElement(AuditLogsView, {
        orgSlug: "clinica-vida",
        initialEvents: [],
        currentFilters: {
          startDate: "2026-01-01",
          endDate: "2026-01-02",
        },
      }),
    );

    expect(html).toContain("Nenhum evento registrado no período");
    expect(html).toContain("Limpar filtros");
  });
});

describe("Page Layer & Role Protection (#329)", () => {
  test("AuditSettingsForbidden renders 403 message for non-admin roles", () => {
    const html = renderToStaticMarkup(
      createElement(AuditSettingsForbidden, {
        orgSlug: "clinica-vida",
      }),
    );

    expect(html).toContain("403 — Acesso Restrito");
    expect(html).toContain("Acesso restrito a administradores da clínica");
    expect(html).toContain("Voltar ao Dashboard");
  });

  test("AuditSettingsError renders error state with retry button", () => {
    const html = renderToStaticMarkup(
      createElement(AuditSettingsError, {
        orgSlug: "clinica-vida",
        errorMessage: "Falha de conexão com a API",
      }),
    );

    expect(html).toContain("Não foi possível carregar a trilha de auditoria");
    expect(html).toContain("Falha de conexão com a API");
    expect(html).toContain("Tentar novamente");
  });

  test("AuditSettingsPage blocks unauthorized roles (PROFESSIONAL / RECEPTIONIST)", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/organizations") || url.includes("/organizations?")) {
        return Response.json({
          data: [
            {
              id: "org-1",
              name: "Clínica Vida",
              slug: "clinica-vida",
              role: "PROFESSIONAL", // Non-admin role
            },
          ],
        });
      }
      return Response.json({});
    }) as unknown as typeof fetch;

    const pageElement = await AuditSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-vida" }),
    });

    const html = renderToStaticMarkup(pageElement);
    expect(html).toContain("403 — Acesso Restrito");
    expect(html).toContain("Acesso restrito a administradores da clínica");
  });

  test("AuditSettingsPage allows ADMIN and ADMIN_PROFESSIONAL roles", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith("/organizations") || url.includes("/organizations?")) {
        return Response.json({
          data: [
            {
              id: "org-1",
              name: "Clínica Vida",
              slug: "clinica-vida",
              role: "ADMIN_PROFESSIONAL", // Admin role
            },
          ],
        });
      }
      if (url.includes("/audit-logs")) {
        return Response.json({
          data: sampleAuditEvents,
          pagination: {
            page: 1,
            limit: 20,
            totalCount: 5,
            totalPages: 1,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        });
      }
      return Response.json({});
    }) as unknown as typeof fetch;

    const pageElement = await AuditSettingsPage({
      params: Promise.resolve({ orgSlug: "clinica-vida" }),
    });

    const html = renderToStaticMarkup(pageElement);
    expect(html).toContain("Trilha de Auditoria");
    expect(html).toContain("Trilha Imutável (LGPD)");
    expect(html).not.toContain("403 — Acesso Restrito");
  });
});
