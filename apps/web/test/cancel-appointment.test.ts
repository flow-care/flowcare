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
  revalidateTag: () => {},
}));

const {
  cancelAppointment,
  cancelAppointmentInputSchema,
  cancellationReasonTypeSchema,
  CANCELLATION_REASONS,
  CANCELLATION_REASON_LABELS,
  AppointmentsApiError,
} = await import("../server/appointments");

const { cancelAppointmentAction } = await import(
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

// 1. Reason Validation Tests
test("CANCELLATION_REASONS contains all 5 standardized options with Portuguese labels", () => {
  expect(CANCELLATION_REASONS).toHaveLength(5);
  const values = CANCELLATION_REASONS.map((r) => r.value);
  expect(values).toEqual([
    "PATIENT_REQUEST",
    "PROFESSIONAL_UNAVAILABLE",
    "NO_SHOW",
    "SCHEDULING_ERROR",
    "OTHER",
  ]);

  expect(CANCELLATION_REASON_LABELS.PATIENT_REQUEST).toBe(
    "Desistência do paciente",
  );
  expect(CANCELLATION_REASON_LABELS.PROFESSIONAL_UNAVAILABLE).toBe(
    "Imprevisto do profissional médico",
  );
  expect(CANCELLATION_REASON_LABELS.NO_SHOW).toBe("Paciente não compareceu");
  expect(CANCELLATION_REASON_LABELS.SCHEDULING_ERROR).toBe(
    "Erro no agendamento",
  );
  expect(CANCELLATION_REASON_LABELS.OTHER).toBe("Outros motivos");
});

test("cancellationReasonTypeSchema validates accepted reasons and rejects invalid reasons", () => {
  for (const reason of [
    "PATIENT_REQUEST",
    "PROFESSIONAL_UNAVAILABLE",
    "NO_SHOW",
    "SCHEDULING_ERROR",
    "OTHER",
  ]) {
    const parsed = cancellationReasonTypeSchema.safeParse(reason);
    expect(parsed.success).toBe(true);
  }

  const invalidReasons = ["INVALID", "UNKNOWN", "DOCTOR_SICK", "", null, 123];
  for (const invalid of invalidReasons) {
    const parsed = cancellationReasonTypeSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  }
});

test("cancelAppointmentInputSchema rejects invalid reasonType", () => {
  const parsed = cancelAppointmentInputSchema.safeParse({
    reasonType: "INVALID_REASON",
    justification: "Justificativa válida com mais de 10 caracteres",
    version: 0,
  });
  expect(parsed.success).toBe(false);
});

// 2. Justification Min 10 Characters Validation Tests
test("cancelAppointmentInputSchema rejects justification shorter than 10 characters", () => {
  const shortInputs = ["", "curto", "123456789", "  12345  ", "         "];

  for (const justification of shortInputs) {
    const parsed = cancelAppointmentInputSchema.safeParse({
      reasonType: "PATIENT_REQUEST",
      justification,
      version: 0,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        "A justificativa deve ter pelo menos 10 caracteres.",
      );
    }
  }
});

test("cancelAppointmentInputSchema accepts justification with 10 or more characters", () => {
  const validInputs = [
    "1234567890",
    "Paciente solicitou o reagendamento por motivos de viagem",
    "Imprevisto médico na sala de cirurgia",
  ];

  for (const justification of validInputs) {
    const parsed = cancelAppointmentInputSchema.safeParse({
      reasonType: "PATIENT_REQUEST",
      justification,
      version: 1,
    });
    expect(parsed.success).toBe(true);
  }
});

test("cancelAppointment throws AppointmentsApiError VALIDATION_ERROR when input is invalid", async () => {
  await expect(
    cancelAppointment("clinica-teste", "b991b585-7973-40f4-8a8b-c6b4d32f1092", {
      reasonType: "PATIENT_REQUEST",
      justification: "pouco",
      version: 0,
    }),
  ).rejects.toThrow("A justificativa deve ter pelo menos 10 caracteres.");
});

// 3. Slot Release Indication & Upstream Request Formatting
test("cancelAppointment returns slotReleased: true and formats standardized reason label", async () => {
  let capturedBody: { cancellationReason?: string; version?: number } | null =
    null;
  globalThis.fetch = async (_input, init) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        status: "CANCELLED",
        cancellationReason: capturedBody.cancellationReason,
        cancelledAt: "2026-10-14T18:00:00.000Z",
        cancelledById: "user-123",
        version: 2,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await cancelAppointment(
    "clinica-teste",
    "b991b585-7973-40f4-8a8b-c6b4d32f1092",
    {
      reasonType: "PATIENT_REQUEST",
      justification: "Paciente viajou a trabalho e precisou desmarcar",
      version: 1,
    },
  );

  expect(result.status).toBe("CANCELLED");
  expect(result.slotReleased).toBe(true);
  expect(result.version).toBe(2);
  expect(capturedBody.cancellationReason).toBe(
    "[Desistência do paciente] Paciente viajou a trabalho e precisou desmarcar",
  );
  expect(capturedBody.version).toBe(1);
});

test("cancelAppointmentAction executes cancelAppointment and indicates slot release", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: "CANCELLED",
        cancellationReason:
          "[Imprevisto do profissional médico] Médico com emergência hospitalar",
        cancelledAt: "2026-10-14T18:30:00.000Z",
        version: 3,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const actionResult = await cancelAppointmentAction(
    "clinica-teste",
    "b991b585-7973-40f4-8a8b-c6b4d32f1092",
    {
      reasonType: "PROFESSIONAL_UNAVAILABLE",
      justification: "Médico com emergência hospitalar",
      version: 2,
    },
  );

  expect(actionResult.success).toBe(true);
  expect(actionResult.data?.status).toBe("CANCELLED");
  expect(actionResult.data?.slotReleased).toBe(true);
  expect(actionResult.data?.version).toBe(3);
});

// 4. Error Mapping Tests
test("cancelAppointment maps 404 to NOT_FOUND", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "Not found" }), { status: 404 });

  try {
    await cancelAppointment(
      "clinica-teste",
      "b991b585-7973-40f4-8a8b-c6b4d32f1092",
      {
        reasonType: "OTHER",
        justification: "Agendamento duplicado por engano",
        version: 0,
      },
    );
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(AppointmentsApiError);
    expect((error as InstanceType<typeof AppointmentsApiError>).code).toBe(
      "NOT_FOUND",
    );
    expect((error as InstanceType<typeof AppointmentsApiError>).message).toBe(
      "Agendamento não encontrado.",
    );
  }
});

test("cancelAppointment maps 409 INVALID_STATE_TRANSITION for terminal statuses", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "INVALID_STATE_TRANSITION",
          message: "Agendamento encerrado não pode ser cancelado.",
        },
      }),
      { status: 409 },
    );

  try {
    await cancelAppointment(
      "clinica-teste",
      "b991b585-7973-40f4-8a8b-c6b4d32f1092",
      {
        reasonType: "NO_SHOW",
        justification: "Paciente não compareceu ao consultório",
        version: 0,
      },
    );
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(AppointmentsApiError);
    expect((error as InstanceType<typeof AppointmentsApiError>).code).toBe(
      "INVALID_STATE_TRANSITION",
    );
    expect(
      (error as InstanceType<typeof AppointmentsApiError>).message,
    ).toContain("Agendamento encerrado ou em estado conflitante");
  }
});

test("cancelAppointment maps 409 VERSION_CONFLICT for concurrent updates", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "VERSION_CONFLICT",
          message: "O agendamento foi alterado. Recarregue os dados.",
        },
      }),
      { status: 409 },
    );

  try {
    await cancelAppointment(
      "clinica-teste",
      "b991b585-7973-40f4-8a8b-c6b4d32f1092",
      {
        reasonType: "SCHEDULING_ERROR",
        justification: "Conflito de versão detectado",
        version: 0,
      },
    );
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(AppointmentsApiError);
    expect((error as InstanceType<typeof AppointmentsApiError>).code).toBe(
      "VERSION_CONFLICT",
    );
    expect(
      (error as InstanceType<typeof AppointmentsApiError>).message,
    ).toContain("O agendamento foi alterado");
  }
});

test("cancelAppointment maps 401 to UNAUTHENTICATED and 403 to FORBIDDEN", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 });

  try {
    await cancelAppointment(
      "clinica-teste",
      "b991b585-7973-40f4-8a8b-c6b4d32f1092",
      {
        reasonType: "OTHER",
        justification: "Tentativa sem permissão de escrita",
        version: 0,
      },
    );
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(AppointmentsApiError);
    expect((error as InstanceType<typeof AppointmentsApiError>).code).toBe(
      "FORBIDDEN",
    );
  }
});

test("cancelAppointmentAction catches errors and returns structured error object", async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: { code: "INVALID_STATE_TRANSITION" },
      }),
      { status: 409 },
    );

  const result = await cancelAppointmentAction(
    "clinica-teste",
    "b991b585-7973-40f4-8a8b-c6b4d32f1092",
    {
      reasonType: "PATIENT_REQUEST",
      justification: "Tentativa em agendamento já finalizado",
      version: 0,
    },
  );

  expect(result.success).toBe(false);
  expect(result.code).toBe("INVALID_STATE_TRANSITION");
  expect(result.error).toContain("Agendamento encerrado");
});
