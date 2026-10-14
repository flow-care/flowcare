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
  revalidatePath: (_path: string) => {},
}));

const { canEditAppointment } = await import("../lib/appointments");

const {
  updateAppointment,
  AppointmentsApiError,
  updateAppointmentInputSchema,
  updateAppointmentResponseSchema,
} = await import("../server/appointments");

const { updateAppointmentAction } = await import(
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

// 1. canEditAppointment eligibility
test("canEditAppointment allows editing on active and pending appointment statuses", () => {
  expect(canEditAppointment("RESERVED")).toBe(true);
  expect(canEditAppointment("CONFIRMED")).toBe(true);
  expect(canEditAppointment("WAITING")).toBe(true);
  expect(canEditAppointment("IN_PROGRESS")).toBe(true);
  expect(canEditAppointment("IN_CONSULTATION")).toBe(true);
});

test("canEditAppointment blocks editing on terminal statuses or undefined status", () => {
  expect(canEditAppointment("CANCELLED")).toBe(false);
  expect(canEditAppointment("COMPLETED")).toBe(false);
  expect(canEditAppointment("NO_SHOW")).toBe(false);
  expect(canEditAppointment(undefined)).toBe(false);
  expect(canEditAppointment(null as unknown as string)).toBe(false);
});

// 2. updateAppointment schemas
test("updateAppointmentInputSchema validates inputs and enforces version", () => {
  const valid = updateAppointmentInputSchema.safeParse({
    version: 0,
    scheduledAt: "2026-10-15T13:00:00.000Z",
    durationMinutes: 45,
    professionalId: "doc-1",
    notes: "Alterado horário",
  });
  expect(valid.success).toBe(true);

  const missingVersion = updateAppointmentInputSchema.safeParse({
    scheduledAt: "2026-10-15T13:00:00.000Z",
  });
  expect(missingVersion.success).toBe(false);

  const invalidDuration = updateAppointmentInputSchema.safeParse({
    version: 1,
    durationMinutes: 0,
  });
  expect(invalidDuration.success).toBe(false);
});

test("updateAppointmentResponseSchema parses valid backend response", () => {
  const validResponse = {
    appointment: {
      id: "appt-123",
      patientId: "patient-1",
      professionalId: "doc-1",
      scheduledAt: "2026-10-15T13:00:00.000Z",
      durationMinutes: 30,
      status: "CONFIRMED",
      notes: "Acompanhamento",
      version: 2,
      updatedAt: "2026-10-14T20:00:00.000Z",
    },
  };
  const parsed = updateAppointmentResponseSchema.safeParse(validResponse);
  expect(parsed.success).toBe(true);
});

// 3. updateAppointment server function
test("updateAppointment throws UNAUTHENTICATED when session token is missing", async () => {
  mockCookieToken = null;
  expect(
    updateAppointment("clinica-teste", "appt-123", {
      version: 0,
      notes: "teste",
    }),
  ).rejects.toThrow("Sessão expirada");
});

test("updateAppointment sends PATCH request with version and modified fields", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedBody = "";
  let capturedAuth = "";

  globalThis.fetch = mock(
    async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "GET";
      capturedBody = init?.body as string;
      capturedAuth = String(
        (init?.headers as Record<string, string>)?.Authorization,
      );

      return new Response(
        JSON.stringify({
          appointment: {
            id: "appt-123",
            patientId: "patient-1",
            professionalId: "doc-2",
            scheduledAt: "2026-10-16T14:00:00.000Z",
            durationMinutes: 45,
            status: "CONFIRMED",
            notes: "Remarcado para novo médico",
            version: 1,
            updatedAt: "2026-10-14T20:05:00.000Z",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  ) as typeof fetch;

  const result = await updateAppointment("clinica-teste", "appt-123", {
    version: 0,
    professionalId: "doc-2",
    scheduledAt: "2026-10-16T14:00:00.000Z",
    durationMinutes: 45,
    notes: "Remarcado para novo médico",
  });

  expect(capturedUrl).toContain(
    "/organizations/clinica-teste/appointments/appt-123",
  );
  expect(capturedMethod).toBe("PATCH");
  expect(capturedAuth).toBe("Bearer valid-token");

  const parsedBody = JSON.parse(capturedBody);
  expect(parsedBody.version).toBe(0);
  expect(parsedBody.professionalId).toBe("doc-2");
  expect(parsedBody.durationMinutes).toBe(45);
  expect(result.appointment.id).toBe("appt-123");
  expect(result.appointment.version).toBe(1);
  expect(result.appointment.professionalId).toBe("doc-2");
});

test("updateAppointment handles 409 VERSION_CONFLICT error with friendly message", async () => {
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: "VERSION_CONFLICT",
          message: "O agendamento foi atualizado em outra sessão.",
        },
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await updateAppointment("clinica-teste", "appt-123", {
      version: 0,
      notes: "atualização concorrente",
    });
    expect.unreachable("should have thrown 409 error");
  } catch (error) {
    expect(error).toBeInstanceOf(AppointmentsApiError);
    const err = error as InstanceType<typeof AppointmentsApiError>;
    expect(err.code).toBe("VERSION_CONFLICT");
    expect(err.message).toBe("O agendamento foi atualizado em outra sessão.");
  }
});

test("updateAppointment handles 409 SLOT_CONFLICT error when slot is occupied", async () => {
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: "SLOT_CONFLICT",
          message:
            "O horário selecionado conflita com outro agendamento do profissional.",
        },
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await updateAppointment("clinica-teste", "appt-123", {
      version: 1,
      scheduledAt: "2026-10-16T14:00:00.000Z",
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

test("updateAppointment handles 404 NOT_FOUND error", async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(JSON.stringify({ message: "Not found" }), { status: 404 }),
  ) as typeof fetch;

  expect(
    updateAppointment("clinica-teste", "non-existent-id", {
      version: 0,
      notes: "teste",
    }),
  ).rejects.toThrow("Agendamento não encontrado.");
});

test("updateAppointment handles 403 FORBIDDEN error", async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "FORBIDDEN",
            message: "Você não tem permissão para alterar agendamentos.",
          },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
  ) as typeof fetch;

  try {
    await updateAppointment("clinica-teste", "appt-123", {
      version: 0,
      notes: "teste",
    });
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(AppointmentsApiError);
    const err = error as InstanceType<typeof AppointmentsApiError>;
    expect(err.code).toBe("FORBIDDEN");
  }
});

test("updateAppointment handles 400 VALIDATION_ERROR error", async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "Nenhuma alteração foi informada.",
          },
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
  ) as typeof fetch;

  try {
    await updateAppointment("clinica-teste", "appt-123", {
      version: 0,
    });
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(AppointmentsApiError);
    const err = error as InstanceType<typeof AppointmentsApiError>;
    expect(err.code).toBe("VALIDATION_ERROR");
  }
});

// 4. updateAppointmentAction server action
test("updateAppointmentAction returns success: true and data on successful update", async () => {
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        appointment: {
          id: "appt-999",
          patientId: "patient-1",
          professionalId: "doc-1",
          scheduledAt: "2026-10-18T10:00:00.000Z",
          durationMinutes: 30,
          status: "CONFIRMED",
          notes: "Nota atualizada",
          version: 2,
          updatedAt: "2026-10-14T20:10:00.000Z",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await updateAppointmentAction("clinica-teste", "appt-999", {
    version: 1,
    notes: "Nota atualizada",
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.appointment.id).toBe("appt-999");
    expect(result.data.appointment.version).toBe(2);
  }
});

test("updateAppointmentAction returns success: false with code and error on VERSION_CONFLICT", async () => {
  globalThis.fetch = mock(async () => {
    return new Response(
      JSON.stringify({
        error: {
          code: "VERSION_CONFLICT",
          message: "O agendamento foi atualizado em outra sessão.",
        },
      }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await updateAppointmentAction("clinica-teste", "appt-999", {
    version: 0,
    notes: "Conflito",
  });

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.code).toBe("VERSION_CONFLICT");
    expect(result.error).toContain("outra sessão");
  }
});
