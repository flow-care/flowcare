"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/auth";
import { acceptInvite, declineInvite } from "@/server/invites";
import { clearSession } from "@/server/session";

const tokenSchema = z.string().trim().min(20).max(200);

export async function acceptInviteAction(
  token: string,
): Promise<ActionResult<{ organizationSlug: string }>> {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_TOKEN",
        message: "Token de convite inválido ou malformado.",
      },
    };
  }

  try {
    const result = await acceptInvite(parsed.data);
    return { ok: true, data: result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "UPSTREAM_UNAVAILABLE";
    if (message === "UNAUTHENTICATED") {
      return {
        ok: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Você precisa entrar para aceitar o convite.",
        },
      };
    }
    if (message === "FORBIDDEN") {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Este convite pertence a outro e-mail.",
        },
      };
    }
    if (message === "INVITE_EXPIRED") {
      return {
        ok: false,
        error: {
          code: "INVITE_EXPIRED",
          message: "Este convite expirou ou já foi utilizado.",
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Não foi possível aceitar o convite. Tente novamente.",
      },
    };
  }
}

export async function declineInviteAction(
  token: string,
): Promise<ActionResult<{ message: string }>> {
  const parsed = tokenSchema.safeParse(token);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "INVALID_TOKEN",
        message: "Token de convite inválido ou malformado.",
      },
    };
  }

  try {
    const result = await declineInvite(parsed.data);
    return { ok: true, data: result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "UPSTREAM_UNAVAILABLE";
    if (message === "UNAUTHENTICATED") {
      return {
        ok: false,
        error: {
          code: "UNAUTHENTICATED",
          message: "Você precisa entrar para recusar o convite.",
        },
      };
    }
    if (message === "FORBIDDEN") {
      return {
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Este convite pertence a outro e-mail.",
        },
      };
    }
    if (message === "INVITE_EXPIRED") {
      return {
        ok: false,
        error: {
          code: "INVITE_EXPIRED",
          message: "Este convite expirou ou já foi utilizado.",
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Não foi possível recusar o convite. Tente novamente.",
      },
    };
  }
}

export async function switchAccountAction(returnTo?: string): Promise<void> {
  await clearSession();
  redirect(
    returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login",
  );
}
