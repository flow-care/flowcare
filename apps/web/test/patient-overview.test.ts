import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { isClinicalRole } from "@/lib/app-navigation";
import { formatBirthDateAndAge, maskCpf } from "@/lib/patient-formatters";
import { formatPhoneWithAreaCode } from "@/lib/phone";
import { formatPostalCode } from "@/lib/postal-code";

let mockSessionToken: string | null = "valid-session-jwt";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
  }),
}));

const {
  getPatientOverview,
  getPatientTimeline,
  getPatientAttachments,
  PatientsApiError,
} = await import("../server/patients");

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

describe("Patient Overview Server Layer (#257)", () => {
  test("getPatientOverview throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(getPatientOverview("clinica-vida", "pat-1")).rejects.toThrow(
      PatientsApiError,
    );
  });

  test("getPatientOverview calls GET /organizations/:orgSlug/patients/:patientId and enriches overview", async () => {
    const urlsCalled: string[] = [];
    let authHeader = "";

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      urlsCalled.push(url);
      authHeader =
        (init?.headers as Record<string, string>)?.Authorization ?? "";

      if (url.includes("/patients/pat-1/overview")) {
        return Response.json({
          patient: {
            id: "pat-1",
            fullName: "Carlos Eduardo Mendes",
            cpf: "12345678909",
            birthDate: "1985-05-20",
            phone: "11988887777",
            email: "carlos@exemplo.com",
            healthInsurance: "Unimed Nacional",
            insuranceNumber: "UNI-998877",
            version: 1,
          },
          contact: {
            phone: "11988887777",
            email: "carlos@exemplo.com",
          },
          activeInsurance: {
            name: "Unimed Nacional",
            number: "UNI-998877",
            expiration: "2027-12-31",
          },
          upcomingAppointments: [
            {
              id: "appt-1",
              scheduledAt: "2026-11-01T10:00:00.000Z",
              status: "CONFIRMED",
              professionalName: "Dra. Beatriz Santos",
              durationMinutes: 30,
            },
          ],
          allergies: ["Dipirona", "Penicilina"],
          comorbidities: ["Hipertensão arterial", "Diabetes tipo 2"],
          clinicalAlerts: ["Risco elevado de sangramento"],
          medicalNotes: "Uso contínuo de anticoagulante oral.",
        });
      }

      if (url.includes("/patients/pat-1")) {
        return Response.json({
          patient: {
            id: "pat-1",
            fullName: "Carlos Eduardo Mendes",
            cpf: "12345678909",
            birthDate: "1985-05-20",
            phone: "11988887777",
            email: "carlos@exemplo.com",
            healthInsurance: "Unimed Nacional",
            insuranceNumber: "UNI-998877",
            insuranceExpiration: "2027-12-31",
            address: {
              street: "Av. Paulista, 1000",
              city: "São Paulo",
              state: "SP",
              postalCode: "01310100",
            },
            version: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-05T00:00:00.000Z",
          },
        });
      }

      if (url.includes("/consultations")) {
        return Response.json({
          data: [
            {
              id: "cons-1",
              scheduledAt: "2026-10-01T14:00:00.000Z",
              status: "COMPLETED",
              professionalName: "Dr. Roberto Lima",
              summary: "Consulta de rotina com prescrição renovada",
            },
          ],
        });
      }

      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }) as unknown as typeof fetch;

    const result = await getPatientOverview("clinica-vida", "pat-1");

    expect(authHeader).toBe("Bearer valid-session-jwt");
    expect(
      urlsCalled.some((u) =>
        u.includes("/organizations/clinica-vida/patients/pat-1"),
      ),
    ).toBe(true);

    expect(result.patient.id).toBe("pat-1");
    expect(result.patient.fullName).toBe("Carlos Eduardo Mendes");
    expect(result.contact.phone).toBe("11988887777");
    expect(result.contact.email).toBe("carlos@exemplo.com");
    expect(result.address?.street).toBe("Av. Paulista, 1000");
    expect(result.address?.postalCode).toBe("01310100");
    expect(result.activeInsurance?.name).toBe("Unimed Nacional");
    expect(result.activeInsurance?.number).toBe("UNI-998877");
    expect(result.allergies).toEqual(["Dipirona", "Penicilina"]);
    expect(result.comorbidities).toEqual([
      "Hipertensão arterial",
      "Diabetes tipo 2",
    ]);
    expect(result.clinicalAlerts).toEqual(["Risco elevado de sangramento"]);
    expect(result.medicalNotes).toBe("Uso contínuo de anticoagulante oral.");
    expect(result.upcomingAppointments).toHaveLength(1);
    expect(result.upcomingAppointments[0].professionalName).toBe(
      "Dra. Beatriz Santos",
    );
    expect(result.recentConsultations).toHaveLength(1);
    expect(result.recentConsultations[0].summary).toBe(
      "Consulta de rotina com prescrição renovada",
    );
    expect(result.isRestricted).toBe(false);
  });

  test("getPatientOverview handles 404 Not Found", async () => {
    globalThis.fetch = (async () => {
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }) as unknown as typeof fetch;

    expect(getPatientOverview("clinica-vida", "pat-missing")).rejects.toThrow(
      "Paciente não encontrado.",
    );
  });

  test("getPatientOverview handles 403 Forbidden", async () => {
    globalThis.fetch = (async () => {
      return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
    }) as unknown as typeof fetch;

    expect(getPatientOverview("clinica-vida", "pat-1")).rejects.toThrow(
      "Você não tem permissão para visualizar este paciente.",
    );
  });

  test("role-based clinical privacy: RECEPTIONIST gets sanitized overview without leaking confidential notes", async () => {
    globalThis.fetch = (async (url: string) => {
      // Backend omits allergies, comorbidities, alerts and notes for non-clinical roles
      if (url.includes("/patients/pat-2/overview")) {
        return Response.json({
          patient: {
            id: "pat-2",
            fullName: "Maria Clara Souza",
            cpf: "98765432100",
            birthDate: "1992-08-14",
            phone: "85988881111",
            email: null,
            healthInsurance: null,
            insuranceNumber: null,
            version: 0,
          },
          contact: {
            phone: "85988881111",
            email: null,
          },
          activeInsurance: null,
          upcomingAppointments: [],
        });
      }

      return Response.json({
        patient: {
          id: "pat-2",
          fullName: "Maria Clara Souza",
          cpf: "98765432100",
          birthDate: "1992-08-14",
          phone: "85988881111",
          email: null,
          healthInsurance: null,
          insuranceNumber: null,
          version: 0,
        },
      });
    }) as unknown as typeof fetch;

    const result = await getPatientOverview("clinica-vida", "pat-2");

    expect(result.patient.fullName).toBe("Maria Clara Souza");
    expect(result.allergies).toEqual([]);
    expect(result.comorbidities).toEqual([]);
    expect(result.clinicalAlerts).toEqual([]);
    expect(result.medicalNotes).toBeNull();
    expect(result.activeInsurance).toBeNull();
    expect(result.isRestricted).toBe(true);
  });
});

describe("Patient Timeline & Attachments Server Layer (#257)", () => {
  test("getPatientTimeline returns events for authorized clinical roles", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/timeline")) {
        return Response.json({
          data: [
            {
              id: "ev-1",
              eventType: "CONSULTATION",
              timestamp: "2026-10-10T15:00:00.000Z",
              professional: {
                id: "prof-1",
                name: "Dr. Lucas Lima",
                registrationNumber: "CRM/SP 123456",
              },
              summary: "Atendimento ambulatorial",
              status: "COMPLETED",
            },
            {
              id: "ev-2",
              eventType: "DOCUMENT",
              timestamp: "2026-10-10T15:30:00.000Z",
              professional: {
                id: "prof-1",
                name: "Dr. Lucas Lima",
              },
              summary: "Receita médica simples emitida",
              status: "ISSUED",
            },
          ],
          pageInfo: {
            limit: 20,
            hasNextPage: false,
            nextCursor: null,
          },
        });
      }
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }) as unknown as typeof fetch;

    const res = await getPatientTimeline("clinica-vida", "pat-1");
    expect(res.data).toHaveLength(2);
    expect(res.data[0].eventType).toBe("CONSULTATION");
    expect(res.data[1].eventType).toBe("DOCUMENT");
    expect(res.isRestricted).toBe(false);
  });

  test("getPatientTimeline returns isRestricted: true on 403 Forbidden for non-clinical role", async () => {
    globalThis.fetch = (async () => {
      return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
    }) as unknown as typeof fetch;

    const res = await getPatientTimeline("clinica-vida", "pat-1");
    expect(res.data).toHaveLength(0);
    expect(res.isRestricted).toBe(true);
  });

  test("getPatientAttachments returns attachments list for authorized roles", async () => {
    globalThis.fetch = (async (url: string) => {
      if (url.includes("/attachments")) {
        return Response.json({
          data: [
            {
              id: "att-1",
              fileName: "hemograma_completo.pdf",
              contentType: "application/pdf",
              sizeBytes: 204800,
              category: "Exame Laboratorial",
              createdAt: "2026-10-05T09:00:00.000Z",
            },
          ],
        });
      }
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }) as unknown as typeof fetch;

    const res = await getPatientAttachments("clinica-vida", "pat-1");
    expect(res.data).toHaveLength(1);
    expect(res.data[0].fileName).toBe("hemograma_completo.pdf");
    expect(res.isRestricted).toBe(false);
  });

  test("getPatientAttachments returns isRestricted: true on 403 Forbidden", async () => {
    globalThis.fetch = (async () => {
      return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
    }) as unknown as typeof fetch;

    const res = await getPatientAttachments("clinica-vida", "pat-1");
    expect(res.data).toHaveLength(0);
    expect(res.isRestricted).toBe(true);
  });
});

describe("Patient Header & Formatting Helpers (#257)", () => {
  test("masks CPF according to Brazilian medical records standard (123.***.***-00)", () => {
    expect(maskCpf("12345678900")).toBe("123.***.***-00");
    expect(maskCpf("52998224725")).toBe("529.***.***-25");
    expect(maskCpf("invalid")).toBe("invalid");
  });

  test("formats birth date and calculates patient age correctly", () => {
    const formatted = formatBirthDateAndAge("1990-05-15");
    expect(formatted.birthDateFormatted).toBe("15/05/1990");
    expect(formatted.ageText).toContain("anos");

    const empty = formatBirthDateAndAge(null);
    expect(empty.ageText).toBe("—");
    expect(empty.birthDateFormatted).toBe("—");
  });

  test("formats phone with area code for click-to-call link", () => {
    expect(formatPhoneWithAreaCode("11987654321")).toBe("(11) 98765-4321");
    expect(formatPhoneWithAreaCode("8533334444")).toBe("(85) 3333-4444");
    expect("11987654321".replace(/\D/g, "")).toBe("11987654321");
  });

  test("formats postal code with hyphen", () => {
    expect(formatPostalCode("01310100")).toBe("01310-100");
  });

  test("isClinicalRole distinguishes clinical from non-clinical roles", () => {
    expect(isClinicalRole("PROFESSIONAL")).toBe(true);
    expect(isClinicalRole("ADMIN_PROFESSIONAL")).toBe(true);
    expect(isClinicalRole("RECEPTIONIST")).toBe(false);
    // ADMIN (dono da clínica) passou a ser papel clínico em 22/10/2026.
    expect(isClinicalRole("ADMIN")).toBe(true);
    expect(isClinicalRole(null)).toBe(false);
  });
});
