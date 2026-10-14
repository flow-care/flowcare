import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export const appointmentStatusSchema = z.enum([
  "RESERVED",
  "CONFIRMED",
  "IN_PROGRESS",
  "CANCELLED",
  "COMPLETED",
  "NO_SHOW",
]);

export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const appointmentItemSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  professionalId: z.string(),
  scheduledAt: z.string(),
  localScheduledAt: z.string(),
  durationMinutes: z.number().int(),
  status: appointmentStatusSchema,
  version: z.number().int().optional(),
});

export type AppointmentItem = z.infer<typeof appointmentItemSchema> & {
  patientName?: string;
  professionalName?: string;
};

export const appointmentsResponseSchema = z.object({
  timeZone: z.string(),
  appointments: z.array(appointmentItemSchema),
  nextCursor: z.string().nullable().optional(),
});

export type AppointmentsResponse = z.infer<typeof appointmentsResponseSchema>;

export interface GetAppointmentsQuery {
  startDate: string;
  endDate: string;
  professionalId?: string;
}

export type AppointmentsResult = AppointmentItem[] & {
  timeZone: string;
  appointments: AppointmentItem[];
  nextCursor: string | null;
};

export class AppointmentsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppointmentsApiError";
  }
}

const patientsListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      fullName: z.string(),
      phone: z.string().optional().nullable(),
      cpf: z.string().optional().nullable(),
      email: z.string().optional().nullable(),
    }),
  ),
});

const membersListSchema = z.object({
  data: z.array(
    z.object({
      userId: z.string(),
      userName: z.string(),
      role: z.string().optional(),
    }),
  ),
});

const patientDetailSchema = z.object({
  patient: z.object({
    id: z.string(),
    fullName: z.string(),
    phone: z.string().optional().nullable(),
    cpf: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    birthDate: z.string().optional().nullable(),
  }),
});

export type PatientDetail = z.infer<typeof patientDetailSchema>["patient"];

export async function getAppointments(
  orgSlug: string,
  query: GetAppointmentsQuery,
): Promise<AppointmentsResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new AppointmentsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams({
    startDate: query.startDate,
    endDate: query.endDate,
  });
  if (query.professionalId) {
    searchParams.set("professionalId", query.professionalId);
  }

  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/appointments?${searchParams.toString()}`,
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
    throw new AppointmentsApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível conectar ao servidor de agendamentos.",
    );
  }

  if (!response.ok) {
    throw new AppointmentsApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível carregar os agendamentos da clínica.",
    );
  }

  const json = await response.json();
  const parsed = appointmentsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppointmentsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida recebida do servidor de agendamentos.",
    );
  }

  const appointments = parsed.data.appointments;

  // Enrich with patient and professional names
  const [patientsMap, professionalsMap] = await fetchMetadataMaps(
    apiBaseUrl,
    token,
    orgSlug,
  );

  const enrichedAppointments: AppointmentItem[] = appointments.map((appt) => {
    const patientName =
      patientsMap.get(appt.patientId) ??
      `Paciente #${appt.patientId.slice(0, 8)}`;
    const professionalName =
      professionalsMap.get(appt.professionalId) ??
      `Profissional #${appt.professionalId.slice(0, 8)}`;
    return {
      ...appt,
      patientName,
      professionalName,
    };
  });

  const timeZone = parsed.data.timeZone;
  const nextCursor = parsed.data.nextCursor ?? null;

  return Object.assign([...enrichedAppointments], {
    timeZone,
    nextCursor,
    appointments: enrichedAppointments,
  });
}

async function fetchMetadataMaps(
  apiBaseUrl: string,
  token: string,
  orgSlug: string,
): Promise<[Map<string, string>, Map<string, string>]> {
  const patientsMap = new Map<string, string>();
  const professionalsMap = new Map<string, string>();

  const results = await Promise.allSettled([
    fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients?limit=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    ).then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      const parsed = patientsListSchema.safeParse(data);
      if (parsed.success) {
        for (const p of parsed.data.data) {
          patientsMap.set(p.id, p.fullName);
        }
      }
    }),
    fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/members`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    ).then(async (res) => {
      if (!res.ok) return;
      const data = await res.json();
      const parsed = membersListSchema.safeParse(data);
      if (parsed.success) {
        for (const m of parsed.data.data) {
          professionalsMap.set(m.userId, m.userName);
        }
      }
    }),
  ]);

  // Silently ignore failures as this is progressive enhancement
  void results;

  return [patientsMap, professionalsMap];
}

export async function getPatientDetails(
  orgSlug: string,
  patientId: string,
): Promise<PatientDetail | null> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { apiBaseUrl } = getServerConfig();
    const response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!response.ok) return null;
    const json = await response.json();
    const parsed = patientDetailSchema.safeParse(json);
    return parsed.success ? parsed.data.patient : null;
  } catch {
    return null;
  }
}
