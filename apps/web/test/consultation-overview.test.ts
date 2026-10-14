import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let mockToken: string | null = "valid-token";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) => (mockToken ? { value: mockToken } : undefined),
    set: () => {},
  }),
}));

const { canOpenSection } = await import("@/lib/app-navigation");
const { formatBirthDateAndAge } = await import("@/lib/patient-formatters");
const { formatDateTime, formatScheduledAt } = await import(
  "../components/flowcare/consultations/format-date"
);
const {
  ConsultationsApiError,
  consultationDetailSchema,
  getConsultationDetails,
} = await import("../server/consultations");
const { getPatientOverview, patientOverviewSchema } = await import(
  "../server/patients"
);

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test";
  mockToken = "valid-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

describe("consultation overview (#269)", () => {
  describe("Role-based access", () => {
    test("clinical access is restricted to ADMIN_PROFESSIONAL and PROFESSIONAL only", () => {
      expect(canOpenSection("PROFESSIONAL", "consultations")).toBe(true);
      expect(canOpenSection("ADMIN_PROFESSIONAL", "consultations")).toBe(true);
      expect(canOpenSection("RECEPTIONIST", "consultations")).toBe(false);
      expect(canOpenSection("ADMIN", "consultations")).toBe(false);
    });
  });

  describe("getConsultationDetails server function", () => {
    const mockConsultationId = "11111111-2222-3333-4444-555555555555";
    const validConsultationPayload = {
      id: mockConsultationId,
      consultationId: mockConsultationId,
      organizationId: "org-1",
      appointmentId: "appt-1",
      patientId: "patient-123",
      professionalId: "prof-456",
      scheduledAt: "2026-10-15T14:30:00.000Z",
      localScheduledAt: "2026-10-15T11:30:00",
      startedAt: "2026-10-15T11:35:00.000Z",
      completedAt: null,
      status: "IN_PROGRESS",
      anamnesisStatus: "PENDING",
      chiefComplaint: "Paciente com cefaleia intensa há 3 dias",
      clinicalNotes: "Sem febre relatada",
      version: 2,
      createdAt: "2026-10-15T10:00:00.000Z",
      updatedAt: "2026-10-15T11:35:00.000Z",
      patient: {
        id: "patient-123",
        fullName: "Maria Oliveira",
      },
      professional: {
        id: "prof-456",
        fullName: "Dr. Roberto Costa",
        professionalTitle: "Neurologista",
        registrationNumber: "CRM/SP 98765",
      },
    };

    test("successfully fetches and validates consultation details by id", async () => {
      let capturedUrl = "";
      let capturedAuth = "";

      globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
        capturedUrl = url.toString();
        capturedAuth = String(
          (init?.headers as Record<string, string>)?.Authorization,
        );
        return Response.json(validConsultationPayload);
      }) as unknown as typeof fetch;

      const details = await getConsultationDetails(
        "clinica-alfa",
        mockConsultationId,
      );

      expect(capturedUrl).toBe(
        `http://api.test/organizations/clinica-alfa/consultations/${mockConsultationId}`,
      );
      expect(capturedAuth).toBe("Bearer valid-token");
      expect(details.id).toBe(mockConsultationId);
      expect(details.patientId).toBe("patient-123");
      expect(details.patient?.fullName).toBe("Maria Oliveira");
      expect(details.professional?.fullName).toBe("Dr. Roberto Costa");
      expect(details.status).toBe("IN_PROGRESS");
      expect(details.anamnesisStatus).toBe("PENDING");
      expect(details.chiefComplaint).toBe(
        "Paciente com cefaleia intensa há 3 dias",
      );
    });

    test("validates consultation detail schema with Zod", () => {
      const parsed = consultationDetailSchema.safeParse(
        validConsultationPayload,
      );
      expect(parsed.success).toBe(true);

      const invalid = consultationDetailSchema.safeParse({
        id: "abc",
        status: "INVALID_STATUS",
      });
      expect(invalid.success).toBe(false);
    });

    test("throws UNAUTHENTICATED when session token is absent", async () => {
      mockToken = null;
      await expect(
        getConsultationDetails("clinica-alfa", mockConsultationId),
      ).rejects.toBeInstanceOf(ConsultationsApiError);
    });

    test("throws FORBIDDEN when user lacks permissions (403)", async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
        })) as unknown as typeof fetch;

      await expect(
        getConsultationDetails("clinica-alfa", mockConsultationId),
      ).rejects.toBeInstanceOf(ConsultationsApiError);
    });

    test("throws NOT_FOUND when consultation does not exist (404)", async () => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: "Not Found" }), {
          status: 404,
        })) as unknown as typeof fetch;

      await expect(
        getConsultationDetails("clinica-alfa", mockConsultationId),
      ).rejects.toBeInstanceOf(ConsultationsApiError);
    });

    test("throws UNAVAILABLE on server error 500 or malformed payload", async () => {
      globalThis.fetch = (async () =>
        new Response("Internal Server Error", {
          status: 500,
        })) as unknown as typeof fetch;

      await expect(
        getConsultationDetails("clinica-alfa", mockConsultationId),
      ).rejects.toMatchObject({
        code: "UNAVAILABLE",
      });

      // Malformed json response
      globalThis.fetch = (async () =>
        Response.json({ unexpected: true })) as unknown as typeof fetch;

      await expect(
        getConsultationDetails("clinica-alfa", mockConsultationId),
      ).rejects.toMatchObject({
        code: "UNAVAILABLE",
        message: "Resposta inválida do servidor de consultas.",
      });
    });
  });

  describe("getPatientOverview server function", () => {
    test("fetches and validates patient overview with clinical data", async () => {
      const mockPatientId = "patient-123";
      const payload = {
        patient: {
          id: mockPatientId,
          fullName: "Maria Oliveira",
          birthDate: "1985-04-12",
          cpf: "12345678900",
          phone: "11988887777",
          healthInsurance: "Unimed",
          insuranceNumber: "UNI-9988",
        },
        allergies: ["Penicilina", "Iodo"],
        clinicalAlerts: ["Hipertensão Arterial"],
        healthInsurance: "Unimed",
        insuranceNumber: "UNI-9988",
      };

      globalThis.fetch = (async (url: string | URL) => {
        expect(url.toString()).toContain(
          `/organizations/clinica-alfa/patients/${mockPatientId}/overview`,
        );
        return Response.json(payload);
      }) as unknown as typeof fetch;

      const res = await getPatientOverview("clinica-alfa", mockPatientId);
      expect(res).not.toBeNull();
      expect(res?.patient.fullName).toBe("Maria Oliveira");
      expect(res?.allergies).toEqual(["Penicilina", "Iodo"]);
      expect(res?.clinicalAlerts).toEqual(["Hipertensão Arterial"]);
      expect(res?.patient.healthInsurance).toBe("Unimed");
    });

    test("returns null when patient overview is not found or fails", async () => {
      globalThis.fetch = (async () =>
        new Response("Not Found", { status: 404 })) as unknown as typeof fetch;

      const res = await getPatientOverview("clinica-alfa", "unknown-patient");
      expect(res).toBeNull();
    });

    test("validates patientOverviewSchema with Zod", () => {
      const valid = {
        patient: {
          id: "p1",
          fullName: "João",
        },
        allergies: ["Dipirona"],
      };
      expect(patientOverviewSchema.safeParse(valid).success).toBe(true);
    });
  });

  describe("Formatters and helpers", () => {
    test("formatDateTime formats ISO strings properly and handles null values", () => {
      expect(formatDateTime(null)).toBe("—");
      expect(formatDateTime(undefined)).toBe("—");
      expect(formatDateTime("")).toBe("—");

      const formatted = formatDateTime("2026-10-15T14:30:00.000Z");
      expect(formatted).toContain("15/10/2026");
      expect(formatted).toContain("às");
    });

    test("formatScheduledAt formats local or UTC timestamps", () => {
      const result = formatScheduledAt(
        "2026-10-15T14:30:00.000Z",
        "2026-10-15T11:30:00",
      );
      expect(result).toBe("15/10/2026 às 11:30");
    });

    test("formatBirthDateAndAge calculates age text from birth date", () => {
      const { ageText, birthDateFormatted } =
        formatBirthDateAndAge("1990-05-20");
      expect(birthDateFormatted).toBe("20/05/1990");
      expect(ageText).toMatch(/\d+ anos/);

      const empty = formatBirthDateAndAge(null);
      expect(empty.ageText).toBe("—");
      expect(empty.birthDateFormatted).toBe("—");
    });
  });

  describe("UI state and shortcut rules", () => {
    test("shortcut button changes label based on anamnesis status", () => {
      const getShortcutText = (status: "PENDING" | "DRAFT" | "APPROVED") =>
        status === "DRAFT" ? "Continuar gravação" : "Iniciar gravação";

      expect(getShortcutText("PENDING")).toBe("Iniciar gravação");
      expect(getShortcutText("DRAFT")).toBe("Continuar gravação");
      expect(getShortcutText("APPROVED")).toBe("Iniciar gravação");
    });

    test("tab selection fallback defaults to overview", () => {
      const validTabs = ["overview", "anamnesis", "review"];
      const resolveTab = (param?: string | null) =>
        validTabs.includes(param || "") ? (param as string) : "overview";

      expect(resolveTab(null)).toBe("overview");
      expect(resolveTab("")).toBe("overview");
      expect(resolveTab("unknown")).toBe("overview");
      expect(resolveTab("overview")).toBe("overview");
      expect(resolveTab("anamnesis")).toBe("anamnesis");
      expect(resolveTab("review")).toBe("review");
    });
  });
});
