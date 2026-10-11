import "server-only";

import { z } from "zod";
import { type InviteDetails, inviteDetailsSchema } from "@/lib/invites";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

export interface CurrentUserProfile {
  id: string;
  email: string;
  fullName: string;
  photoUrl?: string | null;
}

const userProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  fullName: z.string(),
  photo: z
    .object({
      contentType: z.string(),
      sizeBytes: z.number(),
    })
    .nullable()
    .optional(),
});

const photoDownloadSchema = z.object({
  downloadUrl: z.string().url(),
});

export async function getInviteDetails(
  token: string,
): Promise<InviteDetails | null> {
  if (!token || typeof token !== "string" || token.length < 20) {
    return null;
  }
  try {
    const { apiBaseUrl } = getServerConfig();
    const response = await fetch(
      `${apiBaseUrl}/invites/${encodeURIComponent(token)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const parsed = inviteDetailsSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<CurrentUserProfile | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { apiBaseUrl } = getServerConfig();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    };
    const response = await fetch(`${apiBaseUrl}/me/profile`, {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const parsed = userProfileSchema.safeParse(data);
    if (!parsed.success) return null;

    let photoUrl: string | null = null;
    if (parsed.data.photo) {
      const photoRes = await fetch(
        `${apiBaseUrl}/me/profile/photo/download-url`,
        {
          method: "GET",
          headers,
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
        },
      ).catch(() => null);
      if (photoRes?.ok) {
        const photoJson: unknown = await photoRes.json().catch(() => null);
        const parsedPhoto = photoDownloadSchema.safeParse(photoJson);
        if (parsedPhoto.success) {
          photoUrl = parsedPhoto.data.downloadUrl;
        }
      }
    }

    return {
      id: parsed.data.id,
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      photoUrl,
    };
  } catch {
    return null;
  }
}

export async function acceptInvite(
  token: string,
): Promise<{ organizationSlug: string }> {
  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    throw new Error("UNAUTHENTICATED");
  }
  const { apiBaseUrl } = getServerConfig();
  const response = await fetch(
    `${apiBaseUrl}/invites/${encodeURIComponent(token)}/accept`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      data && typeof data === "object" && "error" in data
        ? (data as { error: { code?: string } }).error?.code
        : null;
    if (code === "FORBIDDEN") throw new Error("FORBIDDEN");
    if (code === "INVITE_EXPIRED" || response.status === 410) {
      throw new Error("INVITE_EXPIRED");
    }
    if (response.status === 401) throw new Error("UNAUTHENTICATED");
    throw new Error("UPSTREAM_UNAVAILABLE");
  }
  const parsed = z.object({ organizationSlug: z.string() }).safeParse(data);
  if (!parsed.success) throw new Error("UPSTREAM_UNAVAILABLE");
  return parsed.data;
}

export async function declineInvite(
  token: string,
): Promise<{ message: string }> {
  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    throw new Error("UNAUTHENTICATED");
  }
  const { apiBaseUrl } = getServerConfig();
  const response = await fetch(
    `${apiBaseUrl}/invites/${encodeURIComponent(token)}/decline`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      data && typeof data === "object" && "error" in data
        ? (data as { error: { code?: string } }).error?.code
        : null;
    if (code === "FORBIDDEN") throw new Error("FORBIDDEN");
    if (code === "INVITE_EXPIRED" || response.status === 410) {
      throw new Error("INVITE_EXPIRED");
    }
    if (response.status === 401) throw new Error("UNAUTHENTICATED");
    throw new Error("UPSTREAM_UNAVAILABLE");
  }
  const parsed = z.object({ message: z.string() }).safeParse(data);
  if (!parsed.success) throw new Error("UPSTREAM_UNAVAILABLE");
  return parsed.data;
}
