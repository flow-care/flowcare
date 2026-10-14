import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export type DashboardPeriod = "today" | "week" | "month";

export const dashboardMetricsResponseSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  timeZone: z.string(),
  totalAppointments: z.number().int(),
  scheduledAppointments: z.number().int(),
  completedAppointments: z.number().int(),
  cancelledAppointments: z.number().int(),
  noShowAppointments: z.number().int(),
  noShowRate: z.number().nullable(),
});

export type DashboardMetrics = z.infer<typeof dashboardMetricsResponseSchema>;

export class DashboardApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DashboardApiError";
  }
}

export async function getDashboardMetrics(
  orgSlug: string,
  period?: "today" | "week" | "month",
): Promise<DashboardMetrics> {
  const token = await getSessionToken();
  if (!token) {
    throw new DashboardApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const selectedPeriod = period || "today";
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/dashboard/metrics?period=${encodeURIComponent(selectedPeriod)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DashboardApiError(
      "UNAVAILABLE",
      "Não foi possível carregar os dados do dashboard. Tente novamente.",
    );
  }

  if (!response.ok) {
    const code =
      response.status === 401
        ? "UNAUTHENTICATED"
        : response.status === 403 || response.status === 404
          ? "NOT_FOUND"
          : "UNAVAILABLE";
    throw new DashboardApiError(
      code,
      code === "UNAUTHENTICATED"
        ? "Entre novamente para continuar."
        : code === "NOT_FOUND"
          ? "Você não tem permissão para acessar os dados desta clínica."
          : "Não foi possível carregar os dados do dashboard.",
    );
  }

  const data: unknown = await response.json();
  const parsed = dashboardMetricsResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new DashboardApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao carregar indicadores.",
    );
  }

  return parsed.data;
}
