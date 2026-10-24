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

const {
  canConfirmArrival,
  canStartAppointment,
  canCancelAppointment,
  formatQueueStatus,
  formatAppointmentTime,
} = await import("../lib/appointments");

const { getAppointmentDetails, cancelAppointment, AppointmentsApiError } =
  await import("../server/appointments");

const { maskCpf } = await import("../lib/patient-formatters");
const { formatPhoneWithAreaCode } = await import("../lib/phone");

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

// 1. Role-based Contextual Actions Eligibility & Formatters
test("formatAppointmentTime formats time range correctly", () => {
  expect(formatAppointmentTime("2026-10-14T10:00:00", 30)).toBe(
    "10:00 – 10:30",
  );
  expect(formatAppointmentTime("2026-10-14T14:15:00", 45)).toBe(
    "14:15 – 15:00",
  );
});

test("canStartAppointment allows clinical roles and blocks non-clinical roles", () => {
  // Clinical roles allowed for active statuses
  expect(canStartAppointment("ADMIN_PROFESSIONAL", "CONFIRMED")).toBe(true);
  expect(canStartAppointment("PROFESSIONAL", "RESERVED")).toBe(true);
  expect(canStartAppointment("PROFESSIONAL", "WAITING")).toBe(true);
  expect(canStartAppointment("PROFESSIONAL", "IN_PROGRESS")).toBe(true);

  // Non-clinical roles blocked
  expect(canStartAppointment("RECEPTIONIST", "CONFIRMED")).toBe(false);
  expect(canStartAppointment("ADMIN", "CONFIRMED")).toBe(true);
  expect(canStartAppointment(undefined, "CONFIRMED")).toBe(false);

  // Terminated appointments cannot be started even by doctors
  expect(canStartAppointment("ADMIN_PROFESSIONAL", "CANCELLED")).toBe(false);
  expect(canStartAppointment("PROFESSIONAL", "COMPLETED")).toBe(false);
  expect(canStartAppointment("PROFESSIONAL", "NO_SHOW")).toBe(false);
});

test("canCancelAppointment allows cancellation only on non-final statuses", () => {
  expect(canCancelAppointment("RESERVED")).toBe(true);
  expect(canCancelAppointment("CONFIRMED")).toBe(true);
  expect(canCancelAppointment("WAITING")).toBe(true);
  expect(canCancelAppointment("IN_PROGRESS")).toBe(true);

  expect(canCancelAppointment("CANCELLED")).toBe(false);
  expect(canCancelAppointment("COMPLETED")).toBe(false);
  expect(canCancelAppointment("NO_SHOW")).toBe(false);
  expect(canCancelAppointment(undefined)).toBe(false);
});

test("formatQueueStatus returns readable Portuguese labels for all queue stages", () => {
  expect(formatQueueStatus("WAITING")).toBe("Aguardando chegada");
  expect(canConfirmArrival("WAITING", "SCHEDULED")).toBe(true);
  expect(canConfirmArrival(null, "CONFIRMED")).toBe(true);
  expect(canConfirmArrival("ARRIVED", "SCHEDULED")).toBe(false);
  expect(canConfirmArrival("WAITING", "CANCELLED")).toBe(false);
  expect(canConfirmArrival("WAITING", "COMPLETED")).toBe(false);
  expect(formatQueueStatus("ARRIVED")).toBe("Aguardando na recepção");
  expect(formatQueueStatus("CALLED")).toBe("Chamado");
  expect(formatQueueStatus("IN_SERVICE")).toBe("Em atendimento");
  expect(formatQueueStatus("COMPLETED")).toBe("Finalizado");
  expect(formatQueueStatus("NO_SHOW")).toBe("Não compareceu");
  expect(formatQueueStatus(null)).toBe("Aguardando");
});

test("patient details formatters format phone with click-to-call and CPF with mask", () => {
  const rawPhone = "85991234567";
  const formattedPhone = formatPhoneWithAreaCode(rawPhone);
  expect(formattedPhone).toBe("(85) 99123-4567");

  const rawCpf = "12345678900";
  const masked = maskCpf(rawCpf);
  expect(masked).toBe("123.***.***-00");
});

// 2. cancelAppointment unit tests
test("cancelAppointment rejects reasons shorter than 10 characters", async () => {
  try {
    await cancelAppointment(
      "clinica-teste",
      "b991b585-7973-40f4-8a8b-c6b4d32f1092",
      {
        cancellationReason: "curto",
        version: 0,
      },
    );
    expect.unreachable();
  } catch (err) {
    expect(err).toBeInstanceOf(AppointmentsApiError);
    expect((err as InstanceType<typeof AppointmentsApiError>).code).toBe(
      "VALIDATION_ERROR",
    );
  }
});

test("cancelAppointment throws UNAUTHENTICATED when session token is missing", async () => {
  mockCookieToken = null;
  await expect(
    cancelAppointment("clinica-teste", "b991b585-7973-40f4-8a8b-c6b4d32f1092", {
      cancellationReason: "Paciente solicitou desmarcar consulta",
      version: 0,
    }),
  ).rejects.toThrow("Sessão expirada");
});

test("cancelAppointment sends POST request and returns cancelled response", async () => {
  let capturedUrl = "";
  let capturedBody = "";
  let capturedAuth = "";

  globalThis.fetch = async (input, init) => {
    capturedUrl = String(input);
    capturedBody = String(init?.body);
    capturedAuth = String(
      (init?.headers as Record<string, string>)?.Authorization,
    );

    return new Response(
      JSON.stringify({
        status: "CANCELLED",
        cancellationReason:
          "Paciente solicitou reagendamento por motivos de viagem",
        cancelledAt: "2026-10-14T15:00:00.000Z",
        cancelledById: "user-123",
        version: 1,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await cancelAppointment(
    "clinica-teste",
    "b991b585-7973-40f4-8a8b-c6b4d32f1092",
    {
      cancellationReason:
        "Paciente solicitou reagendamento por motivos de viagem",
      version: 0,
    },
  );

  expect(capturedUrl).toContain(
    "/organizations/clinica-teste/appointments/b991b585-7973-40f4-8a8b-c6b4d32f1092/cancel",
  );
  expect(capturedAuth).toBe("Bearer valid-token");
  expect(JSON.parse(capturedBody)).toEqual({
    cancellationReason:
      "Paciente solicitou reagendamento por motivos de viagem",
    version: 0,
  });
  expect(result.status).toBe("CANCELLED");
  expect(result.version).toBe(1);
});

test("cancelAppointment handles 404 NOT_FOUND error", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "Not found" }), { status: 404 });

  await expect(
    cancelAppointment("clinica-teste", "b991b585-7973-40f4-8a8b-c6b4d32f1092", {
      cancellationReason: "Paciente solicitou reagendamento",
      version: 0,
    }),
  ).rejects.toThrow("Agendamento não encontrado.");
});

test("cancelAppointment handles 409 INVALID_STATE_TRANSITION error", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "Conflict" }), { status: 409 });

  await expect(
    cancelAppointment("clinica-teste", "b991b585-7973-40f4-8a8b-c6b4d32f1092", {
      cancellationReason: "Paciente solicitou cancelamento",
      version: 0,
    }),
  ).rejects.toThrow("Agendamento encerrado ou em estado conflitante");
});

// 3. getAppointmentDetails unit tests
test("getAppointmentDetails returns null for invalid UUID format without network calls", async () => {
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const result = await getAppointmentDetails("clinica-teste", "invalid-id");
  expect(result).toBeNull();
  expect(called).toBe(false);

  const emptyResult = await getAppointmentDetails("clinica-teste", "");
  expect(emptyResult).toBeNull();
  expect(called).toBe(false);
});

test("getAppointmentDetails throws UNAUTHENTICATED when token is missing", async () => {
  mockCookieToken = null;
  await expect(
    getAppointmentDetails(
      "clinica-teste",
      "b991b585-7973-40f4-8a8b-c6b4d32f1092",
    ),
  ).rejects.toThrow("Sessão expirada");
});

test("getAppointmentDetails enriches appointment when initialAppointment is provided", async () => {
  const initialAppointment = {
    id: "b991b585-7973-40f4-8a8b-c6b4d32f1092",
    patientId: "p-12345",
    professionalId: "prof-67890",
    scheduledAt: "2026-10-14T13:00:00.000Z",
    localScheduledAt: "2026-10-14T10:00:00",
    durationMinutes: 30,
    status: "CONFIRMED" as const,
    patientName: "Ana Clara",
    professionalName: "Dra. Beatriz",
  };

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/patients/p-12345")) {
      return new Response(
        JSON.stringify({
          patient: {
            id: "p-12345",
            fullName: "Ana Clara Silva",
            phone: "85999887766",
            cpf: "12345678900",
            email: "anaclara@email.com",
            birthDate: "1995-04-12",
          },
        }),
        { status: 200 },
      );
    }
    if (url.includes("/members")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              userId: "prof-67890",
              userName: "Dra. Beatriz Souza",
              role: "PROFESSIONAL",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/queue")) {
      return new Response(
        JSON.stringify({
          queue: [
            {
              appointmentId: "b991b585-7973-40f4-8a8b-c6b4d32f1092",
              queueStatus: "ARRIVED",
              arrivedAt: "2026-10-14T09:50:00",
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 404 });
  };

  const details = await getAppointmentDetails(
    "clinica-teste",
    "b991b585-7973-40f4-8a8b-c6b4d32f1092",
    { initialAppointment },
  );

  expect(details).not.toBeNull();
  expect(details?.id).toBe("b991b585-7973-40f4-8a8b-c6b4d32f1092");
  expect(details?.patient?.fullName).toBe("Ana Clara Silva");
  expect(details?.patient?.phone).toBe("85999887766");
  expect(details?.patient?.cpf).toBe("12345678900");
  expect(details?.professional?.fullName).toBe("Dra. Beatriz Souza");
  expect(details?.professional?.specialty).toBe("Profissional Clínico");
  expect(details?.queueStatus).toBe("ARRIVED");
  expect(details?.arrivedAt).toBe("2026-10-14T09:50:00");
});

test("getAppointmentDetails searches schedule when initialAppointment is absent", async () => {
  const targetId = "b991b585-7973-40f4-8a8b-c6b4d32f1092";

  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/appointments?") && !url.includes("/queue")) {
      return new Response(
        JSON.stringify({
          timeZone: "America/Fortaleza",
          appointments: [
            {
              id: targetId,
              patientId: "p-999",
              professionalId: "prof-888",
              scheduledAt: "2026-10-14T14:00:00.000Z",
              localScheduledAt: "2026-10-14T11:00:00",
              durationMinutes: 45,
              status: "CONFIRMED",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/patients/p-999")) {
      return new Response(
        JSON.stringify({
          patient: {
            id: "p-999",
            fullName: "Carlos Eduardo",
            phone: "85988887777",
            cpf: "98765432100",
            email: "carlos@email.com",
          },
        }),
        { status: 200 },
      );
    }
    if (url.includes("/members")) {
      return new Response(
        JSON.stringify({
          data: [
            {
              userId: "prof-888",
              userName: "Dr. Roberto",
              role: "ADMIN_PROFESSIONAL",
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ queue: [] }), { status: 200 });
  };

  const details = await getAppointmentDetails("clinica-teste", targetId, {
    hintDate: "2026-10-14",
  });

  expect(details).not.toBeNull();
  expect(details?.patient?.fullName).toBe("Carlos Eduardo");
  expect(details?.patient?.phone).toBe("85988887777");
  expect(details?.professional?.fullName).toBe("Dr. Roberto");
});

test("getAppointmentDetails returns null when appointment is not found in range", async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/appointments?") && !url.includes("/queue")) {
      return new Response(
        JSON.stringify({
          timeZone: "America/Fortaleza",
          appointments: [],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };

  const details = await getAppointmentDetails(
    "clinica-teste",
    "b991b585-7973-40f4-8a8b-c6b4d32f1092",
  );
  expect(details).toBeNull();
});
