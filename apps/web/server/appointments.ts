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

export {
  type ConfirmationDecisionOrigin,
  type ConfirmationDecisionStatus,
  ConfirmationsApiError,
  getPendingConfirmations,
  type ManualConfirmationDecision,
  type PendingConfirmationItem,
  type PendingConfirmationsResult,
  recordManualConfirmation,
} from "./confirmations";

export const patientSearchResultSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  cpf: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  birthDate: z.string().nullable().optional(),
});

export type PatientSearchResultItem = z.infer<typeof patientSearchResultSchema>;

export async function searchPatients(
  orgSlug: string,
  term = "",
): Promise<PatientSearchResultItem[]> {
  const token = await getSessionToken();
  if (!token) {
    throw new AppointmentsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams();
  if (term.trim()) {
    searchParams.set("search", term.trim());
  }

  const queryString = searchParams.toString();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients${
    queryString ? `?${queryString}` : ""
  }`;

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
    throw new AppointmentsApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível conectar ao servidor de pacientes.",
    );
  }

  if (!response.ok) {
    throw new AppointmentsApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível carregar a lista de pacientes.",
    );
  }

  const json = await response.json();
  const parsed = z
    .object({ data: z.array(patientSearchResultSchema) })
    .safeParse(json);
  if (!parsed.success) {
    throw new AppointmentsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida recebida do servidor de pacientes.",
    );
  }

  return parsed.data.data;
}

export const professionalItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string().optional(),
});

export type ProfessionalItem = z.infer<typeof professionalItemSchema>;

const membersListFullSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().optional(),
      userId: z.string(),
      userName: z.string(),
      role: z.string(),
      status: z.string().optional(),
    }),
  ),
});

export async function getProfessionals(
  orgSlug: string,
): Promise<ProfessionalItem[]> {
  const token = await getSessionToken();
  if (!token) {
    throw new AppointmentsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/members`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch {
    throw new AppointmentsApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível buscar a lista de profissionais.",
    );
  }

  if (!response.ok) {
    throw new AppointmentsApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível carregar os profissionais da clínica.",
    );
  }

  const json = await response.json();
  const parsed = membersListFullSchema.safeParse(json);
  if (!parsed.success) {
    return [];
  }

  return parsed.data.data
    .filter(
      (m) =>
        (m.status === undefined || m.status === "ACTIVE") &&
        (m.role === "PROFESSIONAL" || m.role === "ADMIN_PROFESSIONAL"),
    )
    .map((m) => ({
      id: m.userId,
      name: m.userName,
      role: m.role,
    }));
}

export interface CreateAppointmentInput {
  patientId: string;
  professionalId: string;
  scheduledAt: string;
  durationMinutes: number;
  notes?: string | null;
  idempotencyKey?: string;
}

export const createAppointmentResponseSchema = z.object({
  timeZone: z.string(),
  appointment: z.object({
    id: z.string(),
    patientId: z.string(),
    professionalId: z.string(),
    scheduledAt: z.string(),
    durationMinutes: z.number(),
    status: appointmentStatusSchema,
    notes: z.string().nullable().optional(),
    createdAt: z.string().optional(),
  }),
});

export type CreateAppointmentResponse = z.infer<
  typeof createAppointmentResponseSchema
>;

export async function createAppointment(
  orgSlug: string,
  input: CreateAppointmentInput,
): Promise<CreateAppointmentResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new AppointmentsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const idempotencyKey = input.idempotencyKey || crypto.randomUUID();

  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/appointments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          patientId: input.patientId,
          professionalId: input.professionalId,
          scheduledAt: input.scheduledAt,
          durationMinutes: input.durationMinutes,
          notes: input.notes || null,
        }),
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

  const json = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 409) {
      const code = json?.error?.code || "SLOT_CONFLICT";
      const message =
        json?.error?.message ||
        "O horário selecionado conflita com outro agendamento do profissional.";
      throw new AppointmentsApiError(code, message);
    }

    if (response.status === 400) {
      throw new AppointmentsApiError(
        json?.error?.code || "VALIDATION_ERROR",
        json?.error?.message || "Dados de agendamento inválidos.",
      );
    }

    if (response.status === 401) {
      throw new AppointmentsApiError(
        "UNAUTHENTICATED",
        "Sessão expirada. Entre novamente para continuar.",
      );
    }

    if (response.status === 403) {
      throw new AppointmentsApiError(
        "FORBIDDEN",
        json?.error?.message ||
          "Você não tem permissão para criar agendamentos.",
      );
    }

    throw new AppointmentsApiError(
      json?.error?.code || "UPSTREAM_UNAVAILABLE",
      json?.error?.message || "Não foi possível criar o agendamento.",
    );
  }

  const parsed = createAppointmentResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppointmentsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao criar agendamento.",
    );
  }

  return parsed.data;
}

export const availabilityResponseSchema = z.object({
  date: z.string(),
  professionalId: z.string(),
  timeZone: z.string(),
  slots: z.array(
    z.object({
      startsAt: z.string(),
      endsAt: z.string(),
      localStartsAt: z.string(),
      localEndsAt: z.string(),
    }),
  ),
});

export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

export async function checkAvailability(
  orgSlug: string,
  query: { date: string; professionalId: string },
): Promise<AvailabilityResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new AppointmentsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams({
    date: query.date,
    professionalId: query.professionalId,
  });

  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/appointments/availability?${searchParams.toString()}`,
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
      "Não foi possível verificar a disponibilidade do profissional.",
    );
  }

  if (!response.ok) {
    throw new AppointmentsApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível carregar a disponibilidade.",
    );
  }

  const json = await response.json();
  const parsed = availabilityResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppointmentsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida recebida ao verificar disponibilidade.",
    );
  }

  return parsed.data;
}
