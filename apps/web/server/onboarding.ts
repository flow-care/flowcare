import "server-only";

import { z } from "zod";
import { getServerConfig } from "./config";
import { getSessionToken } from "./session";

const progressSchema = z.object({
  currentStep: z.string(),
  completed: z.boolean(),
  draftData: z.record(z.string(), z.unknown()),
  pendingInviteId: z.string().nullable().optional(),
});

export type OnboardingProgress = z.infer<typeof progressSchema>;

export async function getOnboardingProgress(): Promise<OnboardingProgress | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const { apiBaseUrl } = getServerConfig();
    const response = await fetch(`${apiBaseUrl}/onboarding/progress`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    const parsed = progressSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
