import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

const organizationsResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      role: z.enum([
        "ADMIN",
        "ADMIN_PROFESSIONAL",
        "PROFESSIONAL",
        "RECEPTIONIST",
      ]),
    }),
  ),
});

export type OrganizationSummary = z.infer<
  typeof organizationsResponse
>["data"][number];

const activeOrganizationResponse = z.object({
  activeOrganization: z.object({ id: z.string(), slug: z.string() }).nullable(),
});

export async function getActiveOrganization(): Promise<{
  id: string;
  slug: string;
} | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { apiBaseUrl } = getServerConfig();
    const response = await fetch(`${apiBaseUrl}/account/active-organization`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const parsed = activeOrganizationResponse.safeParse(await response.json());
    return parsed.success ? parsed.data.activeOrganization : null;
  } catch {
    return null;
  }
}

export async function setActiveOrganization(orgSlug: string): Promise<boolean> {
  const token = await getSessionToken();
  if (!token) return false;
  try {
    const { apiBaseUrl } = getServerConfig();
    const response = await fetch(`${apiBaseUrl}/account/active-organization`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ orgSlug }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getAvailableOrganizations(): Promise<
  OrganizationSummary[] | null
> {
  const token = await getSessionToken();
  if (!token) return null;

  try {
    const { apiBaseUrl } = getServerConfig();
    const response = await fetch(`${apiBaseUrl}/organizations`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const parsed = organizationsResponse.safeParse(await response.json());
    return parsed.success ? parsed.data.data : null;
  } catch {
    return null;
  }
}

export * from "./organization-settings";
