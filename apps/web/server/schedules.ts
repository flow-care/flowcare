import "server-only";

import { z } from "zod";
import type {
  ScheduleExceptionsResponse,
  ScheduleProfessional,
  WeeklyScheduleResponse,
} from "@/lib/schedules";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export class ScheduleApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ScheduleApiError";
  }
}

const weeklyScheduleSchema = z.object({
  timezone: z.string(),
  rules: z.array(
    z.object({
      dayOfWeek: z.enum([
        "MONDAY",
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
        "SATURDAY",
        "SUNDAY",
      ]),
      startTime: z.string(),
      endTime: z.string(),
      slotDurationMinutes: z.number().int(),
    }),
  ),
});

const scheduleExceptionsSchema = z.object({
  timezone: z.string(),
  exceptions: z.array(
    z.object({
      id: z.string(),
      professionalId: z.string().nullable(),
      startsAt: z.string(),
      endsAt: z.string(),
      timezone: z.string(),
      reason: z.string().nullable(),
    }),
  ),
});

const membersListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      userName: z.string(),
      email: z.string(),
      role: z.string(),
      status: z.string().optional(),
    }),
  ),
});

export async function getWeeklySchedule(
  orgSlug: string,
): Promise<WeeklyScheduleResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new ScheduleApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;

  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/settings/schedule-rules`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new ScheduleApiError(
      "UNAVAILABLE",
      "Não foi possível carregar os horários de atendimento da clínica.",
    );
  }

  if (!response.ok) {
    const status = response.status;
    const code =
      status === 401
        ? "UNAUTHENTICATED"
        : status === 403
          ? "FORBIDDEN"
          : status === 404
            ? "NOT_FOUND"
            : "UNAVAILABLE";
    const message =
      code === "UNAUTHENTICATED"
        ? "Entre novamente para continuar."
        : code === "FORBIDDEN"
          ? "Acesso restrito a administradores e profissionais da clínica."
          : code === "NOT_FOUND"
            ? "Clínica não encontrada."
            : "Não foi possível carregar a grade semanal de horários.";
    throw new ScheduleApiError(code, message);
  }

  const json = await response.json().catch(() => {
    throw new ScheduleApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao carregar horários semanais.",
    );
  });

  const parsed = weeklyScheduleSchema.safeParse(json);
  if (!parsed.success) {
    throw new ScheduleApiError(
      "INVALID_RESPONSE",
      "Estrutura inválida retornada para a grade semanal de horários.",
    );
  }

  return parsed.data;
}

export async function getScheduleExceptions(
  orgSlug: string,
): Promise<ScheduleExceptionsResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new ScheduleApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;

  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/settings/schedule-exceptions`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new ScheduleApiError(
      "UNAVAILABLE",
      "Não foi possível carregar os bloqueios e recessos da clínica.",
    );
  }

  if (!response.ok) {
    const status = response.status;
    const code =
      status === 401
        ? "UNAUTHENTICATED"
        : status === 403
          ? "FORBIDDEN"
          : status === 404
            ? "NOT_FOUND"
            : "UNAVAILABLE";
    const message =
      code === "UNAUTHENTICATED"
        ? "Entre novamente para continuar."
        : code === "FORBIDDEN"
          ? "Acesso restrito a administradores e profissionais da clínica."
          : code === "NOT_FOUND"
            ? "Clínica não encontrada."
            : "Não foi possível carregar os bloqueios e recessos.";
    throw new ScheduleApiError(code, message);
  }

  const json = await response.json().catch(() => {
    throw new ScheduleApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao carregar bloqueios da clínica.",
    );
  });

  const parsed = scheduleExceptionsSchema.safeParse(json);
  if (!parsed.success) {
    throw new ScheduleApiError(
      "INVALID_RESPONSE",
      "Estrutura inválida retornada para os bloqueios e recessos.",
    );
  }

  return parsed.data;
}

export async function getScheduleProfessionals(
  orgSlug: string,
): Promise<ScheduleProfessional[]> {
  const token = await getSessionToken();
  if (!token) return [];

  const { apiBaseUrl } = getServerConfig();
  try {
    const response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/members`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      },
    );

    if (!response.ok) return [];

    const json = await response.json().catch(() => null);
    const parsed = membersListSchema.safeParse(json);
    if (!parsed.success) return [];

    return parsed.data.data
      .filter(
        (m) =>
          m.role === "PROFESSIONAL" ||
          m.role === "ADMIN_PROFESSIONAL" ||
          m.role === "ADMIN",
      )
      .map((m) => ({
        id: m.userId,
        name: m.userName,
        role: m.role,
      }));
  } catch {
    return [];
  }
}
