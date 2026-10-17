import "server-only";

import type { UpdateProfilePayload, UserProfile } from "@/lib/account-profile";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export class AccountApiError extends Error {
  constructor(
    readonly code:
      | "UNAUTHENTICATED"
      | "VALIDATION_ERROR"
      | "NOT_FOUND"
      | "PAYLOAD_TOO_LARGE"
      | "STORAGE_UNAVAILABLE"
      | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "AccountApiError";
  }
}

export interface ProfilePhotoDownloadUrlResult {
  downloadUrl: string;
  expiresInSeconds?: number;
}

export async function getProfilePhotoDownloadUrl(): Promise<ProfilePhotoDownloadUrlResult | null> {
  const token = await getSessionToken();
  if (!token) {
    throw new AccountApiError(
      "UNAUTHENTICATED",
      "Sua sessão expirou. Entre novamente.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/me/profile/photo/download-url`, {
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
    throw new AccountApiError(
      "UNAVAILABLE",
      "Não foi possível obter a foto de perfil.",
    );
  }

  if (response.status === 401) {
    throw new AccountApiError(
      "UNAUTHENTICATED",
      "Sua sessão expirou. Entre novamente.",
    );
  }
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new AccountApiError(
      "UNAVAILABLE",
      "Não foi possível obter a foto de perfil.",
    );
  }

  const data = (await response.json()) as {
    downloadUrl: string;
    expiresInSeconds?: number;
  };

  return {
    downloadUrl: data.downloadUrl,
    expiresInSeconds: data.expiresInSeconds,
  };
}

export async function getProfile(): Promise<UserProfile> {
  const token = await getSessionToken();
  if (!token) {
    throw new AccountApiError(
      "UNAUTHENTICATED",
      "Sua sessão expirou. Entre novamente.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/me/profile`, {
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
    throw new AccountApiError(
      "UNAVAILABLE",
      "Não foi possível carregar o perfil.",
    );
  }

  if (response.status === 401) {
    throw new AccountApiError(
      "UNAUTHENTICATED",
      "Sua sessão expirou. Entre novamente.",
    );
  }
  if (!response.ok) {
    throw new AccountApiError(
      "UNAVAILABLE",
      "Não foi possível carregar o perfil.",
    );
  }

  const data = (await response.json()) as {
    id: string;
    fullName: string;
    email: string;
    phone?: string | null;
    professionalTitle?: string | null;
    registrationNumber?: string | null;
    photo?: { contentType: string; sizeBytes: number } | null;
  };

  let photoUrl: string | null = null;
  if (data.photo) {
    try {
      const downloadRes = await getProfilePhotoDownloadUrl();
      if (downloadRes) {
        photoUrl = downloadRes.downloadUrl;
      }
    } catch {
      // Non-fatal if photo download URL fails
    }
  }

  return {
    id: data.id,
    fullName: data.fullName,
    email: data.email,
    phone: data.phone ?? null,
    professionalTitle: data.professionalTitle ?? null,
    registrationNumber: data.registrationNumber ?? null,
    photo: data.photo ?? null,
    photoUrl,
  };
}

export async function updateProfile(
  payload: UpdateProfilePayload,
): Promise<UserProfile> {
  const token = await getSessionToken();
  if (!token) {
    throw new AccountApiError(
      "UNAUTHENTICATED",
      "Sua sessão expirou. Entre novamente.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/me/profile`, {
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
    throw new AccountApiError(
      "UNAVAILABLE",
      "Não foi possível atualizar o perfil.",
    );
  }

  if (response.status === 401) {
    throw new AccountApiError(
      "UNAUTHENTICATED",
      "Sua sessão expirou. Entre novamente.",
    );
  }
  if (response.status === 400 || response.status === 422) {
    const errorJson = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new AccountApiError(
      "VALIDATION_ERROR",
      errorJson?.message || "Confira os dados informados.",
    );
  }
  if (!response.ok) {
    throw new AccountApiError(
      "UNAVAILABLE",
      "Não foi possível atualizar o perfil.",
    );
  }

  const data = (await response.json()) as {
    id: string;
    fullName: string;
    email: string;
    phone?: string | null;
    professionalTitle?: string | null;
    registrationNumber?: string | null;
    photo?: { contentType: string; sizeBytes: number } | null;
  };

  return {
    id: data.id,
    fullName: data.fullName,
    email: data.email,
    phone: data.phone ?? payload.phone ?? null,
    professionalTitle:
      data.professionalTitle ?? payload.professionalTitle ?? null,
    registrationNumber:
      data.registrationNumber ?? payload.registrationNumber ?? null,
    photo: data.photo ?? null,
  };
}

export async function uploadProfilePhoto(
  formData: FormData,
): Promise<UserProfile> {
  const token = await getSessionToken();
  if (!token) {
    throw new AccountApiError(
      "UNAUTHENTICATED",
      "Sua sessão expirou. Entre novamente.",
    );
  }

  const { apiBaseUrl } = getServerConfig();
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/me/profile/photo`, {
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
    throw new AccountApiError(
      "UNAVAILABLE",
      "Não foi possível enviar a foto de perfil.",
    );
  }

  if (response.status === 401) {
    throw new AccountApiError(
      "UNAUTHENTICATED",
      "Sua sessão expirou. Entre novamente.",
    );
  }
  if (response.status === 413) {
    throw new AccountApiError(
      "PAYLOAD_TOO_LARGE",
      "O arquivo excede o limite máximo permitido de 2MB.",
    );
  }
  if (response.status === 400 || response.status === 422) {
    const errorJson = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new AccountApiError(
      "VALIDATION_ERROR",
      errorJson?.message || "Arquivo inválido ou não suportado.",
    );
  }
  if (response.status === 503) {
    throw new AccountApiError(
      "STORAGE_UNAVAILABLE",
      "Armazenamento de fotos temporariamente indisponível.",
    );
  }
  if (!response.ok) {
    throw new AccountApiError(
      "UNAVAILABLE",
      "Não foi possível enviar a foto de perfil.",
    );
  }

  const data = (await response.json()) as {
    id: string;
    fullName: string;
    email: string;
    phone?: string | null;
    professionalTitle?: string | null;
    registrationNumber?: string | null;
    photo?: { contentType: string; sizeBytes: number } | null;
  };

  let photoUrl: string | null = null;
  try {
    const downloadRes = await getProfilePhotoDownloadUrl();
    if (downloadRes) {
      photoUrl = downloadRes.downloadUrl;
    }
  } catch {
    // Non-fatal
  }

  return {
    id: data.id,
    fullName: data.fullName,
    email: data.email,
    phone: data.phone ?? null,
    professionalTitle: data.professionalTitle ?? null,
    registrationNumber: data.registrationNumber ?? null,
    photo: data.photo ?? null,
    photoUrl,
  };
}
