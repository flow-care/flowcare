import "server-only";

import { z } from "zod";
import type {
  ScheduleExceptionItem,
  ScheduleExceptionsResponse,
  ScheduleProfessional,
  WeeklyScheduleResponse,
  WeeklyScheduleRule,
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

export async function replaceWeeklySchedule(
  orgSlug: string,
  rules: WeeklyScheduleRule[],
  timezone = "America/Sao_Paulo",
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
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ timezone, rules }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new ScheduleApiError(
      "UNAVAILABLE",
      "Não foi possível salvar a grade semanal de horários.",
    );
  }

  if (!response.ok) {
    const status = response.status;
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    const message =
      body?.message ||
      (status === 400
        ? "Intervalo ou duração inválidos."
        : status === 401
          ? "Entre novamente para continuar."
          : status === 403
            ? "Acesso restrito a administradores da clínica."
            : "Não foi possível salvar a grade semanal.");
    throw new ScheduleApiError(
      status === 409 ? "SCHEDULE_CONFLICT" : "VALIDATION_ERROR",
      message,
    );
  }

  const json = (await response.json()) as WeeklyScheduleResponse;
  return json;
}

export async function createScheduleException(
  orgSlug: string,
  data: {
    professionalId?: string | null;
    startsAt: string;
    endsAt: string;
    reason?: string | null;
  },
): Promise<ScheduleExceptionItem> {
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
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          professionalId: data.professionalId || undefined,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          reason: data.reason || undefined,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new ScheduleApiError(
      "UNAVAILABLE",
      "Não foi possível criar o bloqueio de agenda.",
    );
  }

  if (!response.ok) {
    const status = response.status;
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    const message =
      body?.message ||
      (status === 409
        ? "Já existe um bloqueio de agenda neste período para o profissional ou clínica selecionado."
        : status === 400
          ? "Intervalo de datas inválido."
          : status === 403
            ? "Acesso restrito a administradores da clínica."
            : "Não foi possível criar o bloqueio.");
    throw new ScheduleApiError(
      status === 409 ? "SCHEDULE_CONFLICT" : "VALIDATION_ERROR",
      message,
    );
  }

  const json = (await response.json()) as { exception: ScheduleExceptionItem };
  return json.exception;
}

export async function deleteScheduleException(
  orgSlug: string,
  exceptionId: string,
): Promise<boolean> {
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
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/settings/schedule-exceptions/${encodeURIComponent(exceptionId)}`,
      {
        method: "DELETE",
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
      "Não foi possível remover o bloqueio da agenda.",
    );
  }

  if (!response.ok) {
    throw new ScheduleApiError(
      "UNAVAILABLE",
      "Não foi possível remover o bloqueio da agenda.",
    );
  }

  return true;
}

