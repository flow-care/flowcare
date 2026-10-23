"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/auth";
import {
  createInviteSchema,
  type InviteMembershipRole,
} from "@/lib/team-invites";
import {
  updateMemberPermissionsSchema,
  updateMemberRoleSchema,
} from "@/lib/team-members";
import {
  createInvite,
  type RemoveMemberResponse,
  type ResendInviteResponse,
  removeMember,
  resendInvite,
  revokeInvite,
  TeamApiError,
  type UpdateMemberRoleResponse,
  updateMemberPermissions,
  updateMemberRole,
} from "@/server/team";

export interface CreateInviteActionResult {
  id: string;
  email: string;
  role: InviteMembershipRole;
  expiresAt: string;
}

export async function removeMemberAction(
  orgSlug: string,
  memberId: string,
): Promise<ActionResult<RemoveMemberResponse>> {
  if (!orgSlug?.trim() || !memberId?.trim()) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Identificador do membro ou da clínica inválido.",
      },
    };
  }

  try {
    const result = await removeMember(orgSlug, memberId);
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
        message: "Não foi possível remover o membro da clínica.",
      },
    };
  }
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

export async function updateMemberPermissionsAction(
  orgSlug: string,
  memberId: string,
  payload: {
    permissions?: string[];
    preset?: "ADMIN" | "PROFESSIONAL" | "RECEPTIONIST";
    version: number;
  },
): Promise<ActionResult<UpdateMemberRoleResponse>> {
  if (!orgSlug?.trim() || !memberId?.trim()) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Identificador da clínica ou do colaborador inválido.",
      },
    };
  }

  const parsed = updateMemberPermissionsSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: parsed.error.issues[0]?.message || "Permissões inválidas.",
      },
    };
  }

  try {
    const result = await updateMemberPermissions(
      orgSlug,
      memberId,
      parsed.data,
    );
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
        code: "UNKNOWN",
        message: "Não foi possível salvar as permissões. Tente novamente.",
      },
    };
  }
}

export async function updateMemberRoleAction(
  orgSlug: string,
  memberId: string,
  payload: { role: string; version: number },
): Promise<ActionResult<UpdateMemberRoleResponse>> {
  if (!orgSlug?.trim() || !memberId?.trim()) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Identificador da clínica ou do colaborador inválido.",
      },
    };
  }

  const parsed = updateMemberRoleSchema.safeParse(payload);
  if (!parsed.success) {
    const message =
      parsed.error.issues[0]?.message ||
      "Dados inválidos para alteração de papel.";
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message,
      },
    };
  }

  try {
    const result = await updateMemberRole(orgSlug, memberId, {
      role: parsed.data.role,
      version: parsed.data.version,
    });
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
            : "Não foi possível atualizar o papel do colaborador.",
      },
    };
  }
}
