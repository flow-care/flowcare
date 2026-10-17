import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export * from "@/lib/organization-settings";

import {
  type OrganizationSettings,
  type UpdateOrganizationSettingsPayload,
  validateLogoFile,
} from "@/lib/organization-settings";

export class OrganizationSettingsApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OrganizationSettingsApiError";
  }
}

const clinicLogoMetadataSchema = z.object({
  contentType: z.string(),
  sizeBytes: z.number().int(),
  updatedAt: z.string(),
});

const stringOrEmpty = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => v ?? "");

export const organizationSettingsSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  version: z.number().int().min(0),
  completed: z.boolean().default(false),
  legalName: stringOrEmpty,
  taxId: stringOrEmpty,
  contactEmail: stringOrEmpty,
  contactPhone: stringOrEmpty,
  postalCode: stringOrEmpty,
  state: stringOrEmpty,
  city: stringOrEmpty,
  district: stringOrEmpty,
  street: stringOrEmpty,
  streetNumber: stringOrEmpty,
  addressComplement: stringOrEmpty,
  logo: clinicLogoMetadataSchema.nullable().default(null),
  logoUrl: z.string().nullable().optional(),
});

export async function getOrganizationLogoUrl(
  orgSlug: string,
): Promise<string | null> {
  const token = await getSessionToken();
  if (!token) return null;
  const { apiBaseUrl } = getServerConfig();
  try {
    const response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/settings/logo/download-url`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data?.downloadUrl === "string" ? data.downloadUrl : null;
  } catch {
    return null;
  }
}

export async function getOrganizationSettings(
  orgSlug: string,
): Promise<OrganizationSettings> {
  const token = await getSessionToken();
  if (!token) {
    throw new OrganizationSettingsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }
  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/settings`,
      {
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
    throw new OrganizationSettingsApiError(
      "UNAVAILABLE",
      "Não foi possível acessar a clínica. Tente novamente.",
    );
  }

  if (response.status === 401) {
    throw new OrganizationSettingsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }
  if (response.status === 403) {
    throw new OrganizationSettingsApiError(
      "FORBIDDEN",
      "Acesso restrito a administradores da clínica.",
    );
  }
  if (response.status === 404) {
    throw new OrganizationSettingsApiError(
      "NOT_FOUND",
      "Clínica não encontrada.",
    );
  }
  if (!response.ok) {
    throw new OrganizationSettingsApiError(
      "API_ERROR",
      "Não foi possível carregar as configurações da clínica.",
    );
  }

  const raw = await response.json();
  const parsed = organizationSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrganizationSettingsApiError(
      "UNAVAILABLE",
      "Resposta inválida da clínica.",
    );
  }

  const settings = parsed.data;
  if (settings.logo) {
    try {
      const logoUrl = await getOrganizationLogoUrl(orgSlug);
      settings.logoUrl = logoUrl;
    } catch {
      // Non-fatal
    }
  }

  return settings;
}

export async function updateOrganizationSettings(
  orgSlug: string,
  payload: UpdateOrganizationSettingsPayload,
): Promise<OrganizationSettings> {
  const token = await getSessionToken();
  if (!token) {
    throw new OrganizationSettingsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/settings`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new OrganizationSettingsApiError(
      "UNAVAILABLE",
      "Não foi possível salvar as alterações. Verifique sua conexão.",
    );
  }

  if (response.status === 401) {
    throw new OrganizationSettingsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }
  if (response.status === 403) {
    throw new OrganizationSettingsApiError(
      "FORBIDDEN",
      "Acesso restrito a administradores da clínica.",
    );
  }
  if (response.status === 404) {
    throw new OrganizationSettingsApiError(
      "NOT_FOUND",
      "Clínica não encontrada.",
    );
  }
  if (response.status === 409) {
    throw new OrganizationSettingsApiError(
      "CONFLICT",
      "Os dados foram alterados em outra sessão. Recarregue a página para obter a versão mais recente.",
    );
  }
  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    const message =
      errorJson?.error?.message ??
      errorJson?.message ??
      "Não foi possível salvar as configurações da clínica.";
    throw new OrganizationSettingsApiError("VALIDATION_ERROR", message);
  }

  const raw = await response.json();
  const parsed = organizationSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OrganizationSettingsApiError(
      "UNAVAILABLE",
      "Resposta inválida da clínica após atualização.",
    );
  }

  const settings = parsed.data;
  if (settings.logo) {
    try {
      const logoUrl = await getOrganizationLogoUrl(orgSlug);
      settings.logoUrl = logoUrl;
    } catch {
      // Non-fatal
    }
  }

  return settings;
}

export async function uploadOrganizationLogo(
  orgSlug: string,
  formData: FormData,
): Promise<{
  success: boolean;
  logoUrl?: string;
  settings?: OrganizationSettings;
}> {
  const token = await getSessionToken();
  if (!token) {
    throw new OrganizationSettingsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    throw new OrganizationSettingsApiError(
      "VALIDATION_ERROR",
      "Nenhum arquivo de logotipo fornecido.",
    );
  }

  const validation = validateLogoFile(file as unknown as File);
  if (!validation.valid) {
    throw new OrganizationSettingsApiError(
      validation.error?.includes("5MB")
        ? "PAYLOAD_TOO_LARGE"
        : "VALIDATION_ERROR",
      validation.error ?? "Arquivo inválido.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/settings/logo`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        body: formData,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch {
    throw new OrganizationSettingsApiError(
      "UNAVAILABLE",
      "Erro de conexão ao enviar o logotipo.",
    );
  }

  if (response.status === 401) {
    throw new OrganizationSettingsApiError(
      "UNAUTHENTICATED",
      "Entre novamente para continuar.",
    );
  }
  if (response.status === 403) {
    throw new OrganizationSettingsApiError(
      "FORBIDDEN",
      "Acesso restrito a administradores da clínica.",
    );
  }
  if (response.status === 404) {
    throw new OrganizationSettingsApiError(
      "NOT_FOUND",
      "Clínica não encontrada.",
    );
  }
  if (response.status === 413) {
    throw new OrganizationSettingsApiError(
      "PAYLOAD_TOO_LARGE",
      "O arquivo excede o limite máximo permitido de 5MB.",
    );
  }
  if (response.status === 503) {
    throw new OrganizationSettingsApiError(
      "STORAGE_UNAVAILABLE",
      "Armazenamento de arquivos temporariamente indisponível.",
    );
  }
  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    const message =
      errorJson?.error?.message ??
      errorJson?.message ??
      "Falha ao enviar o logotipo da clínica.";
    throw new OrganizationSettingsApiError("API_ERROR", message);
  }

  const raw = await response.json();
  const parsed = organizationSettingsSchema.safeParse(raw);
  const settings = parsed.success ? parsed.data : undefined;

  let logoUrl: string | undefined;
  try {
    const fetchedUrl = await getOrganizationLogoUrl(orgSlug);
    if (fetchedUrl) logoUrl = fetchedUrl;
    if (settings && logoUrl) settings.logoUrl = logoUrl;
  } catch {
    // Non-fatal
  }

  return {
    success: true,
    logoUrl,
    settings,
  };
}
