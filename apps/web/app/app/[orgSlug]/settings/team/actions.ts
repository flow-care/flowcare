"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth";
import {
  type ResendInviteResponse,
  resendInvite,
  revokeInvite,
  TeamApiError,
} from "@/server/team";

export async function resendInviteAction(
  orgSlug: string,
  inviteId: string,
): Promise<ActionResult<ResendInviteResponse>> {
  if (!orgSlug?.trim() || !inviteId?.trim()) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Identificador do convite ou da clínica inválido.",
      },
    };
  }

  try {
    const result = await resendInvite(orgSlug, inviteId);
    revalidatePath(`/app/${orgSlug}/settings/team`);
    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof TeamApiError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message },
      };
    }
    return {
      ok: false,
      error: {
        code: "UNAVAILABLE",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível reenviar o convite.",
      },
    };
  }
}

export async function revokeInviteAction(
  orgSlug: string,
  inviteId: string,
): Promise<ActionResult<{ success: boolean; message: string }>> {
  if (!orgSlug?.trim() || !inviteId?.trim()) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Identificador do convite ou da clínica inválido.",
      },
    };
  }

  try {
    const result = await revokeInvite(orgSlug, inviteId);
    revalidatePath(`/app/${orgSlug}/settings/team`);
    return { ok: true, data: result };
  } catch (error) {
    if (error instanceof TeamApiError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message },
      };
    }
    return {
      ok: false,
      error: {
        code: "UNAVAILABLE",
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível revogar o convite.",
      },
    };
  }
}
