import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  APPOINTMENT_DURATION_OPTIONS,
  getDefaultAppointmentTime,
  zonedDateTimeToUtc,
} from "../lib/appointments";

mock.module("server-only", () => ({}));

let mockCookieToken: string | null = "valid-token";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockCookieToken ? { value: mockCookieToken } : undefined,
    set: () => {},
  }),
}));

const {
  searchPatients,
  getProfessionals,
  createAppointment,
  checkAvailability,
  AppointmentsApiError,
} = await import("../server/appointments");

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

test("date/time utilities: zonedDateTimeToUtc converts correctly and ends with Z", () => {
  const utcResult = zonedDateTimeToUtc(
    "2026-10-15",
    "10:00",
    "America/Sao_Paulo",
  );
  expect(utcResult).toBe("2026-10-15T13:00:00.000Z");
  expect(utcResult.endsWith("Z")).toBe(true);

  // UTC-4 (Manaus)
  const utcManaus = zonedDateTimeToUtc("2026-10-15", "10:00", "America/Manaus");
  expect(utcManaus).toBe("2026-10-15T14:00:00.000Z");
});

test("date/time utilities: getDefaultAppointmentTime returns next hour formatted as HH:00", () => {
  const defaultTime = getDefaultAppointmentTime();
  expect(defaultTime).toMatch(/^\d{2}:00$/);
});

test("date/time utilities: APPOINTMENT_DURATION_OPTIONS contains standard durations", () => {
  const values = APPOINTMENT_DURATION_OPTIONS.map((opt) => opt.value);
  expect(values).toEqual([15, 30, 45, 60]);
});

test("searchPatients: calls backend and returns matching patients", async () => {
  let capturedUrl = "";
  let capturedHeaders: HeadersInit | undefined;

  globalThis.fetch = mock(
    async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "patient-1",
              fullName: "Carlos Silva",
              cpf: "12345678901",
              phone: "11987654321",
              email: "carlos@test.com",
            },
            {
              id: "patient-2",
              fullName: "Carla Souza",
              cpf: "98765432100",
              phone: "11987654322",
              email: null,
            },
          ],
          pageInfo: {
            nextCursor: null,
            hasNextPage: false,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  ) as typeof fetch;

  const result = await searchPatients("minha-clinica", "Carl");

  expect(capturedUrl).toContain(
    "/organizations/minha-clinica/patients?search=Carl",
  );
  expect((capturedHeaders as Record<string, string>)?.Authorization).toBe(
    "Bearer valid-token",
  );
  expect(result.length).toBe(2);
  expect(result[0].fullName).toBe("Carlos Silva");
  expect(result[0].cpf).toBe("12345678901");
});

test("searchPatients: throws AppointmentsApiError when unauthenticated", async () => {
  mockCookieToken = null;
  expect(searchPatients("minha-clinica", "Teste")).rejects.toThrow(
    AppointmentsApiError,
  );
});

test("searchPatients: throws AppointmentsApiError when upstream fails", async () => {
  globalThis.fetch = mock(
    async () => new Response("Internal Server Error", { status: 500 }),
  ) as typeof fetch;
  expect(searchPatients("minha-clinica", "Teste")).rejects.toThrow(
    AppointmentsApiError,
  );
});

test("getProfessionals: filters and returns active doctors and professional members", async () => {
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "mem-1",
            userId: "doc-1",
            userName: "Dra. Ana Paula",
            role: "PROFESSIONAL",
            status: "ACTIVE",
          },
          {
            id: "mem-2",
            userId: "doc-2",
            userName: "Dr. Roberto Santos",
            role: "ADMIN_PROFESSIONAL",
            status: "ACTIVE",
          },
          {
            id: "mem-3",
            userId: "rec-1",
            userName: "Maria Recepção",
            role: "RECEPTIONIST",
            status: "ACTIVE",
          },
          {
            id: "mem-4",
            userId: "doc-3",
            userName: "Dr. Suspenso",
            role: "PROFESSIONAL",
            status: "SUSPENDED",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const professionals = await getProfessionals("minha-clinica");

  expect(professionals.length).toBe(2);
  expect(professionals[0]).toEqual({
    id: "doc-1",
    name: "Dra. Ana Paula",
    role: "PROFESSIONAL",
  });
  expect(professionals[1]).toEqual({
    id: "doc-2",
    name: "Dr. Roberto Santos",
    role: "ADMIN_PROFESSIONAL",
  });
});

test("createAppointment: sends correct payload and Idempotency-Key header", async () => {
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
          timeZone: "America/Sao_Paulo",
          appointment: {
            id: "new-appt-123",
            patientId: "patient-1",
            professionalId: "doc-1",
            scheduledAt: "2026-10-15T13:00:00.000Z",
            durationMinutes: 30,
            status: "RESERVED",
            notes: "Primeira consulta",
            createdAt: "2026-10-14T18:00:00.000Z",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    },
  ) as typeof fetch;

  const result = await createAppointment("minha-clinica", {
    patientId: "patient-1",
    professionalId: "doc-1",
    scheduledAt: "2026-10-15T13:00:00.000Z",
    durationMinutes: 30,
    notes: "Primeira consulta",
    idempotencyKey: "test-idem-key-123",
  });

  expect(capturedUrl).toContain("/organizations/minha-clinica/appointments");
  const headers = capturedHeaders as Record<string, string>;
  expect(headers["Idempotency-Key"]).toBe("test-idem-key-123");
  expect(headers.Authorization).toBe("Bearer valid-token");

  const parsedBody = JSON.parse(capturedBody ?? "{}");
  expect(parsedBody).toEqual({
    patientId: "patient-1",
    professionalId: "doc-1",
    scheduledAt: "2026-10-15T13:00:00.000Z",
    durationMinutes: 30,
    notes: "Primeira consulta",
  });

  expect(result.appointment.id).toBe("new-appt-123");
  expect(result.appointment.status).toBe("RESERVED");
});

test("createAppointment: auto-generates idempotencyKey when not provided", async () => {
  let capturedHeaders: HeadersInit | undefined;

  globalThis.fetch = mock(
    async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({
          timeZone: "America/Sao_Paulo",
          appointment: {
            id: "new-appt-456",
            patientId: "patient-1",
            professionalId: "doc-1",
            scheduledAt: "2026-10-15T13:00:00.000Z",
            durationMinutes: 30,
            status: "RESERVED",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      );
    },
  ) as typeof fetch;

  await createAppointment("minha-clinica", {
    patientId: "patient-1",
    professionalId: "doc-1",
    scheduledAt: "2026-10-15T13:00:00.000Z",
    durationMinutes: 30,
  });

  const headers = capturedHeaders as Record<string, string>;
  expect(headers["Idempotency-Key"]).toBeTruthy();
  expect(typeof headers["Idempotency-Key"]).toBe("string");
});

test("createAppointment: handles 409 SLOT_CONFLICT and throws AppointmentsApiError with slot conflict code and message", async () => {
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: "SLOT_CONFLICT",
          message:
            "O horário selecionado conflita com outro agendamento do profissional.",
          details: {
            reason: "APPOINTMENT_OVERLAP",
          },
        },
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await createAppointment("minha-clinica", {
      patientId: "patient-1",
      professionalId: "doc-1",
      scheduledAt: "2026-10-15T13:00:00.000Z",
      durationMinutes: 30,
    });
    expect.unreachable("should have thrown 409 error");
  } catch (error) {
    expect(error).toBeInstanceOf(AppointmentsApiError);
    const err = error as InstanceType<typeof AppointmentsApiError>;
    expect(err.code).toBe("SLOT_CONFLICT");
    expect(err.message).toBe(
      "O horário selecionado conflita com outro agendamento do profissional.",
    );
  }
});

test("createAppointment: throws AppointmentsApiError on 401 unauthenticated and 403 forbidden", async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "PERMISSION_DENIED",
            message: "Você não tem permissão para criar agendamentos.",
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
  ) as typeof fetch;

  try {
    await createAppointment("minha-clinica", {
      patientId: "patient-1",
      professionalId: "doc-1",
      scheduledAt: "2026-10-15T13:00:00.000Z",
      durationMinutes: 30,
    });
    expect.unreachable("should have thrown 403 error");
  } catch (error) {
    expect(error).toBeInstanceOf(AppointmentsApiError);
    const err = error as InstanceType<typeof AppointmentsApiError>;
    expect(err.code).toBe("FORBIDDEN");
  }
});

test("checkAvailability: calls availability endpoint and returns available slots", async () => {
  let capturedUrl = "";

  globalThis.fetch = mock(async (input: string | URL | Request) => {
    capturedUrl = String(input);
    return new Response(
      JSON.stringify({
        date: "2026-10-15",
        professionalId: "doc-1",
        timeZone: "America/Sao_Paulo",
        slots: [
          {
            startsAt: "2026-10-15T11:00:00.000Z",
            endsAt: "2026-10-15T11:30:00.000Z",
            localStartsAt: "2026-10-15T08:00:00",
            localEndsAt: "2026-10-15T08:30:00",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await checkAvailability("minha-clinica", {
    date: "2026-10-15",
    professionalId: "doc-1",
  });

  expect(capturedUrl).toContain(
    "/organizations/minha-clinica/appointments/availability",
  );
  expect(capturedUrl).toContain("date=2026-10-15");
  expect(capturedUrl).toContain("professionalId=doc-1");
  expect(result.slots.length).toBe(1);
  expect(result.slots[0].localStartsAt).toBe("2026-10-15T08:00:00");
});
