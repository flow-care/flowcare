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

const { getPatientTimeline, PatientsApiError } = await import(
  "../server/patients"
);

const { getPatientTimelineAction } = await import(
  "../app/app/[orgSlug]/patients/actions"
);

const {
  PatientRecordsTimeline,
  PatientRecordsTimelineSkeleton,
  resolveEventBadgeType,
  sortTimelineEventsDescending,
  filterEventsByCategory,
  formatTimelineDateTime,
  EVENT_BADGE_CONFIG,
  TIMELINE_CATEGORIES,
} = await import("../components/flowcare/patients/patient-records-timeline");

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

describe("Patient Records Timeline - Server Layer (#258)", () => {
  test("throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(getPatientTimeline("clinica-vida", "pat-1")).rejects.toThrow(
      PatientsApiError,
    );
  });

  test("calls upstream API with query filters (type, startDate, endDate)", async () => {
    let capturedUrl = "";
    let authHeader = "";

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      authHeader =
        (init?.headers as Record<string, string>)?.Authorization ?? "";

      return Response.json({
        data: [
          {
            id: "ev-1",
            eventType: "CONSULTATION",
            timestamp: "2026-10-14T10:00:00.000Z",
            professional: {
              id: "prof-1",
              name: "Dr. Carlos Silva",
              registrationNumber: "CRM/SP 123456",
              professionalTitle: "Cardiologia",
            },
            summary: "Consulta cardiológica de retorno",
            status: "COMPLETED",
          },
        ],
        pageInfo: {
          limit: 20,
          hasNextPage: false,
          nextCursor: null,
        },
      });
    }) as unknown as typeof fetch;

    const res = await getPatientTimeline("clinica-vida", "pat-1", {
      type: "consultation",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    expect(authHeader).toBe("Bearer valid-session-jwt");
    expect(capturedUrl).toContain(
      "/organizations/clinica-vida/patients/pat-1/timeline",
    );
    expect(capturedUrl).toContain("type=consultation");
    expect(capturedUrl).toContain("startDate=2026-10-01");
    expect(capturedUrl).toContain("endDate=2026-10-31");
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe("ev-1");
    expect(res.isRestricted).toBe(false);
  });

  test("ignores type=all filter parameter in URL query", async () => {
    let capturedUrl = "";

    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return Response.json({
        data: [],
        pageInfo: { limit: 20, hasNextPage: false, nextCursor: null },
      });
    }) as unknown as typeof fetch;

    await getPatientTimeline("clinica-vida", "pat-1", {
      type: "all",
    });

    expect(capturedUrl).not.toContain("type=all");
  });

  test("handles 403 Forbidden by returning isRestricted: true", async () => {
    globalThis.fetch = (async () => {
      return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
    }) as unknown as typeof fetch;

    const res = await getPatientTimeline("clinica-vida", "pat-1");
    expect(res.data).toHaveLength(0);
    expect(res.isRestricted).toBe(true);
  });

  test("handles 401 Unauthenticated by throwing PatientsApiError", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        { error: { code: "UNAUTHENTICATED" } },
        { status: 401 },
      );
    }) as unknown as typeof fetch;

    expect(getPatientTimeline("clinica-vida", "pat-1")).rejects.toThrow(
      "Entre novamente para continuar.",
    );
  });

  test("handles 404 Not Found by throwing PatientsApiError", async () => {
    globalThis.fetch = (async () => {
      return Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    }) as unknown as typeof fetch;

    expect(getPatientTimeline("clinica-vida", "pat-1")).rejects.toThrow(
      "Paciente não encontrado.",
    );
  });

  test("handles 500 upstream server error by throwing PatientsApiError", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        { error: { code: "INTERNAL_SERVER_ERROR", message: "Erro interno." } },
        { status: 500 },
      );
    }) as unknown as typeof fetch;

    expect(getPatientTimeline("clinica-vida", "pat-1")).rejects.toThrow(
      PatientsApiError,
    );
  });

  test("getPatientTimelineAction wraps server call and returns structured result", async () => {
    globalThis.fetch = (async () => {
      return Response.json({
        data: [
          {
            id: "ev-1",
            eventType: "CONSULTATION",
            timestamp: "2026-10-14T10:00:00.000Z",
            summary: "Consulta realizada",
            status: "COMPLETED",
          },
        ],
        pageInfo: { limit: 20, hasNextPage: false, nextCursor: null },
      });
    }) as unknown as typeof fetch;

    const actionResult = await getPatientTimelineAction(
      "clinica-vida",
      "pat-1",
    );
    expect(actionResult.success).toBe(true);
    expect(actionResult.data).toHaveLength(1);
    expect(actionResult.data[0].summary).toBe("Consulta realizada");
  });
});

describe("Patient Records Timeline - Chronological Sorting (#258)", () => {
  test("sorts events in descending order (most recent first)", () => {
    const rawEvents = [
      {
        id: "ev-older",
        eventType: "CONSULTATION",
        timestamp: "2026-05-10T09:00:00.000Z",
        summary: "Consulta antiga",
        status: "COMPLETED",
      },
      {
        id: "ev-newest",
        eventType: "DOCUMENT",
        timestamp: "2026-10-14T16:00:00.000Z",
        summary: "Prescrição recente",
        status: "ISSUED",
      },
      {
        id: "ev-middle",
        eventType: "APPOINTMENT",
        timestamp: "2026-08-20T11:30:00.000Z",
        summary: "Agendamento intermediário",
        status: "CONFIRMED",
      },
    ];

    const sorted = sortTimelineEventsDescending(rawEvents);
    expect(sorted[0].id).toBe("ev-newest");
    expect(sorted[1].id).toBe("ev-middle");
    expect(sorted[2].id).toBe("ev-older");
  });

  test("sorts same-day events by time descending", () => {
    const sameDayEvents = [
      {
        id: "ev-morning",
        eventType: "APPOINTMENT",
        timestamp: "2026-10-14T08:30:00.000Z",
        summary: "Chegada na recepção",
        status: "CONFIRMED",
      },
      {
        id: "ev-afternoon",
        eventType: "CONSULTATION",
        timestamp: "2026-10-14T14:45:00.000Z",
        summary: "Atendimento clínico",
        status: "COMPLETED",
      },
      {
        id: "ev-evening",
        eventType: "DOCUMENT",
        timestamp: "2026-10-14T17:00:00.000Z",
        summary: "Emissão de atestado",
        status: "ISSUED",
      },
    ];

    const sorted = sortTimelineEventsDescending(sameDayEvents);
    expect(sorted[0].id).toBe("ev-evening");
    expect(sorted[1].id).toBe("ev-afternoon");
    expect(sorted[2].id).toBe("ev-morning");
  });

  test("breaks ties with identical timestamp deterministically by ID", () => {
    const identicalTimestamps = [
      {
        id: "ev-alpha",
        eventType: "CONSULTATION",
        timestamp: "2026-10-14T12:00:00.000Z",
        summary: "Evento Alpha",
        status: "COMPLETED",
      },
      {
        id: "ev-beta",
        eventType: "DOCUMENT",
        timestamp: "2026-10-14T12:00:00.000Z",
        summary: "Evento Beta",
        status: "ISSUED",
      },
    ];

    const sorted = sortTimelineEventsDescending(identicalTimestamps);
    expect(sorted[0].id).toBe("ev-beta");
    expect(sorted[1].id).toBe("ev-alpha");
  });
});

describe("Patient Records Timeline - Event Type Badges (#258)", () => {
  test("resolves CONSULTATION badge type", () => {
    const event = {
      id: "c-1",
      eventType: "CONSULTATION",
      timestamp: "2026-10-14T10:00:00.000Z",
      summary: "Consulta clínica geral",
      status: "COMPLETED",
    };
    expect(resolveEventBadgeType(event)).toBe("CONSULTATION");
  });

  test("resolves PRESCRIPTION badge type from metadata documentType or summary", () => {
    const eventWithMeta = {
      id: "doc-1",
      eventType: "DOCUMENT",
      timestamp: "2026-10-14T10:30:00.000Z",
      summary: "Receita de uso contínuo",
      status: "ISSUED",
      metadata: { documentType: "PRESCRIPTION" },
    };
    expect(resolveEventBadgeType(eventWithMeta)).toBe("PRESCRIPTION");

    const directPrescription = {
      id: "p-1",
      eventType: "PRESCRIPTION",
      timestamp: "2026-10-14T10:30:00.000Z",
      summary: "Prescrição médica de antibióticos",
      status: "ISSUED",
    };
    expect(resolveEventBadgeType(directPrescription)).toBe("PRESCRIPTION");
  });

  test("resolves CERTIFICATE badge type from metadata documentType or summary", () => {
    const eventCert = {
      id: "doc-2",
      eventType: "DOCUMENT",
      timestamp: "2026-10-14T10:45:00.000Z",
      summary: "Atestado de afastamento médico",
      status: "ISSUED",
      metadata: { documentType: "CERTIFICATE" },
    };
    expect(resolveEventBadgeType(eventCert)).toBe("CERTIFICATE");

    const directCert = {
      id: "cert-1",
      eventType: "CERTIFICATE",
      timestamp: "2026-10-14T10:45:00.000Z",
      summary: "Atestado médico 3 dias",
      status: "ISSUED",
    };
    expect(resolveEventBadgeType(directCert)).toBe("CERTIFICATE");
  });

  test("resolves EXAM badge type from exam requests and attachments", () => {
    const examDoc = {
      id: "doc-3",
      eventType: "DOCUMENT",
      timestamp: "2026-10-14T11:00:00.000Z",
      summary: "Pedido de exame laboratorial",
      status: "ISSUED",
      metadata: { documentType: "EXAM_REQUEST" },
    };
    expect(resolveEventBadgeType(examDoc)).toBe("EXAM");

    const examAttachment = {
      id: "att-1",
      eventType: "ATTACHMENT",
      timestamp: "2026-10-14T11:15:00.000Z",
      summary: "Hemograma completo com plaquetas",
      status: "ACTIVE",
      metadata: { category: "Exame Laboratorial" },
    };
    expect(resolveEventBadgeType(examAttachment)).toBe("EXAM");

    const directExam = {
      id: "ex-1",
      eventType: "EXAM",
      timestamp: "2026-10-14T11:15:00.000Z",
      summary: "Eletrocardiograma de repouso",
      status: "COMPLETED",
    };
    expect(resolveEventBadgeType(directExam)).toBe("EXAM");
  });

  test("resolves ATTACHMENT badge type for generic patient files", () => {
    const genericFile = {
      id: "att-2",
      eventType: "ATTACHMENT",
      timestamp: "2026-10-14T11:30:00.000Z",
      summary: "documento_identidade.pdf",
      status: "ACTIVE",
      metadata: { category: "Documento Pessoal" },
    };
    expect(resolveEventBadgeType(genericFile)).toBe("ATTACHMENT");
  });

  test("resolves APPOINTMENT badge type", () => {
    const appt = {
      id: "apt-1",
      eventType: "APPOINTMENT",
      timestamp: "2026-10-14T12:00:00.000Z",
      summary: "Agendamento de consulta prévia",
      status: "CONFIRMED",
    };
    expect(resolveEventBadgeType(appt)).toBe("APPOINTMENT");
  });

  test("EVENT_BADGE_CONFIG covers all 6 required clinical badge types", () => {
    const expectedBadges = [
      "CONSULTATION",
      "PRESCRIPTION",
      "CERTIFICATE",
      "EXAM",
      "ATTACHMENT",
      "APPOINTMENT",
    ];

    for (const badge of expectedBadges) {
      expect(
        EVENT_BADGE_CONFIG[badge as keyof typeof EVENT_BADGE_CONFIG],
      ).toBeDefined();
      expect(
        EVENT_BADGE_CONFIG[badge as keyof typeof EVENT_BADGE_CONFIG].label,
      ).toBeTruthy();
    }
  });
});

describe("Patient Records Timeline - Category Filtering (#258)", () => {
  const mixedEvents = [
    {
      id: "e-cons",
      eventType: "CONSULTATION",
      timestamp: "2026-10-14T10:00:00.000Z",
      summary: "Atendimento ambulatorial",
      status: "COMPLETED",
    },
    {
      id: "e-presc",
      eventType: "DOCUMENT",
      timestamp: "2026-10-13T10:00:00.000Z",
      summary: "Receita amoxicilina",
      status: "ISSUED",
      metadata: { documentType: "PRESCRIPTION" },
    },
    {
      id: "e-cert",
      eventType: "CERTIFICATE",
      timestamp: "2026-10-12T10:00:00.000Z",
      summary: "Atestado médico de 2 dias",
      status: "ISSUED",
    },
    {
      id: "e-exam",
      eventType: "DOCUMENT",
      timestamp: "2026-10-11T10:00:00.000Z",
      summary: "Solicitação de raio-x de tórax",
      status: "ISSUED",
      metadata: { documentType: "EXAM_REQUEST" },
    },
    {
      id: "e-appt",
      eventType: "APPOINTMENT",
      timestamp: "2026-10-10T10:00:00.000Z",
      summary: "Agendamento inicial",
      status: "CONFIRMED",
    },
    {
      id: "e-att",
      eventType: "ATTACHMENT",
      timestamp: "2026-10-09T10:00:00.000Z",
      summary: "carteirinha_convenio.png",
      status: "ACTIVE",
    },
  ];

  test("filter 'all' returns all events", () => {
    const result = filterEventsByCategory(mixedEvents, "all");
    expect(result).toHaveLength(6);
  });

  test("filter 'consultations' returns only consultations", () => {
    const result = filterEventsByCategory(mixedEvents, "consultations");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e-cons");
  });

  test("filter 'documents' returns prescriptions and certificates", () => {
    const result = filterEventsByCategory(mixedEvents, "documents");
    expect(result).toHaveLength(2);
    const ids = result.map((r) => r.id);
    expect(ids).toContain("e-presc");
    expect(ids).toContain("e-cert");
  });

  test("filter 'exams' returns exam requests and laboratory exams", () => {
    const result = filterEventsByCategory(mixedEvents, "exams");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e-exam");
  });

  test("filter 'appointments' returns appointments", () => {
    const result = filterEventsByCategory(mixedEvents, "appointments");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("e-appt");
  });

  test("filter on empty list returns empty list without error", () => {
    expect(filterEventsByCategory([], "consultations")).toEqual([]);
  });

  test("TIMELINE_CATEGORIES contains the 5 required category tabs", () => {
    const keys = TIMELINE_CATEGORIES.map((c) => c.key);
    const labels = TIMELINE_CATEGORIES.map((c) => c.label);

    expect(keys).toEqual([
      "all",
      "consultations",
      "documents",
      "exams",
      "appointments",
    ]);
    expect(labels).toEqual([
      "Todos",
      "Consultas",
      "Documentos",
      "Exames",
      "Agendamentos",
    ]);
  });
});

describe("Patient Records Timeline - Date and Time Formatting (#258)", () => {
  test("formats ISO datetime string to Brazilian format with 'às'", () => {
    const formatted = formatTimelineDateTime("2026-10-14T15:30:00.000Z");
    expect(formatted).toBe("14/10/2026 às 15:30");
  });

  test("handles date-only or invalid dates safely", () => {
    const invalid = formatTimelineDateTime("invalid-date");
    expect(invalid).toBe("invalid-date");
  });
});

describe("Patient Records Timeline - UI Component & RBAC (#258)", () => {
  test("renders locked card 'Acesso restrito à equipe clínica' when isClinical is false", () => {
    const html = renderToStaticMarkup(
      createElement(PatientRecordsTimeline, {
        timeline: {
          data: [],
          pageInfo: { limit: 0, hasNextPage: false, nextCursor: null },
          isRestricted: false,
        },
        isClinical: false,
      }),
    );

    expect(html).toContain("Acesso restrito à equipe clínica");
    expect(html).toContain(
      "O prontuário e o histórico clínico deste paciente são restritos a profissionais de saúde autorizados da equipe clínica.",
    );
  });

  test("renders locked card 'Acesso restrito à equipe clínica' when timeline.isRestricted is true", () => {
    const html = renderToStaticMarkup(
      createElement(PatientRecordsTimeline, {
        timeline: {
          data: [],
          pageInfo: { limit: 0, hasNextPage: false, nextCursor: null },
          isRestricted: true,
        },
        isClinical: true,
      }),
    );

    expect(html).toContain("Acesso restrito à equipe clínica");
  });

  test("renders empty state 'Nenhum registro clínico encontrado no histórico deste paciente' when data is empty", () => {
    const html = renderToStaticMarkup(
      createElement(PatientRecordsTimeline, {
        timeline: {
          data: [],
          pageInfo: { limit: 20, hasNextPage: false, nextCursor: null },
          isRestricted: false,
        },
        isClinical: true,
      }),
    );

    expect(html).toContain(
      "Nenhum registro clínico encontrado no histórico deste paciente.",
    );
  });

  test("renders timeline cards with badges, timestamp, professional info, and clinical summary", () => {
    const sampleTimeline = {
      data: [
        {
          id: "ev-1",
          eventType: "CONSULTATION",
          timestamp: "2026-10-14T14:30:00.000Z",
          professional: {
            id: "prof-1",
            name: "Dra. Beatriz Santos",
            registrationNumber: "CRM/SP 987654",
            professionalTitle: "Clínica Geral",
          },
          summary: "Paciente relata cefaleia tensional e fadiga moderada.",
          status: "COMPLETED",
        },
        {
          id: "ev-2",
          eventType: "DOCUMENT",
          timestamp: "2026-10-14T15:00:00.000Z",
          professional: {
            id: "prof-1",
            name: "Dra. Beatriz Santos",
            registrationNumber: "CRM/SP 987654",
          },
          summary: "Prescrição de analgésico e relaxante muscular",
          status: "ISSUED",
          metadata: { documentType: "PRESCRIPTION" },
        },
      ],
      pageInfo: { limit: 20, hasNextPage: false, nextCursor: null },
      isRestricted: false,
    };

    const html = renderToStaticMarkup(
      createElement(PatientRecordsTimeline, {
        timeline: sampleTimeline,
        isClinical: true,
      }),
    );

    // Header and records count
    expect(html).toContain("Histórico e Prontuário Clínico");
    expect(html).toContain("2 registro(s)");

    // Category buttons
    expect(html).toContain("Todos");
    expect(html).toContain("Consultas");
    expect(html).toContain("Documentos");
    expect(html).toContain("Exames");
    expect(html).toContain("Agendamentos");

    // Badges
    expect(html).toContain("CONSULTATION");
    expect(html).toContain("PRESCRIPTION");
    expect(html).toContain("Consulta");
    expect(html).toContain("Prescrição");

    // Professional info & registration
    expect(html).toContain("Dra. Beatriz Santos");
    expect(html).toContain("CRM/SP 987654");
    expect(html).toContain("Clínica Geral");

    // Clinical summary
    expect(html).toContain(
      "Paciente relata cefaleia tensional e fadiga moderada.",
    );
    expect(html).toContain("Prescrição de analgésico e relaxante muscular");

    // Date
    expect(html).toContain("14/10/2026 às 14:30");
    expect(html).toContain("14/10/2026 às 15:00");
  });

  test("renders loading skeleton state when isLoading is true", () => {
    const html = renderToStaticMarkup(
      createElement(PatientRecordsTimeline, {
        timeline: {
          data: [],
          pageInfo: { limit: 0, hasNextPage: false, nextCursor: null },
          isRestricted: false,
        },
        isClinical: true,
        isLoading: true,
      }),
    );

    expect(html).toContain('data-slot="skeleton"');
  });

  test("PatientRecordsTimelineSkeleton renders cleanly as standalone component", () => {
    const html = renderToStaticMarkup(
      createElement(PatientRecordsTimelineSkeleton),
    );
    expect(html).toContain('data-slot="skeleton"');
  });

  test("read-only integrity: renders no forms or mutation controls in timeline", () => {
    const sampleTimeline = {
      data: [
        {
          id: "ev-completed",
          eventType: "CONSULTATION",
          timestamp: "2026-10-14T14:30:00.000Z",
          professional: {
            id: "prof-1",
            name: "Dr. Roberto",
          },
          summary: "Atendimento concluído com sucesso.",
          status: "COMPLETED",
        },
      ],
      pageInfo: { limit: 20, hasNextPage: false, nextCursor: null },
      isRestricted: false,
    };

    const html = renderToStaticMarkup(
      createElement(PatientRecordsTimeline, {
        timeline: sampleTimeline,
        isClinical: true,
      }),
    );

    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Editar");
    expect(html).not.toContain("Excluir");
    expect(html).toContain("Ver detalhes");
  });
});
