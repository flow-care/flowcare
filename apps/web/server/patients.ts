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

export const patientDetailSchema = z.object({
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

export const patientOverviewDataSchema = z.object({
  patient: patientDetailSchema,
  contact: z.object({
    phone: z.string(),
    email: z.string().nullable().optional(),
  }),
  address: z
    .object({
      street: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      state: z.string().nullable().optional(),
      postalCode: z.string().nullable().optional(),
    })
    .optional(),
  activeInsurance: z
    .object({
      name: z.string(),
      number: z.string().nullable().optional(),
      expiration: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  allergies: z.array(z.string()).default([]),
  comorbidities: z.array(z.string()).default([]),
  clinicalAlerts: z.array(z.string()).default([]),
  medicalNotes: z.string().nullable().optional(),
  upcomingAppointments: z.array(patientAppointmentOverviewSchema).default([]),
  recentConsultations: z.array(patientConsultationOverviewSchema).default([]),
  isRestricted: z.boolean().default(false),
});

export type PatientOverviewData = z.infer<typeof patientOverviewDataSchema>;

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
      ? rawData.patient
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
      patient.phone,
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
              if (
                typeof ovData.medicalNotes === "string" ||
                ovData.medicalNotes === null
              )
                medicalNotes = ovData.medicalNotes as string | null;
              if (
                upcomingAppointments.length === 0 &&
                Array.isArray(ovData.upcomingAppointments)
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
          // ignore error in auxiliary enrichment
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
    patient,
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
  };
}

export const timelineEventItemSchema = z.object({
  id: z.string(),
  eventType: z.enum(["CONSULTATION", "DOCUMENT", "ATTACHMENT", "APPOINTMENT"]),
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
): Promise<PatientTimelineResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}/timeline`;

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
    return {
      data: [],
      pageInfo: { limit: 0, hasNextPage: false, nextCursor: null },
    };
  }

  const json = await response.json().catch(() => null);
  const data =
    json && typeof json === "object" ? (json as Record<string, unknown>) : null;
  const events = (data?.data ?? data?.events ?? []) as TimelineEventItem[];
  const pageInfo = data?.pageInfo as Record<string, unknown> | undefined;
  return {
    data: Array.isArray(events) ? events : [],
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
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  status: z.string().optional(),
  createdAt: z.string(),
});

export type PatientAttachmentItem = z.infer<typeof patientAttachmentItemSchema>;

export interface PatientAttachmentsResult {
  data: PatientAttachmentItem[];
  isRestricted?: boolean;
}

export async function getPatientAttachments(
  orgSlug: string,
  patientId: string,
): Promise<PatientAttachmentsResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new PatientsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}/attachments`;

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
