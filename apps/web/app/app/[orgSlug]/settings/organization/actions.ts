"use server";

import { revalidatePath } from "next/cache";
import {
  type UpdateOrganizationSettingsPayload,
  updateOrganizationSettings,
  uploadOrganizationLogo,
} from "@/server/organization-settings";

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export async function updateOrganizationSettingsAction(
  orgSlug: string,
  payload: UpdateOrganizationSettingsPayload,
): Promise<ActionResult> {
  try {
    const updated = await updateOrganizationSettings(orgSlug, payload);
    revalidatePath(`/app/${encodeURIComponent(orgSlug)}`, "layout");
    revalidatePath(`/app/${encodeURIComponent(orgSlug)}/settings/organization`);
    revalidatePath("/app", "layout");
    return { success: true, data: updated };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "ERROR";
    const message =
      error instanceof Error ? error.message : "Falha ao salvar configurações.";
    return { success: false, error: message, code };
  }
}

export async function uploadOrganizationLogoAction(
  orgSlug: string,
  formData: FormData,
): Promise<ActionResult<{ logoUrl?: string }>> {
  try {
    const result = await uploadOrganizationLogo(orgSlug, formData);
    revalidatePath(`/app/${encodeURIComponent(orgSlug)}`, "layout");
    revalidatePath(`/app/${encodeURIComponent(orgSlug)}/settings/organization`);
    revalidatePath("/app", "layout");
    return { success: true, data: { logoUrl: result.logoUrl } };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "ERROR";
    const message =
      error instanceof Error ? error.message : "Falha ao enviar logotipo.";
    return { success: false, error: message, code };
  }
}
