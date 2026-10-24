import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export const patientItemSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  cpf: z.string(),
  birthDate: z.string(),
  phone: z.string(),
  email: z.string().nullable().optional(),
  healthInsurance: z.string().nullable().optional(),
  insuranceNumber: z.string().nullable().optional(),
  version: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type PatientItem = z.infer<typeof patientItemSchema>;

export const listPatientsResponseSchema = z.object({
  data: z.array(patientItemSchema),
  pageInfo: z.object({
    nextCursor: z.string().nullable(),
    hasNextPage: z.boolean(),
  }),
});

export type ListPatientsResponse = z.infer<typeof listPatientsResponseSchema>;

export interface GetPatientsQuery {
  search?: string;
  cursor?: string;
  limit?: number;
}

export class PatientsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PatientsApiError";
  }
}

export async function getPatients(
  orgSlug: string,
  query: GetPatientsQuery = {},
): Promise<ListPatientsResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams();

  if (query.search?.trim()) {
    searchParams.set("search", query.search.trim());
  }
  if (query.cursor) {
    searchParams.set("cursor", query.cursor);
  }
  if (query.limit && Number.isInteger(query.limit)) {
    searchParams.set("limit", String(query.limit));
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
    throw new PatientsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de pacientes.",
    );
  }

  if (!response.ok) {
    const code =
      response.status === 401
        ? "UNAUTHENTICATED"
        : response.status === 403
          ? "FORBIDDEN"
          : response.status === 404
            ? "NOT_FOUND"
            : "UNAVAILABLE";
    throw new PatientsApiError(
      code,
      code === "FORBIDDEN"
        ? "Você não tem permissão para visualizar os pacientes desta clínica."
        : code === "NOT_FOUND"
          ? "Clínica não encontrada."
          : "Não foi possível carregar os pacientes.",
    );
  }

  const data: unknown = await response.json().catch(() => null);
  const parsed = listPatientsResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new PatientsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor de pacientes.",
    );
  }

  return parsed.data;
}

export const createPatientResponseSchema = z.object({
  patient: z.object({
    id: z.string(),
    fullName: z.string(),
    cpf: z.string(),
    birthDate: z.string(),
    phone: z.string(),
    email: z.string().nullable().optional(),
    healthInsurance: z.string().nullable().optional(),
    insuranceNumber: z.string().nullable().optional(),
    version: z.number().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  }),
});

export type CreatePatientResponse = z.infer<typeof createPatientResponseSchema>;

export interface CreatePatientInput {
  fullName: string;
  cpf: string;
  birthDate: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  distinctPersonConfirmed?: boolean;
  idempotencyKey?: string;
}

export const checkPatientDuplicatesResponseSchema = z.object({
  isDuplicate: z.boolean(),
  existingPatientId: z.string().nullable().optional(),
  conflictField: z.string().nullable().optional(),
  message: z.string().nullable().optional(),
});

export type CheckPatientDuplicatesResponse = z.infer<
  typeof checkPatientDuplicatesResponseSchema
>;

export async function createPatient(
  orgSlug: string,
  input: CreatePatientInput,
): Promise<CreatePatientResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const idempotencyKey =
    input.idempotencyKey ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `patient_${Date.now()}`);

  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients`;

  const payload: Record<string, unknown> = {
    fullName: input.fullName.trim(),
    cpf: input.cpf.replace(/\D/g, "") || input.cpf,
    birthDate: input.birthDate,
    phone: input.phone.replace(/\D/g, "") || input.phone,
  };

  if (input.distinctPersonConfirmed !== undefined) {
    payload.distinctPersonConfirmed = input.distinctPersonConfirmed;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PatientsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de pacientes.",
    );
  }

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 409) {
      const err = json as {
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      const code = err?.error?.code || "POSSIBLE_DUPLICATE";
      const message =
        err?.error?.message ||
        "Foi encontrado um possível paciente duplicado nesta clínica.";
      throw new PatientsApiError(code, message, err?.error?.details);
    }

    if (response.status === 400) {
      const err = json as {
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      throw new PatientsApiError(
        err?.error?.code || "VALIDATION_ERROR",
        err?.error?.message || "Dados de cadastro inválidos.",
        err?.error?.details,
      );
    }

    if (response.status === 401) {
      throw new PatientsApiError(
        "UNAUTHENTICATED",
        "Entre novamente para continuar.",
      );
    }

    if (response.status === 403) {
      throw new PatientsApiError(
        "FORBIDDEN",
        "Você não tem permissão para cadastrar pacientes nesta clínica.",
      );
    }

    if (response.status === 404) {
      throw new PatientsApiError("NOT_FOUND", "Clínica não encontrada.");
    }

    const err = json as { error?: { code?: string; message?: string } } | null;
    throw new PatientsApiError(
      err?.error?.code || "UNAVAILABLE",
      err?.error?.message || "Não foi possível cadastrar o paciente.",
    );
  }

  const parsed = createPatientResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new PatientsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao criar paciente.",
    );
  }

  return parsed.data;
}

export async function checkPatientDuplicates(
  orgSlug: string,
  query: { document?: string; phone?: string },
): Promise<CheckPatientDuplicatesResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const document = query.document?.trim();
  const phone = query.phone?.trim();

  if (!document && !phone) {
    return { isDuplicate: false };
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/check-duplicates`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ...(document ? { document } : {}),
        ...(phone ? { phone } : {}),
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PatientsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de verificação de duplicidade.",
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new PatientsApiError(
        "UNAUTHENTICATED",
        "Entre novamente para continuar.",
      );
    }
    if (response.status === 403) {
      throw new PatientsApiError(
        "FORBIDDEN",
        "Você não tem permissão para verificar pacientes.",
      );
    }
    if (response.status === 404) {
      throw new PatientsApiError("NOT_FOUND", "Clínica não encontrada.");
    }
    throw new PatientsApiError(
      "UNAVAILABLE",
      "Não foi possível verificar duplicidades.",
    );
  }

  const json: unknown = await response.json().catch(() => null);

  const parsed = checkPatientDuplicatesResponseSchema.safeParse(json);
  if (parsed.success) {
    return parsed.data;
  }

  if (typeof json === "object" && json !== null) {
    const raw = json as Record<string, unknown>;
    const isDuplicate = Boolean(raw.isDuplicate ?? raw.duplicate);
    const existingPatientId =
      typeof raw.existingPatientId === "string"
        ? raw.existingPatientId
        : typeof raw.patientId === "string"
          ? raw.patientId
          : null;
    const conflictField =
      typeof raw.conflictField === "string"
        ? raw.conflictField
        : typeof raw.matchedOn === "string"
          ? raw.matchedOn
          : null;
    const message = typeof raw.message === "string" ? raw.message : null;

    return {
      isDuplicate,
      existingPatientId,
      conflictField,
      message,
    };
  }

  return { isDuplicate: false };
}

export const patientDetailSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  cpf: z.string().optional().default(""),
  birthDate: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  email: z.string().nullable().optional(),
  gender: z.string().nullable().optional(),
  healthInsurance: z.string().nullable().optional(),
  insuranceNumber: z.string().nullable().optional(),
  insuranceExpiration: z.string().nullable().optional(),
  address: z
    .object({
      street: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      state: z.string().nullable().optional(),
      postalCode: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  allergies: z.array(z.string()).optional(),
  comorbidities: z.array(z.string()).optional(),
  clinicalAlerts: z.array(z.string()).optional(),
  medicalNotes: z.string().nullable().optional(),
  version: z.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type PatientDetail = z.infer<typeof patientDetailSchema>;

export const patientAppointmentOverviewSchema = z.object({
  id: z.string(),
  scheduledAt: z.string(),
  durationMinutes: z.number().int().optional(),
  status: z.string(),
  professionalId: z.string().optional(),
  professionalName: z.string().nullable().optional(),
});

export type PatientAppointmentOverview = z.infer<
  typeof patientAppointmentOverviewSchema
>;

export const patientConsultationOverviewSchema = z.object({
  id: z.string(),
  scheduledAt: z.string(),
  status: z.string(),
  professionalId: z.string().optional(),
  professionalName: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
});

export type PatientConsultationOverview = z.infer<
  typeof patientConsultationOverviewSchema
>;

export const patientHistorySummarySchema = z.object({
  totalVisits: z.number(),
  lastVisitAt: z.string().nullable().optional(),
  lastProfessionalName: z.string().nullable().optional(),
  upcomingCount: z.number().optional(),
});

export type PatientHistorySummary = z.infer<typeof patientHistorySummarySchema>;

export const patientOverviewSchema = z.object({
  patient: patientDetailSchema,
  contact: z
    .object({
      phone: z.string().optional(),
      email: z.string().nullable().optional(),
    })
    .optional(),
  address: z
    .object({
      street: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      state: z.string().nullable().optional(),
      postalCode: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  activeInsurance: z
    .object({
      name: z.string(),
      number: z.string().nullable().optional(),
      expiration: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  healthInsurance: z.string().nullable().optional(),
  insuranceNumber: z.string().nullable().optional(),
  allergies: z.array(z.string()).default([]),
  comorbidities: z.array(z.string()).default([]),
  clinicalAlerts: z.array(z.string()).default([]),
  medicalNotes: z.string().nullable().optional(),
  clinicalSummary: z
    .object({
      allergies: z.array(z.string()).optional(),
      comorbidities: z.array(z.string()).optional(),
      clinicalAlerts: z.array(z.string()).optional(),
      medicalNotes: z.string().nullable().optional(),
    })
    .optional(),
  upcomingAppointments: z.array(patientAppointmentOverviewSchema).default([]),
  recentConsultations: z.array(patientConsultationOverviewSchema).default([]),
  isRestricted: z.boolean().default(false),
  /** Resumo do histórico sem conteúdo clínico (datas, profissional, tipo). */
  historySummary: patientHistorySummarySchema.optional(),
});

export type PatientOverview = z.infer<typeof patientOverviewSchema>;
export const patientOverviewDataSchema = patientOverviewSchema;
export type PatientOverviewData = PatientOverview;

export async function getPatientOverview(
  orgSlug: string,
  patientId: string,
): Promise<PatientOverviewData> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}`;

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
    throw new PatientsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de pacientes.",
    );
  }

  if (!response.ok) {
    const code =
      response.status === 401
        ? "UNAUTHENTICATED"
        : response.status === 403
          ? "FORBIDDEN"
          : response.status === 404
            ? "NOT_FOUND"
            : "UNAVAILABLE";
    throw new PatientsApiError(
      code,
      code === "FORBIDDEN"
        ? "Você não tem permissão para visualizar este paciente."
        : code === "NOT_FOUND"
          ? "Paciente não encontrado."
          : "Não foi possível carregar o paciente.",
    );
  }

  const rawJson = await response.json().catch(() => null);
  if (!rawJson || typeof rawJson !== "object") {
    throw new PatientsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor de pacientes.",
    );
  }
  const rawData = rawJson as Record<string, unknown>;

  const rawPatient =
    typeof rawData.patient === "object" && rawData.patient !== null
      ? (rawData.patient as Record<string, unknown>)
      : rawData;
  const parsedPatient = patientDetailSchema.safeParse(rawPatient);
  if (!parsedPatient.success) {
    throw new PatientsApiError(
      "INVALID_RESPONSE",
      "Formato de dados de paciente inválido.",
    );
  }

  const patient = parsedPatient.data;

  const rawContact =
    typeof rawData.contact === "object" && rawData.contact !== null
      ? (rawData.contact as Record<string, unknown>)
      : undefined;

  const contact = {
    phone:
      (typeof rawContact?.phone === "string" ? rawContact.phone : null) ??
      patient.phone ??
      "",
    email:
      (typeof rawContact?.email === "string" ? rawContact.email : null) ??
      patient.email ??
      null,
  };

  const healthInsurance =
    (typeof rawData.healthInsurance === "string"
      ? rawData.healthInsurance
      : null) ?? patient.healthInsurance;
  const insuranceNumber =
    (typeof rawData.insuranceNumber === "string"
      ? rawData.insuranceNumber
      : null) ?? patient.insuranceNumber;
  const rawActiveInsurance =
    typeof rawData.activeInsurance === "object" &&
    rawData.activeInsurance !== null
      ? (rawData.activeInsurance as Record<string, unknown>)
      : null;

  const activeInsurance =
    rawActiveInsurance !== null
      ? {
          name: String(rawActiveInsurance.name ?? ""),
          number:
            rawActiveInsurance.number !== undefined &&
            rawActiveInsurance.number !== null
              ? String(rawActiveInsurance.number)
              : null,
          expiration:
            rawActiveInsurance.expiration !== undefined &&
            rawActiveInsurance.expiration !== null
              ? String(rawActiveInsurance.expiration)
              : null,
        }
      : healthInsurance
        ? {
            name: healthInsurance,
            number: insuranceNumber ?? null,
            expiration:
              (typeof rawData.insuranceExpiration === "string"
                ? rawData.insuranceExpiration
                : null) ??
              patient.insuranceExpiration ??
              null,
          }
        : null;

  let allergies: string[] | undefined = Array.isArray(rawData.allergies)
    ? (rawData.allergies as string[])
    : patient.allergies;
  let comorbidities: string[] | undefined = Array.isArray(rawData.comorbidities)
    ? (rawData.comorbidities as string[])
    : patient.comorbidities;
  let clinicalAlerts: string[] | undefined = Array.isArray(
    rawData.clinicalAlerts,
  )
    ? (rawData.clinicalAlerts as string[])
    : patient.clinicalAlerts;
  let historySummary: PatientHistorySummary | undefined;
  let medicalNotes: string | null =
    (typeof rawData.medicalNotes === "string" ? rawData.medicalNotes : null) ??
    patient.medicalNotes ??
    null;

  let upcomingAppointments: PatientAppointmentOverview[] = Array.isArray(
    rawData.upcomingAppointments,
  )
    ? (rawData.upcomingAppointments as Array<Record<string, unknown>>).map(
        (item) => ({
          id: String(item.id),
          scheduledAt: String(item.scheduledAt),
          durationMinutes:
            item.durationMinutes !== undefined
              ? Number(item.durationMinutes)
              : undefined,
          status: String(item.status ?? "RESERVED"),
          professionalId:
            item.professionalId !== undefined
              ? String(item.professionalId)
              : undefined,
          professionalName:
            typeof item.professionalName === "string"
              ? item.professionalName
              : typeof (item.professional as Record<string, unknown>)
                    ?.fullName === "string"
                ? ((item.professional as Record<string, unknown>)
                    .fullName as string)
                : null,
        }),
      )
    : [];

  let recentConsultations: PatientConsultationOverview[] = Array.isArray(
    rawData.recentConsultations,
  )
    ? (rawData.recentConsultations as Array<Record<string, unknown>>).map(
        (item) => ({
          id: String(item.id),
          scheduledAt: String(item.scheduledAt),
          status: String(item.status ?? "COMPLETED"),
          professionalId:
            item.professionalId !== undefined
              ? String(item.professionalId)
              : undefined,
          professionalName:
            typeof item.professionalName === "string"
              ? item.professionalName
              : typeof (item.professional as Record<string, unknown>)
                    ?.fullName === "string"
                ? ((item.professional as Record<string, unknown>)
                    .fullName as string)
                : null,
          summary: typeof item.summary === "string" ? item.summary : null,
        }),
      )
    : [];

  const enrichmentTasks: Promise<void>[] = [];

  if (
    allergies === undefined &&
    comorbidities === undefined &&
    clinicalAlerts === undefined
  ) {
    enrichmentTasks.push(
      (async () => {
        try {
          const overviewRes = await fetch(
            `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}/overview`,
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
          if (overviewRes.ok) {
            const ovJson = await overviewRes.json().catch(() => null);
            if (ovJson && typeof ovJson === "object") {
              const ovData = ovJson as Record<string, unknown>;
              if (Array.isArray(ovData.allergies))
                allergies = ovData.allergies as string[];
              if (Array.isArray(ovData.comorbidities))
                comorbidities = ovData.comorbidities as string[];
              if (Array.isArray(ovData.clinicalAlerts))
                clinicalAlerts = ovData.clinicalAlerts as string[];
              if (typeof ovData.medicalNotes === "string")
                medicalNotes = ovData.medicalNotes;
              if (
                ovData.historySummary &&
                typeof ovData.historySummary === "object"
              ) {
                const hs = ovData.historySummary as Record<string, unknown>;
                historySummary = {
                  totalVisits: Number(hs.totalVisits ?? 0),
                  lastVisitAt:
                    typeof hs.lastVisitAt === "string" ? hs.lastVisitAt : null,
                  lastProfessionalName:
                    typeof hs.lastProfessionalName === "string"
                      ? hs.lastProfessionalName
                      : null,
                  upcomingCount:
                    hs.upcomingCount !== undefined
                      ? Number(hs.upcomingCount)
                      : undefined,
                };
              }
              if (
                Array.isArray(ovData.upcomingAppointments) &&
                upcomingAppointments.length === 0
              ) {
                upcomingAppointments = (
                  ovData.upcomingAppointments as Array<Record<string, unknown>>
                ).map((item) => ({
                  id: String(item.id),
                  scheduledAt: String(item.scheduledAt),
                  durationMinutes:
                    item.durationMinutes !== undefined
                      ? Number(item.durationMinutes)
                      : undefined,
                  status: String(item.status ?? "RESERVED"),
                  professionalId:
                    item.professionalId !== undefined
                      ? String(item.professionalId)
                      : undefined,
                  professionalName:
                    typeof item.professionalName === "string"
                      ? item.professionalName
                      : typeof (item.professional as Record<string, unknown>)
                            ?.fullName === "string"
                        ? ((item.professional as Record<string, unknown>)
                            .fullName as string)
                        : null,
                }));
              }
            }
          }
        } catch {
          // ignore
        }
      })(),
    );
  }

  if (recentConsultations.length === 0) {
    enrichmentTasks.push(
      (async () => {
        try {
          const consultRes = await fetch(
            `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/consultations?patientId=${encodeURIComponent(patientId)}&limit=5`,
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
          if (consultRes.ok) {
            const cJson = await consultRes.json().catch(() => null);
            if (cJson && typeof cJson === "object") {
              const cData = cJson as Record<string, unknown>;
              const items =
                cData.data ??
                cData.items ??
                (Array.isArray(cData) ? cData : []);
              if (Array.isArray(items) && items.length > 0) {
                recentConsultations = (
                  items as Array<Record<string, unknown>>
                ).map((c) => ({
                  id: String(c.id),
                  scheduledAt: String(c.scheduledAt ?? c.createdAt),
                  status: String(c.status ?? "COMPLETED"),
                  professionalId:
                    c.professionalId !== undefined
                      ? String(c.professionalId)
                      : undefined,
                  professionalName:
                    typeof (c.professional as Record<string, unknown>)
                      ?.fullName === "string"
                      ? ((c.professional as Record<string, unknown>)
                          .fullName as string)
                      : typeof c.professionalName === "string"
                        ? c.professionalName
                        : null,
                  summary:
                    typeof c.summary === "string"
                      ? c.summary
                      : typeof c.chiefComplaint === "string"
                        ? c.chiefComplaint
                        : null,
                }));
              }
            }
          }
        } catch {
          // ignore
        }
      })(),
    );
  }

  if (enrichmentTasks.length > 0) {
    await Promise.allSettled(enrichmentTasks);
  }

  const isRestricted =
    allergies === undefined &&
    comorbidities === undefined &&
    clinicalAlerts === undefined &&
    medicalNotes === null;

  return {
    patient: {
      ...patient,
      cpf: patient.cpf ?? "",
      birthDate: patient.birthDate ?? "",
      phone: patient.phone ?? "",
    },
    contact,
    address: patient.address ?? undefined,
    activeInsurance,
    allergies: allergies ?? [],
    comorbidities: comorbidities ?? [],
    clinicalAlerts: clinicalAlerts ?? [],
    medicalNotes,
    upcomingAppointments,
    recentConsultations,
    isRestricted,
    ...(historySummary ? { historySummary } : {}),
  };
}

export const timelineEventItemSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  timestamp: z.string(),
  professional: z
    .object({
      id: z.string(),
      name: z.string(),
      registrationNumber: z.string().nullable().optional(),
      professionalTitle: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  summary: z.string(),
  status: z.string(),
  resourceId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type TimelineEventItem = z.infer<typeof timelineEventItemSchema>;

export interface PatientTimelineFilters {
  type?: string;
  startDate?: string;
  endDate?: string;
}

export interface PatientTimelineResult {
  data: TimelineEventItem[];
  pageInfo: {
    limit: number;
    hasNextPage: boolean;
    nextCursor: string | null;
  };
  isRestricted?: boolean;
}

export async function getPatientTimeline(
  orgSlug: string,
  patientId: string,
  filters?: PatientTimelineFilters,
): Promise<PatientTimelineResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams();

  if (filters?.type && filters.type !== "all" && filters.type !== "ALL") {
    searchParams.set("type", filters.type);
  }
  if (filters?.startDate) {
    searchParams.set("startDate", filters.startDate);
  }
  if (filters?.endDate) {
    searchParams.set("endDate", filters.endDate);
  }

  const queryString = searchParams.toString();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}/timeline${
    queryString ? `?${queryString}` : ""
  }`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return {
      data: [],
      pageInfo: { limit: 0, hasNextPage: false, nextCursor: null },
    };
  }

  if (response.status === 401) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }
  if (response.status === 403) {
    return {
      data: [],
      pageInfo: { limit: 0, hasNextPage: false, nextCursor: null },
      isRestricted: true,
    };
  }
  if (!response.ok) {
    if (response.status === 404) {
      throw new PatientsApiError("NOT_FOUND", "Paciente não encontrado.");
    }
    const err = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    throw new PatientsApiError(
      err?.error?.code || "UNAVAILABLE",
      err?.error?.message ||
        "Não foi possível carregar o prontuário do paciente.",
    );
  }

  const json = await response.json().catch(() => null);
  const data =
    json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const events = (data?.data ?? data?.events ?? []) as TimelineEventItem[];
  const pageInfo = data?.pageInfo as Record<string, unknown> | undefined;

  const parsedEvents: TimelineEventItem[] = [];
  if (Array.isArray(events)) {
    for (const item of events) {
      const parsed = timelineEventItemSchema.safeParse(item);
      if (parsed.success) {
        parsedEvents.push(parsed.data);
      } else if (
        item &&
        typeof item === "object" &&
        "id" in item &&
        "eventType" in item
      ) {
        parsedEvents.push(item as TimelineEventItem);
      }
    }
  }

  return {
    data: parsedEvents,
    pageInfo: {
      limit: typeof pageInfo?.limit === "number" ? pageInfo.limit : 20,
      hasNextPage: Boolean(pageInfo?.hasNextPage),
      nextCursor:
        typeof pageInfo?.nextCursor === "string" ? pageInfo.nextCursor : null,
    },
    isRestricted: false,
  };
}

export const patientAttachmentItemSchema = z.object({
  id: z.string(),
  attachmentId: z.string().optional(),
  patientId: z.string().optional(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  uploadedById: z.string().optional(),
  status: z.string().optional(),
  archivedAt: z.string().nullable().optional(),
  archivedById: z.string().nullable().optional(),
  archiveReason: z.string().nullable().optional(),
  createdAt: z.string(),
});

export type PatientAttachmentItem = z.infer<typeof patientAttachmentItemSchema>;

export interface PatientAttachmentsResult {
  data: PatientAttachmentItem[];
  isRestricted?: boolean;
}

export interface GetPatientAttachmentsQuery {
  category?: string;
  includeArchived?: boolean;
}

export const PATIENT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // 25MB
export const ALLOWED_ATTACHMENT_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
] as const;

export function validateAttachmentFile(file: {
  name: string;
  size: number;
  type?: string;
}): { valid: boolean; error?: string } {
  const dotIndex = file.name.lastIndexOf(".");
  if (dotIndex === -1) {
    return {
      valid: false,
      error:
        "Extensão de arquivo não permitida. Apenas arquivos PDF, JPG e PNG são permitidos.",
    };
  }

  const extension = file.name.slice(dotIndex).toLowerCase();
  const isValidExt = ALLOWED_ATTACHMENT_EXTENSIONS.includes(
    extension as (typeof ALLOWED_ATTACHMENT_EXTENSIONS)[number],
  );
  if (!isValidExt) {
    return {
      valid: false,
      error: `Formato de arquivo (${extension}) não permitido. Apenas arquivos PDF, JPG e PNG são aceitos.`,
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      error: "O arquivo selecionado está vazio.",
    };
  }

  if (file.size > PATIENT_ATTACHMENT_MAX_BYTES) {
    return {
      valid: false,
      error: "O arquivo excede o tamanho máximo permitido de 25MB.",
    };
  }

  return { valid: true };
}

export async function getPatientAttachments(
  orgSlug: string,
  patientId: string,
  query?: GetPatientAttachmentsQuery,
): Promise<PatientAttachmentsResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams();
  if (query?.category) {
    searchParams.set("category", query.category);
  }
  if (query?.includeArchived) {
    searchParams.set("includeArchived", "true");
  }
  const queryString = searchParams.toString();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}/attachments${queryString ? `?${queryString}` : ""}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { data: [] };
  }

  if (response.status === 403) {
    return { data: [], isRestricted: true };
  }
  if (!response.ok) {
    if (response.status === 404) {
      throw new PatientsApiError("NOT_FOUND", "Paciente não encontrado.");
    }
    return { data: [] };
  }

  const json = await response.json().catch(() => null);
  const data =
    json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const items = (data?.data ??
    data?.attachments ??
    []) as PatientAttachmentItem[];
  return {
    data: Array.isArray(items) ? items : [],
    isRestricted: false,
  };
}

export interface AttachmentDownloadUrlResult {
  attachmentId: string;
  downloadUrl: string;
  expiresInSeconds?: number;
  expiresAt?: string;
}

export async function getAttachmentDownloadUrl(
  orgSlug: string,
  patientId: string,
  attachmentId: string,
): Promise<AttachmentDownloadUrlResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}/attachments/${encodeURIComponent(attachmentId)}/download-url`;

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
    throw new PatientsApiError(
      "SERVICE_UNAVAILABLE",
      "Erro de conexão ao obter link para download.",
    );
  }

  if (response.status === 401) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }
  if (response.status === 403) {
    throw new PatientsApiError(
      "FORBIDDEN",
      "Você não tem permissão para baixar este anexo.",
    );
  }
  if (response.status === 404) {
    throw new PatientsApiError("NOT_FOUND", "Anexo não encontrado.");
  }
  if (response.status === 503) {
    throw new PatientsApiError(
      "STORAGE_UNAVAILABLE",
      "Armazenamento indisponível.",
    );
  }
  if (!response.ok) {
    throw new PatientsApiError(
      "API_ERROR",
      "Falha ao obter URL de download do anexo.",
    );
  }

  const data = (await response.json()) as {
    attachmentId?: string;
    downloadUrl: string;
    expiresInSeconds?: number;
    expiresAt?: string;
  };
  return {
    attachmentId: data.attachmentId ?? attachmentId,
    downloadUrl: data.downloadUrl,
    expiresInSeconds: data.expiresInSeconds,
    expiresAt: data.expiresAt,
  };
}

export interface ArchivePatientAttachmentResult {
  archived: boolean;
  attachment: PatientAttachmentItem;
}

export async function archivePatientAttachment(
  orgSlug: string,
  patientId: string,
  attachmentId: string,
  reason?: string,
): Promise<ArchivePatientAttachmentResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}/attachments/${encodeURIComponent(attachmentId)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(reason ? { reason } : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PatientsApiError(
      "SERVICE_UNAVAILABLE",
      "Erro de conexão ao arquivar o anexo.",
    );
  }

  if (response.status === 401) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }
  if (response.status === 403) {
    throw new PatientsApiError(
      "FORBIDDEN",
      "Você não tem permissão para arquivar este anexo.",
    );
  }
  if (response.status === 404) {
    throw new PatientsApiError("NOT_FOUND", "Anexo não encontrado.");
  }
  if (!response.ok) {
    throw new PatientsApiError("API_ERROR", "Falha ao arquivar anexo.");
  }

  const data = (await response.json()) as {
    archived?: boolean;
    attachment: PatientAttachmentItem;
  };
  return {
    archived: Boolean(data.archived ?? true),
    attachment: data.attachment,
  };
}

export interface UploadPatientAttachmentResult {
  success: boolean;
  attachment?: PatientAttachmentItem;
}

export async function uploadPatientAttachment(
  orgSlug: string,
  patientId: string,
  formData: FormData,
): Promise<UploadPatientAttachmentResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    throw new PatientsApiError("VALIDATION_ERROR", "Nenhum arquivo fornecido.");
  }

  const validation = validateAttachmentFile(file as File);
  if (!validation.valid) {
    throw new PatientsApiError(
      "VALIDATION_ERROR",
      validation.error ?? "Arquivo inválido.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}/attachments`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      body: formData,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new PatientsApiError(
      "SERVICE_UNAVAILABLE",
      "Erro de conexão ao enviar o anexo.",
    );
  }

  if (response.status === 401) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }
  if (response.status === 403) {
    throw new PatientsApiError(
      "FORBIDDEN",
      "Você não tem permissão para anexar arquivos a este paciente.",
    );
  }
  if (response.status === 404) {
    throw new PatientsApiError("NOT_FOUND", "Paciente não encontrado.");
  }
  if (response.status === 413) {
    throw new PatientsApiError(
      "PAYLOAD_TOO_LARGE",
      "O arquivo excede o tamanho máximo permitido.",
    );
  }
  if (response.status === 503) {
    throw new PatientsApiError(
      "STORAGE_UNAVAILABLE",
      "Armazenamento indisponível.",
    );
  }
  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    const message =
      errorJson?.error?.message ??
      errorJson?.message ??
      "Falha ao enviar anexo.";
    throw new PatientsApiError("API_ERROR", message);
  }

  const data = await response.json();
  const attachment = (data.attachment ?? data) as PatientAttachmentItem;
  return {
    success: true,
    attachment,
  };
}

export interface UpdatePatientAddressInput {
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

export interface UpdatePatientInput {
  fullName?: string;
  phone?: string;
  email?: string | null;
  birthDate?: string;
  gender?: string | null;
  address?: UpdatePatientAddressInput | null;
  healthInsurance?: string | null;
  insuranceNumber?: string | null;
  insuranceExpiration?: string | null;
  version: number;
  cpf?: string;
  distinctPersonConfirmed?: boolean;
}

export const updatePatientResponseSchema = z.object({
  patient: z.object({
    id: z.string(),
    fullName: z.string(),
    cpf: z.string(),
    birthDate: z.string(),
    phone: z.string(),
    email: z.string().nullable().optional(),
    gender: z.string().nullable().optional(),
    healthInsurance: z.string().nullable().optional(),
    insuranceNumber: z.string().nullable().optional(),
    insuranceExpiration: z.string().nullable().optional(),
    address: z
      .object({
        street: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        state: z.string().nullable().optional(),
        postalCode: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    version: z.number().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  }),
});

export type UpdatePatientResponse = z.infer<typeof updatePatientResponseSchema>;

export async function updatePatient(
  orgSlug: string,
  patientId: string,
  input: UpdatePatientInput,
): Promise<UpdatePatientResponse> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}`;

  const payload: Record<string, unknown> = {
    version: input.version,
  };

  if (input.fullName !== undefined) {
    payload.fullName = input.fullName.trim();
  }
  if (input.phone !== undefined) {
    payload.phone = input.phone.replace(/\D/g, "") || input.phone;
  }
  if (input.birthDate !== undefined) {
    payload.birthDate = input.birthDate;
  }
  if (input.email !== undefined) {
    payload.email = input.email ? input.email.trim() : null;
  }
  if (input.gender !== undefined) {
    payload.gender = input.gender;
  }
  if (input.address !== undefined) {
    payload.address = input.address;
  }
  if (input.healthInsurance !== undefined) {
    payload.healthInsurance = input.healthInsurance
      ? input.healthInsurance.trim()
      : null;
  }
  if (input.insuranceNumber !== undefined) {
    payload.insuranceNumber = input.insuranceNumber
      ? input.insuranceNumber.trim()
      : null;
  }
  if (input.insuranceExpiration !== undefined) {
    payload.insuranceExpiration = input.insuranceExpiration;
  }
  if (input.cpf !== undefined) {
    payload.cpf = input.cpf.replace(/\D/g, "") || input.cpf;
  }
  if (input.distinctPersonConfirmed !== undefined) {
    payload.distinctPersonConfirmed = input.distinctPersonConfirmed;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new PatientsApiError(
      "UNAVAILABLE",
      "Não foi possível conectar ao servidor de pacientes.",
    );
  }

  const json: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 409) {
      const err = json as {
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      const code = err?.error?.code || "VERSION_CONFLICT";
      const message =
        code === "VERSION_CONFLICT"
          ? "Este paciente foi atualizado por outro usuário. Recarregue para ver os dados mais recentes."
          : err?.error?.message ||
            "Foi encontrado um conflito ao atualizar os dados do paciente.";
      throw new PatientsApiError(code, message, err?.error?.details);
    }

    if (response.status === 400) {
      const err = json as {
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      throw new PatientsApiError(
        err?.error?.code || "VALIDATION_ERROR",
        err?.error?.message || "Dados de cadastro inválidos.",
        err?.error?.details,
      );
    }

    if (response.status === 401) {
      throw new PatientsApiError(
        "UNAUTHENTICATED",
        "Entre novamente para continuar.",
      );
    }

    if (response.status === 403) {
      throw new PatientsApiError(
        "FORBIDDEN",
        "Você não tem permissão para alterar pacientes nesta clínica.",
      );
    }

    if (response.status === 404) {
      throw new PatientsApiError("NOT_FOUND", "Paciente não encontrado.");
    }

    const err = json as { error?: { code?: string; message?: string } } | null;
    throw new PatientsApiError(
      err?.error?.code || "UNAVAILABLE",
      err?.error?.message || "Não foi possível atualizar o paciente.",
    );
  }

  const parsed = updatePatientResponseSchema.safeParse(json);
  if (!parsed.success) {
    if (
      typeof json === "object" &&
      json !== null &&
      "id" in json &&
      "fullName" in json
    ) {
      return { patient: json as UpdatePatientResponse["patient"] };
    }
    throw new PatientsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida do servidor ao atualizar paciente.",
    );
  }

  return parsed.data;
}
