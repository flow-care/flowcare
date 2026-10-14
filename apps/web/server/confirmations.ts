import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export const confirmationDecisionStatusSchema = z.enum([
  "PENDING",
  "CONFIRMED",
  "DECLINED",
]);

export type ConfirmationDecisionStatus = z.infer<
  typeof confirmationDecisionStatusSchema
>;

export const confirmationDecisionOriginSchema = z.enum([
  "PHONE_CALL",
  "WHATSAPP_MANUAL",
  "IN_PERSON",
  "OTHER",
]);

export type ConfirmationDecisionOrigin = z.infer<
  typeof confirmationDecisionOriginSchema
>;

export const rawConfirmationItemSchema = z.object({
  id: z.string(),
  appointmentId: z.string(),
  organizationId: z.string(),
  patientId: z.string(),
  professionalId: z.string(),
  scheduledAt: z.string(),
  localScheduledAt: z.string(),
  durationMinutes: z.number().int(),
  appointmentStatus: z.string(),
  status: confirmationDecisionStatusSchema,
  decision: confirmationDecisionStatusSchema,
  origin: confirmationDecisionOriginSchema.nullable().optional(),
  source: confirmationDecisionOriginSchema.nullable().optional(),
  originalMessage: z.string().nullable().optional(),
  originalMessageId: z.string().nullable().optional(),
  originalMessageAt: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  decidedById: z.string().nullable().optional(),
  decidedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const pendingConfirmationsResponseSchema = z.object({
  timeZone: z.string(),
  data: z.array(rawConfirmationItemSchema),
  pageInfo: z
    .object({
      nextCursor: z.string().nullable().optional(),
      hasNextPage: z.boolean().optional(),
    })
    .optional(),
});

export const confirmationDecisionResponseSchema = z.object({
  confirmation: rawConfirmationItemSchema,
});

export interface PendingConfirmationItem
  extends z.infer<typeof rawConfirmationItemSchema> {
  patientName: string;
  patientPhone: string | null;
  professionalName: string;
}

export interface PendingConfirmationsResult {
  timeZone: string;
  data: PendingConfirmationItem[];
  pageInfo?: {
    nextCursor: string | null;
    hasNextPage: boolean;
  };
}

export type ManualConfirmationDecision =
  | "CONFIRMED"
  | "CANCELLED"
  | "NO_RESPONSE"
  | "DECLINED"
  | "PENDING";

export class ConfirmationsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ConfirmationsApiError";
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

async function fetchMetadataMaps(
  apiBaseUrl: string,
  token: string,
  orgSlug: string,
): Promise<
  [Map<string, { fullName: string; phone: string | null }>, Map<string, string>]
> {
  const patientsMap = new Map<
    string,
    { fullName: string; phone: string | null }
  >();
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
          patientsMap.set(p.id, {
            fullName: p.fullName,
            phone: p.phone ?? null,
          });
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

  void results;

  return [patientsMap, professionalsMap];
}

export interface GetPendingConfirmationsQuery {
  startDate?: string;
  endDate?: string;
  status?: ConfirmationDecisionStatus;
  professionalId?: string;
  limit?: number;
  cursor?: string;
}

export async function getPendingConfirmations(
  orgSlug: string,
  query?: GetPendingConfirmationsQuery,
): Promise<PendingConfirmationsResult> {
  const token = await getSessionToken();
  if (!token) {
    throw new ConfirmationsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  const searchParams = new URLSearchParams();
  if (query?.status) searchParams.set("status", query.status);
  if (query?.professionalId)
    searchParams.set("professionalId", query.professionalId);
  if (query?.limit) searchParams.set("limit", String(query.limit));
  if (query?.cursor) searchParams.set("cursor", query.cursor);

  const queryString = searchParams.toString()
    ? `?${searchParams.toString()}`
    : "";
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/appointments/confirmations/pending${queryString}`;

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
    throw new ConfirmationsApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível conectar ao servidor de confirmações.",
    );
  }

  if (!response.ok) {
    throw new ConfirmationsApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível carregar as confirmações pendentes da clínica.",
    );
  }

  const json = await response.json();
  const parsed = pendingConfirmationsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ConfirmationsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida recebida do servidor de confirmações.",
    );
  }

  const [patientsMap, professionalsMap] = await fetchMetadataMaps(
    apiBaseUrl,
    token,
    orgSlug,
  );

  let enrichedData: PendingConfirmationItem[] = parsed.data.data.map((item) => {
    const patientMeta = patientsMap.get(item.patientId);
    const patientName =
      patientMeta?.fullName ?? `Paciente #${item.patientId.slice(0, 8)}`;
    const patientPhone = patientMeta?.phone ?? null;
    const professionalName =
      professionalsMap.get(item.professionalId) ??
      `Profissional #${item.professionalId.slice(0, 8)}`;

    return {
      ...item,
      patientName,
      patientPhone,
      professionalName,
    };
  });

  const filterStartDate = query?.startDate;
  if (filterStartDate) {
    enrichedData = enrichedData.filter(
      (item) => item.localScheduledAt.slice(0, 10) >= filterStartDate,
    );
  }
  const filterEndDate = query?.endDate;
  if (filterEndDate) {
    enrichedData = enrichedData.filter(
      (item) => item.localScheduledAt.slice(0, 10) <= filterEndDate,
    );
  }

  return {
    timeZone: parsed.data.timeZone,
    data: enrichedData,
    pageInfo: parsed.data.pageInfo
      ? {
          nextCursor: parsed.data.pageInfo.nextCursor ?? null,
          hasNextPage: Boolean(parsed.data.pageInfo.hasNextPage),
        }
      : undefined,
  };
}

export async function recordManualConfirmation(
  orgSlug: string,
  appointmentId: string,
  decision: ManualConfirmationDecision,
  notes?: string,
  origin: ConfirmationDecisionOrigin = "PHONE_CALL",
) {
  const token = await getSessionToken();
  if (!token) {
    throw new ConfirmationsApiError(
      "UNAUTHENTICATED",
      "Sessão expirada. Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();

  let apiDecision: ConfirmationDecisionStatus;
  if (decision === "CANCELLED" || decision === "DECLINED") {
    apiDecision = "DECLINED";
  } else if (decision === "NO_RESPONSE" || decision === "PENDING") {
    apiDecision = "PENDING";
  } else {
    apiDecision = "CONFIRMED";
  }

  const payload: Record<string, unknown> = {
    decision: apiDecision,
    origin,
  };

  if (notes && notes.trim().length > 0) {
    payload.note = notes.trim();
  }

  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/appointments/${encodeURIComponent(appointmentId)}/confirmation`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
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
    throw new ConfirmationsApiError(
      "UPSTREAM_UNAVAILABLE",
      "Não foi possível conectar ao servidor para registrar a confirmação.",
    );
  }

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    const code = errorJson?.error?.code ?? "UPSTREAM_UNAVAILABLE";
    const message =
      errorJson?.error?.message ??
      "Falha ao registrar a decisão de confirmação manual.";
    throw new ConfirmationsApiError(code, message);
  }

  const json = await response.json();
  const parsed = confirmationDecisionResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new ConfirmationsApiError(
      "INVALID_RESPONSE",
      "Resposta inválida recebida ao registrar confirmação.",
    );
  }

  return {
    success: true,
    confirmation: parsed.data.confirmation,
  };
}
