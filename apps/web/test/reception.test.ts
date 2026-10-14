import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  calculateWaitTimeMinutes,
  formatWaitTime,
  normalizeReceptionQueueStatus,
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

const { getReceptionQueue, updateReceptionQueueStatus, ReceptionApiError } =
  await import("../server/reception");

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

describe("normalizeReceptionQueueStatus", () => {
  test("maps all reception queue statuses to badges and keys accurately", () => {
    expect(normalizeReceptionQueueStatus("WAITING")).toEqual({
      key: "WAITING",
      label: "Aguardando",
      variant: "outline",
    });
    expect(normalizeReceptionQueueStatus("ARRIVED")).toEqual({
      key: "ARRIVED",
      label: "Presente",
      variant: "secondary",
    });
    expect(normalizeReceptionQueueStatus("CALLED")).toEqual({
      key: "CALLED",
      label: "Chamado",
      variant: "default",
    });
    expect(normalizeReceptionQueueStatus("IN_SERVICE")).toEqual({
      key: "IN_SERVICE",
      label: "Em atendimento",
      variant: "default",
    });
    expect(normalizeReceptionQueueStatus("IN_CONSULTATION")).toEqual({
      key: "IN_SERVICE",
      label: "Em atendimento",
      variant: "default",
    });
    expect(normalizeReceptionQueueStatus("COMPLETED")).toEqual({
      key: "COMPLETED",
      label: "Concluído",
      variant: "outline",
    });
    expect(normalizeReceptionQueueStatus("CANCELLED")).toEqual({
      key: "CANCELLED",
      label: "Cancelado",
      variant: "destructive",
    });
    expect(normalizeReceptionQueueStatus("NO_SHOW")).toEqual({
      key: "NO_SHOW",
      label: "Não compareceu",
      variant: "destructive",
    });
  });
});

describe("wait time calculation and formatting", () => {
  test("calculates wait time in minutes accurately", () => {
    const ref = new Date("2026-10-14T10:30:00.000Z");

    expect(calculateWaitTimeMinutes("2026-10-14T10:15:00.000Z", ref)).toBe(15);
    expect(calculateWaitTimeMinutes("2026-10-14T10:30:00.000Z", ref)).toBe(0);
    expect(calculateWaitTimeMinutes("2026-10-14T09:00:00.000Z", ref)).toBe(90);
    expect(calculateWaitTimeMinutes(null, ref)).toBeNull();
    expect(calculateWaitTimeMinutes(undefined, ref)).toBeNull();
    expect(calculateWaitTimeMinutes("invalid-date", ref)).toBeNull();
  });

  test("formats wait time into Brazilian human readable duration strings", () => {
    expect(formatWaitTime(null)).toBe("–");
    expect(formatWaitTime(0)).toBe("< 1 min");
    expect(formatWaitTime(12)).toBe("12 min");
    expect(formatWaitTime(60)).toBe("1h");
    expect(formatWaitTime(75)).toBe("1h 15min");
    expect(formatWaitTime(120)).toBe("2h");
  });
});

describe("getReceptionQueue", () => {
  test("calls reception queue endpoint and enriches with patient and professional names", async () => {
    const requestedUrls: string[] = [];
    const authHeaders: string[] = [];

    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      requestedUrls.push(url);
      authHeaders.push(
        String((init?.headers as Record<string, string>)?.Authorization),
      );

      if (url.includes("/reception/queue")) {
        return Response.json({
          date: "2026-10-14",
          timeZone: "America/Fortaleza",
          queue: [
            {
              id: "apt-1",
              appointmentId: "apt-1",
              patientId: "patient-1",
              professionalId: "prof-1",
              scheduledAt: "2026-10-14T11:00:00.000Z",
              localScheduledAt: "2026-10-14T08:00:00",
              durationMinutes: 30,
              status: "CONFIRMED",
              queueStatus: "ARRIVED",
              arrivedAt: "2026-10-14T10:50:00.000Z",
              queueUpdatedAt: "2026-10-14T10:50:00.000Z",
              queueUpdatedById: "user-1",
              version: 1,
            },
            {
              id: "apt-2",
              appointmentId: "apt-2",
              patientId: "patient-2",
              professionalId: "prof-1",
              scheduledAt: "2026-10-14T11:30:00.000Z",
              localScheduledAt: "2026-10-14T08:30:00",
              durationMinutes: 30,
              status: "RESERVED",
              queueStatus: "WAITING",
              arrivedAt: null,
              queueUpdatedAt: null,
              queueUpdatedById: null,
              version: 0,
            },
          ],
        });
      }

      if (url.includes("/patients")) {
        return Response.json({
          data: [
            { id: "patient-1", fullName: "Carlos Andrade" },
            { id: "patient-2", fullName: "Fernanda Lima" },
          ],
        });
      }

      if (url.includes("/members")) {
        return Response.json({
          data: [{ userId: "prof-1", userName: "Dr. Roberto Dias" }],
        });
      }

      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;

    const result = await getReceptionQueue("clinica-vida", "2026-10-14");

    const queueUrl = requestedUrls.find((u) => u.includes("/reception/queue"));
    expect(queueUrl).toBeDefined();
    expect(queueUrl).toContain(
      "/organizations/clinica-vida/reception/queue?date=2026-10-14",
    );
    expect(authHeaders[0]).toBe("Bearer valid-token");

    expect(result.date).toBe("2026-10-14");
    expect(result.timeZone).toBe("America/Fortaleza");
    expect(result).toHaveLength(2);

    expect(result[0].id).toBe("apt-1");
    expect(result[0].patientName).toBe("Carlos Andrade");
    expect(result[0].professionalName).toBe("Dr. Roberto Dias");
    expect(result[0].queueStatus).toBe("ARRIVED");
    expect(result[0].version).toBe(1);

    expect(result[1].id).toBe("apt-2");
    expect(result[1].patientName).toBe("Fernanda Lima");
    expect(result[1].professionalName).toBe("Dr. Roberto Dias");
    expect(result[1].queueStatus).toBe("WAITING");
    expect(result[1].version).toBe(0);
  });

  test("throws ReceptionApiError when unauthenticated", async () => {
    mockCookieToken = null;
    expect(
      getReceptionQueue("clinica-vida", "2026-10-14"),
    ).rejects.toBeInstanceOf(ReceptionApiError);
  });

  test("throws ReceptionApiError when backend returns 500", async () => {
    globalThis.fetch = (async () =>
      new Response("Server Error", { status: 500 })) as unknown as typeof fetch;

    expect(
      getReceptionQueue("clinica-vida", "2026-10-14"),
    ).rejects.toBeInstanceOf(ReceptionApiError);
  });
});

describe("updateReceptionQueueStatus", () => {
  test("sends PATCH to reception queue endpoint with target status and version", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: Record<string, unknown> = {};
    let capturedAuth = "";

    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "GET";
      capturedAuth = String(
        (init?.headers as Record<string, string>)?.Authorization,
      );
      if (init?.body) {
        capturedBody = JSON.parse(String(init.body));
      }

      return Response.json({
        id: "apt-1",
        appointmentId: "apt-1",
        patientId: "patient-1",
        professionalId: "prof-1",
        scheduledAt: "2026-10-14T11:00:00.000Z",
        localScheduledAt: "2026-10-14T08:00:00",
        durationMinutes: 30,
        status: "CONFIRMED",
        queueStatus: "CALLED",
        arrivedAt: "2026-10-14T10:50:00.000Z",
        queueUpdatedAt: "2026-10-14T10:55:00.000Z",
        queueUpdatedById: "user-1",
        version: 2,
      });
    }) as unknown as typeof fetch;

    const result = await updateReceptionQueueStatus(
      "clinica-vida",
      "apt-1",
      "CALLED",
      1,
    );

    expect(capturedUrl).toContain(
      "/organizations/clinica-vida/reception/queue/apt-1",
    );
    expect(capturedMethod).toBe("PATCH");
    expect(capturedAuth).toBe("Bearer valid-token");
    expect(capturedBody).toEqual({
      status: "CALLED",
      version: 1,
    });
    expect(result.queueStatus).toBe("CALLED");
    expect(result.version).toBe(2);
  });

  test("maps IN_CONSULTATION to IN_SERVICE in API payload", async () => {
    let capturedBody: Record<string, unknown> = {};

    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (init?.body) {
        capturedBody = JSON.parse(String(init.body));
      }

      return Response.json({
        id: "apt-1",
        appointmentId: "apt-1",
        patientId: "patient-1",
        professionalId: "prof-1",
        scheduledAt: "2026-10-14T11:00:00.000Z",
        localScheduledAt: "2026-10-14T08:00:00",
        durationMinutes: 30,
        status: "CONFIRMED",
        queueStatus: "IN_SERVICE",
        arrivedAt: "2026-10-14T10:50:00.000Z",
        queueUpdatedAt: "2026-10-14T11:00:00.000Z",
        queueUpdatedById: "user-1",
        version: 3,
      });
    }) as unknown as typeof fetch;

    const result = await updateReceptionQueueStatus(
      "clinica-vida",
      "apt-1",
      "IN_CONSULTATION",
      2,
    );

    expect(capturedBody).toEqual({
      status: "IN_SERVICE",
      version: 2,
    });
    expect(result.queueStatus).toBe("IN_SERVICE");
    expect(result.version).toBe(3);
  });

  test("handles version conflict 409 error", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "VERSION_CONFLICT",
            message:
              "O agendamento foi atualizado em outra sessão. Recarregue a fila.",
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    expect(
      updateReceptionQueueStatus("clinica-vida", "apt-1", "CALLED", 0),
    ).rejects.toThrow("O agendamento foi atualizado em outra sessão");
  });

  test("throws ReceptionApiError when session token is missing", async () => {
    mockCookieToken = null;
    expect(
      updateReceptionQueueStatus("clinica-vida", "apt-1", "CALLED", 0),
    ).rejects.toBeInstanceOf(ReceptionApiError);
  });
});
