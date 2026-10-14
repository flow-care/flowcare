import "server-only";

import { z } from "zod";
import {
  addDays,
  getTodayDateString,
  isValidDateString,
} from "@/lib/appointments";
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
  notes: z.string().nullable().optional(),
  queueStatus: z.string().nullable().optional(),
  arrivedAt: z.string().nullable().optional(),
  cancellationReason: z.string().nullable().optional(),
  cancelledAt: z.string().nullable().optional(),
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

export interface AppointmentDetails {
  id: string;
  patientId: string;
  professionalId: string;
  scheduledAt: string;
  localScheduledAt: string;
  durationMinutes: number;
  status: AppointmentStatus;
  version?: number;
  notes?: string | null;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  queueStatus?: string | null;
  arrivedAt?: string | null;
  patientName?: string;
  professionalName?: string;
  patient?: PatientDetail | null;
  professional?: {
    id: string;
    fullName: string;
    role?: string | null;
    specialty?: string | null;
  } | null;
}

export const cancelAppointmentInputSchema = z.object({
  cancellationReason: z
    .string()
    .trim()
    .min(10, "A justificativa deve ter pelo menos 10 caracteres."),
  version: z.number().int().min(0),
});

export const cancelAppointmentResponseSchema = z.object({
  status: z.literal("CANCELLED"),
  cancellationReason: z.string(),
  cancelledAt: z.string(),
  cancelledById: z.string().optional(),
  version: z.number().int(),
});

export type CancelAppointmentResponse = z.infer<
  typeof cancelAppointmentResponseSchema
>;

export async function cancelAppointment(
  orgSlug: string,
  appointmentId: string,
  input: { cancellationReason: string; version: number },
): Promise<CancelAppointmentResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new AppointmentsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Entre novamente para continuar.",
    );
  }

  const parsed = cancelAppointmentInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppointmentsApiError(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Justificativa inválida.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/appointments/${encodeURIComponent(appointmentId)}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(parsed.data),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new AppointmentsApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível conectar ao servidor para cancelar o agendamento.",
    );
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new AppointmentsApiError(
        "NOT_FOUND",
        "Agendamento não encontrado.",
      );
    }
    if (response.status === 409) {
      throw new AppointmentsApiError(
        "INVALID_STATE_TRANSITION",
        "Agendamento encerrado ou em estado conflitante não pode ser cancelado.",
      );
    }
    throw new AppointmentsApiError(
      "UPSTREAM_ERROR",
      "Não foi possível cancelar o agendamento.",
    );
  }

  const json = await response.json();
  const parsedResponse = cancelAppointmentResponseSchema.safeParse(json);
  if (!parsedResponse.success) {
    throw new AppointmentsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida recebida ao cancelar o agendamento.",
    );
  }

  return parsedResponse.data;
}

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

export async function getAppointmentDetails(
  orgSlug: string,
  appointmentId: string,
  options?: {
    hintDate?: string;
    initialAppointment?: AppointmentItem | null;
  },
): Promise<AppointmentDetails | null> {
  if (!appointmentId || !UUID_REGEX.test(appointmentId)) {
    return null;
  }

  const token = await getSessionToken();
  if (!token) {
    throw new AppointmentsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Entre novamente para continuar.",
    );
  }

  let appointment = options?.initialAppointment;
  if (!appointment || appointment.id !== appointmentId) {
    const baseDate =
      options?.hintDate && isValidDateString(options.hintDate)
        ? options.hintDate
        : getTodayDateString();

    const startDate = addDays(baseDate, -14);
    const endDate = addDays(baseDate, 15);

    try {
      const list = await getAppointments(orgSlug, { startDate, endDate });
      appointment =
        (list.appointments ?? list).find((item) => item.id === appointmentId) ??
        null;
    } catch {
      appointment = null;
    }
  }

  if (!appointment) {
    return null;
  }

  const { apiBaseUrl } = getServerConfig();

  const [patient, memberData, queueData] = await Promise.allSettled([
    getPatientDetails(orgSlug, appointment.patientId),
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
    ).then(async (res) => (res.ok ? res.json() : null)),
    fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/appointments/queue?date=${appointment.localScheduledAt.slice(0, 10)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    ).then(async (res) => (res.ok ? res.json() : null)),
  ]);

  const patientDetail = patient.status === "fulfilled" ? patient.value : null;

  let professionalDetail: AppointmentDetails["professional"] = null;
  if (memberData.status === "fulfilled" && memberData.value) {
    const parsedMembers = membersListSchema.safeParse(memberData.value);
    if (parsedMembers.success) {
      const member = parsedMembers.data.data.find(
        (m) => m.userId === appointment.professionalId,
      );
      if (member) {
        professionalDetail = {
          id: member.userId,
          fullName: member.userName,
          role: member.role,
          specialty:
            member.role === "ADMIN_PROFESSIONAL" ||
            member.role === "PROFESSIONAL"
              ? "Profissional Clínico"
              : (member.role ?? "Profissional"),
        };
      }
    }
  }

  if (!professionalDetail) {
    professionalDetail = {
      id: appointment.professionalId,
      fullName: appointment.professionalName ?? "Profissional",
      role: null,
      specialty: "Profissional de Saúde",
    };
  }

  let queueStatus = appointment.queueStatus ?? null;
  let arrivedAt = appointment.arrivedAt ?? null;

  if (queueData.status === "fulfilled" && queueData.value) {
    const qList = (
      queueData.value as {
        queue?: Array<{
          appointmentId?: string;
          id?: string;
          queueStatus?: string;
          arrivedAt?: string;
        }>;
      }
    )?.queue;
    if (Array.isArray(qList)) {
      const qItem = qList.find(
        (item) =>
          item.appointmentId === appointmentId || item.id === appointmentId,
      );
      if (qItem) {
        queueStatus = qItem.queueStatus ?? queueStatus;
        arrivedAt = qItem.arrivedAt ?? arrivedAt;
      }
    }
  }

  return {
    ...appointment,
    patient: patientDetail ?? {
      id: appointment.patientId,
      fullName: appointment.patientName ?? "Paciente",
      phone: null,
      cpf: null,
      email: null,
      birthDate: null,
    },
    professional: professionalDetail,
    queueStatus,
    arrivedAt,
  };
}
