import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

const scheduleSchema = z.object({
  timezone: z.string(),
  weeklySchedule: z.array(
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

export type SchedulePayload = z.infer<typeof scheduleSchema>;

async function request(method: "GET" | "POST", input?: SchedulePayload) {
  const token = await getSessionToken();
  if (!token) throw new Error("Entre novamente para continuar.");
  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/onboarding/schedule-rules`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(input ? { "Content-Type": "application/json" } : {}),
      },
      body: input ? JSON.stringify(input) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Não foi possível acessar os horários da clínica.");
  }
  if (!response.ok) {
    throw new Error(
      response.status === 409
        ? "Esta etapa já foi concluída."
        : "Não foi possível salvar os horários da clínica.",
    );
  }
  const parsed = scheduleSchema.safeParse(await response.json());
  if (!parsed.success)
    throw new Error("Resposta inválida dos horários da clínica.");
  return parsed.data;
}

export const getOnboardingHours = () => request("GET");
export const saveOnboardingHours = (input: SchedulePayload) =>
  request("POST", input);
