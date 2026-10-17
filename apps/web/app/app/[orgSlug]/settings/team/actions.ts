"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth";
import {
  createInviteSchema,
  type InviteMembershipRole,
} from "@/lib/team-invites";
import {
  createInvite,
  type ResendInviteResponse,
  resendInvite,
  revokeInvite,
  TeamApiError,
} from "@/server/team";

export interface CreateInviteActionResult {
  id: string;
  email: string;
  role: InviteMembershipRole;
  expiresAt: string;
}

export async function createInviteAction(
  orgSlug: string,
  payload: { email: string; role: string; expiresInDays?: number },
): Promise<ActionResult<CreateInviteActionResult>> {
  if (!orgSlug?.trim()) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Identificador da clínica inválido.",
      },
    };
  }

  const parsed = createInviteSchema.safeParse(payload);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message || "Dados de convite inválidos.";
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message,
      },
    };
  }

  try {
    const result = await createInvite(orgSlug, {
      email: parsed.data.email,
      role: parsed.data.role,
      expiresInDays: parsed.data.expiresInDays,
    });
    revalidatePath(`/app/${orgSlug}/settings/team`);
    return {
      ok: true,
      data: {
        id: result.id,
        email: result.email,
        role: parsed.data.role,
        expiresAt: result.expiresAt,
      },
    };
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
            : "Não foi possível enviar o convite.",
      },
    };
  }
}

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
