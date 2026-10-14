import { afterEach, beforeEach, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let mockCookieToken: string | null = "valid-token";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockCookieToken ? { value: mockCookieToken } : undefined,
    set: () => {},
  }),
}));

mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

const {
  getPendingConfirmations,
  recordManualConfirmation,
  ConfirmationsApiError,
} = await import("../server/confirmations");

const { recordConfirmationAction } = await import(
  "../app/app/[orgSlug]/appointments/actions"
);

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockCookieToken = "valid-token";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

test("getPendingConfirmations fetches, validates, and enriches pending confirmations with patient and professional metadata", async () => {
  const requestedUrls: string[] = [];
  const authHeaders: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requestedUrls.push(url);
    authHeaders.push(
      String((init?.headers as Record<string, string>)?.Authorization),
    );

    if (url.includes("/confirmations/pending")) {
      return Response.json({
        timeZone: "America/Fortaleza",
        data: [
          {
            id: "conf-1",
            appointmentId: "apt-1",
            organizationId: "org-1",
            patientId: "patient-1",
            professionalId: "prof-1",
            scheduledAt: "2026-10-15T12:00:00.000Z",
            localScheduledAt: "2026-10-15T09:00:00",
            durationMinutes: 30,
            appointmentStatus: "RESERVED",
            status: "PENDING",
            decision: "PENDING",
            origin: null,
            source: null,
            originalMessage: "Acho que vou me atrasar 10 min",
            originalMessageId: "msg-1",
            originalMessageAt: "2026-10-14T20:00:00.000Z",
            note: null,
            decidedById: null,
            decidedAt: null,
            createdAt: "2026-10-14T18:00:00.000Z",
            updatedAt: "2026-10-14T18:00:00.000Z",
          },
          {
            id: "conf-2",
            appointmentId: "apt-2",
            organizationId: "org-1",
            patientId: "patient-2",
            professionalId: "prof-1",
            scheduledAt: "2026-10-16T13:00:00.000Z",
            localScheduledAt: "2026-10-16T10:00:00",
            durationMinutes: 45,
            appointmentStatus: "RESERVED",
            status: "PENDING",
            decision: "PENDING",
            origin: null,
            source: null,
            originalMessage: null,
            originalMessageId: null,
            originalMessageAt: null,
            note: null,
            decidedById: null,
            decidedAt: null,
            createdAt: "2026-10-14T18:30:00.000Z",
            updatedAt: "2026-10-14T18:30:00.000Z",
          },
        ],
        pageInfo: {
          nextCursor: null,
          hasNextPage: false,
        },
      });
    }

    if (url.includes("/patients")) {
      return Response.json({
        data: [
          {
            id: "patient-1",
            fullName: "Carlos Silva",
            phone: "85999998888",
          },
          {
            id: "patient-2",
            fullName: "Ana Ferreira",
            phone: null,
          },
        ],
      });
    }

    if (url.includes("/members")) {
      return Response.json({
        data: [
          {
            userId: "prof-1",
            userName: "Dr. Roberto Medeiros",
            role: "PROFESSIONAL",
          },
        ],
      });
    }

    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;

  const result = await getPendingConfirmations("clinica-teste");

  expect(result.timeZone).toBe("America/Fortaleza");
  expect(result.data).toHaveLength(2);

  const item1 = result.data[0];
  expect(item1.id).toBe("conf-1");
  expect(item1.appointmentId).toBe("apt-1");
  expect(item1.patientName).toBe("Carlos Silva");
  expect(item1.patientPhone).toBe("85999998888");
  expect(item1.professionalName).toBe("Dr. Roberto Medeiros");
  expect(item1.originalMessage).toBe("Acho que vou me atrasar 10 min");

  const item2 = result.data[1];
  expect(item2.id).toBe("conf-2");
  expect(item2.patientName).toBe("Ana Ferreira");
  expect(item2.patientPhone).toBeNull();

  const confirmationsUrl = requestedUrls.find((u) =>
    u.includes("/appointments/confirmations/pending"),
  );
  expect(confirmationsUrl).toBeDefined();
  expect(authHeaders[0]).toBe("Bearer valid-token");
});

test("getPendingConfirmations filters items by startDate and endDate in memory when provided", async () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/confirmations/pending")) {
      return Response.json({
        timeZone: "America/Fortaleza",
        data: [
          {
            id: "conf-1",
            appointmentId: "apt-1",
            organizationId: "org-1",
            patientId: "patient-1",
            professionalId: "prof-1",
            scheduledAt: "2026-10-15T12:00:00.000Z",
            localScheduledAt: "2026-10-15T09:00:00",
            durationMinutes: 30,
            appointmentStatus: "RESERVED",
            status: "PENDING",
            decision: "PENDING",
            createdAt: "2026-10-14T18:00:00.000Z",
            updatedAt: "2026-10-14T18:00:00.000Z",
          },
          {
            id: "conf-2",
            appointmentId: "apt-2",
            organizationId: "org-1",
            patientId: "patient-2",
            professionalId: "prof-1",
            scheduledAt: "2026-10-16T13:00:00.000Z",
            localScheduledAt: "2026-10-16T10:00:00",
            durationMinutes: 45,
            appointmentStatus: "RESERVED",
            status: "PENDING",
            decision: "PENDING",
            createdAt: "2026-10-14T18:30:00.000Z",
            updatedAt: "2026-10-14T18:30:00.000Z",
          },
        ],
      });
    }

    if (url.includes("/patients")) {
      return Response.json({ data: [] });
    }
    if (url.includes("/members")) {
      return Response.json({ data: [] });
    }

    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;

  const filtered = await getPendingConfirmations("clinica-teste", {
    startDate: "2026-10-15",
    endDate: "2026-10-15",
  });

  expect(filtered.data).toHaveLength(1);
  expect(filtered.data[0].id).toBe("conf-1");
});

test("getPendingConfirmations throws ConfirmationsApiError when unauthenticated", async () => {
  mockCookieToken = null;
  expect(getPendingConfirmations("clinica-teste")).rejects.toBeInstanceOf(
    ConfirmationsApiError,
  );
});

test("getPendingConfirmations throws ConfirmationsApiError when upstream returns 500", async () => {
  globalThis.fetch = (async () =>
    new Response("Internal Server Error", {
      status: 500,
    })) as unknown as typeof fetch;

  expect(getPendingConfirmations("clinica-teste")).rejects.toBeInstanceOf(
    ConfirmationsApiError,
  );
});

test("getPendingConfirmations throws ConfirmationsApiError when upstream returns invalid json", async () => {
  globalThis.fetch = (async () =>
    Response.json({ invalid: "schema" })) as unknown as typeof fetch;

  expect(getPendingConfirmations("clinica-teste")).rejects.toBeInstanceOf(
    ConfirmationsApiError,
  );
});

test("recordManualConfirmation posts CONFIRMED decision with origin and note", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedHeaders: Record<string, string> = {};
  let capturedBody: Record<string, unknown> = {};

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedMethod = init?.method ?? "GET";
    capturedHeaders = (init?.headers as Record<string, string>) ?? {};
    capturedBody = JSON.parse(String(init?.body ?? "{}"));

    return Response.json({
      confirmation: {
        id: "conf-1",
        appointmentId: "apt-1",
        organizationId: "org-1",
        patientId: "patient-1",
        professionalId: "prof-1",
        scheduledAt: "2026-10-15T12:00:00.000Z",
        localScheduledAt: "2026-10-15T09:00:00",
        durationMinutes: 30,
        appointmentStatus: "CONFIRMED",
        status: "CONFIRMED",
        decision: "CONFIRMED",
        origin: "PHONE_CALL",
        source: "PHONE_CALL",
        note: "Paciente confirmou por ligação",
        decidedById: "user-1",
        decidedAt: "2026-10-14T21:00:00.000Z",
        createdAt: "2026-10-14T18:00:00.000Z",
        updatedAt: "2026-10-14T21:00:00.000Z",
      },
    });
  }) as unknown as typeof fetch;

  const result = await recordManualConfirmation(
    "clinica-teste",
    "apt-1",
    "CONFIRMED",
    "Paciente confirmou por ligação",
  );

  expect(capturedUrl).toContain(
    "/organizations/clinica-teste/appointments/apt-1/confirmation",
  );
  expect(capturedMethod).toBe("POST");
  expect(capturedHeaders.Authorization).toBe("Bearer valid-token");
  expect(capturedHeaders["Content-Type"]).toBe("application/json");
  expect(capturedBody).toEqual({
    decision: "CONFIRMED",
    origin: "PHONE_CALL",
    note: "Paciente confirmou por ligação",
  });
  expect(result.success).toBe(true);
  expect(result.confirmation.status).toBe("CONFIRMED");
});

test("recordManualConfirmation maps CANCELLED to DECLINED and NO_RESPONSE to PENDING", async () => {
  const capturedBodies: Record<string, unknown>[] = [];

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBodies.push(JSON.parse(String(init?.body ?? "{}")));
    return Response.json({
      confirmation: {
        id: "conf-1",
        appointmentId: "apt-1",
        organizationId: "org-1",
        patientId: "patient-1",
        professionalId: "prof-1",
        scheduledAt: "2026-10-15T12:00:00.000Z",
        localScheduledAt: "2026-10-15T09:00:00",
        durationMinutes: 30,
        appointmentStatus: "CANCELLED",
        status: "DECLINED",
        decision: "DECLINED",
        origin: "PHONE_CALL",
        createdAt: "2026-10-14T18:00:00.000Z",
        updatedAt: "2026-10-14T21:00:00.000Z",
      },
    });
  }) as unknown as typeof fetch;

  // CANCELLED -> DECLINED
  await recordManualConfirmation("clinica-teste", "apt-1", "CANCELLED");
  expect(capturedBodies[0].decision).toBe("DECLINED");

  // NO_RESPONSE -> PENDING
  await recordManualConfirmation("clinica-teste", "apt-1", "NO_RESPONSE");
  expect(capturedBodies[1].decision).toBe("PENDING");
});

test("recordManualConfirmation throws ConfirmationsApiError when upstream returns 404", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: { code: "NOT_FOUND", message: "Agendamento não encontrado." },
      }),
      { status: 404 },
    )) as unknown as typeof fetch;

  expect(
    recordManualConfirmation("clinica-teste", "apt-nonexistent", "CONFIRMED"),
  ).rejects.toBeInstanceOf(ConfirmationsApiError);
});

test("recordConfirmationAction server action succeeds and returns ok: true", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      confirmation: {
        id: "conf-1",
        appointmentId: "apt-1",
        organizationId: "org-1",
        patientId: "patient-1",
        professionalId: "prof-1",
        scheduledAt: "2026-10-15T12:00:00.000Z",
        localScheduledAt: "2026-10-15T09:00:00",
        durationMinutes: 30,
        appointmentStatus: "CONFIRMED",
        status: "CONFIRMED",
        decision: "CONFIRMED",
        createdAt: "2026-10-14T18:00:00.000Z",
        updatedAt: "2026-10-14T21:00:00.000Z",
      },
    })) as unknown as typeof fetch;

  const res = await recordConfirmationAction(
    "clinica-teste",
    "apt-1",
    "CONFIRMED",
  );
  expect(res.success).toBe(true);
  expect(res.error).toBeUndefined();
});

test("recordConfirmationAction returns success: false with error message when call throws", async () => {
  mockCookieToken = null;
  const res = await recordConfirmationAction(
    "clinica-teste",
    "apt-1",
    "CONFIRMED",
  );
  expect(res.success).toBe(false);
  expect(res.error).toContain("Sessão expirada");
});
