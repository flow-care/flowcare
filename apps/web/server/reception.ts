import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export const receptionQueueStatusSchema = z.enum([
  "WAITING",
  "ARRIVED",
  "CALLED",
  "IN_SERVICE",
  "COMPLETED",
  "NO_SHOW",
]);

export type ReceptionQueueStatus = z.infer<typeof receptionQueueStatusSchema>;

export type ReceptionQueueTargetStatus =
  | "WAITING"
  | "ARRIVED"
  | "CALLED"
  | "IN_SERVICE"
  | "IN_CONSULTATION"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export const receptionQueueItemSchema = z.object({
  id: z.string(),
  appointmentId: z.string(),
  patientId: z.string(),
  professionalId: z.string(),
  scheduledAt: z.string(),
  localScheduledAt: z.string(),
  durationMinutes: z.number().int(),
  status: z.string(),
  queueStatus: receptionQueueStatusSchema,
  arrivedAt: z.string().nullable().optional(),
  queueUpdatedAt: z.string().nullable().optional(),
  queueUpdatedById: z.string().nullable().optional(),
  version: z.number().int(),
});

export type ReceptionQueueItem = z.infer<typeof receptionQueueItemSchema> & {
  patientName?: string;
  professionalName?: string;
};

export const receptionQueueResponseSchema = z.object({
  date: z.string(),
  timeZone: z.string(),
  queue: z.array(receptionQueueItemSchema),
});

export type ReceptionQueueResponse = z.infer<
  typeof receptionQueueResponseSchema
>;

export type ReceptionQueueResult = ReceptionQueueItem[] & {
  date: string;
  timeZone: string;
  queue: ReceptionQueueItem[];
};

export class ReceptionApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ReceptionApiError";
  }
}

const patientsListSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      fullName: z.string(),
    }),
  ),
});

const membersListSchema = z.object({
  data: z.array(
    z.object({
      userId: z.string(),
      userName: z.string(),
    }),
  ),
});

async function fetchMetadataMaps(
  apiBaseUrl: string,
  token: string,
  orgSlug: string,
): Promise<[Map<string, string>, Map<string, string>]> {
  const patientsMap = new Map<string, string>();
  const professionalsMap = new Map<string, string>();

  await Promise.allSettled([
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

  return [patientsMap, professionalsMap];
}

export async function getReceptionQueue(
  orgSlug: string,
  date?: string,
): Promise<ReceptionQueueResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new ReceptionApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const queryParam = date ? `?date=${encodeURIComponent(date)}` : "";

  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/reception/queue${queryParam}`,
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
    throw new ReceptionApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível conectar ao servidor da recepção.",
    );
  }

  if (!response.ok) {
    let errorCode = "UPSTREAM_UNAVAILABLE";
    let errorMessage = "Não foi possível carregar a fila da recepção.";
    try {
      const errorJson = await response.json();
      if (errorJson?.error?.code) errorCode = errorJson.error.code;
      if (errorJson?.error?.message) errorMessage = errorJson.error.message;
    } catch {
      if (response.status === 401) errorCode = "UNAUTHENTICATED";
      if (response.status === 403) errorCode = "FORBIDDEN";
      if (response.status === 404) errorCode = "NOT_FOUND";
    }
    throw new ReceptionApiError(errorCode, errorMessage);
  }

  const json = await response.json();
  const parsed = receptionQueueResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ReceptionApiError(
      "INVALID_RESPONSE",
      "Resposta inválida recebida do servidor da recepção.",
    );
  }

  const items = parsed.data.queue;
  const [patientsMap, professionalsMap] = await fetchMetadataMaps(
    apiBaseUrl,
    token,
    orgSlug,
  );

  const enrichedItems: ReceptionQueueItem[] = items.map((item) => ({
    ...item,
    patientName:
      patientsMap.get(item.patientId) ??
      `Paciente #${item.patientId.slice(0, 8)}`,
    professionalName:
      professionalsMap.get(item.professionalId) ??
      `Profissional #${item.professionalId.slice(0, 8)}`,
  }));

  return Object.assign([...enrichedItems], {
    date: parsed.data.date,
    timeZone: parsed.data.timeZone,
    queue: enrichedItems,
  });
}

export async function updateReceptionQueueStatus(
  orgSlug: string,
  appointmentId: string,
  targetStatus: ReceptionQueueTargetStatus,
  version?: number,
): Promise<ReceptionQueueItem> {
  const token = await getSessionToken();
  if (!token) {
    throw new ReceptionApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const apiStatus =
    targetStatus === "IN_CONSULTATION" ? "IN_SERVICE" : targetStatus;

  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/reception/queue/${encodeURIComponent(appointmentId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          status: apiStatus,
          version: version ?? 0,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch {
    throw new ReceptionApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível conectar ao servidor da recepção.",
    );
  }

  if (!response.ok) {
    let errorCode = "UPSTREAM_ERROR";
    let errorMessage = "Não foi possível atualizar o status na recepção.";
    let errorDetails: unknown;
    try {
      const errorJson = await response.json();
      if (errorJson?.error?.code) errorCode = errorJson.error.code;
      if (errorJson?.error?.message) errorMessage = errorJson.error.message;
      if (errorJson?.error?.details) errorDetails = errorJson.error.details;
    } catch {
      if (response.status === 409) errorCode = "VERSION_CONFLICT";
      if (response.status === 403) errorCode = "FORBIDDEN";
      if (response.status === 404) errorCode = "NOT_FOUND";
    }
    throw new ReceptionApiError(errorCode, errorMessage, errorDetails);
  }

  const json = await response.json();
  const parsed = receptionQueueItemSchema.safeParse(json);
  if (parsed.success) {
    return parsed.data;
  }
  return json as ReceptionQueueItem;
}
