"use server";

import { validatePasswordChange } from "@/lib/account-password";
import {
  type ChangePasswordResult,
  changeAccountPassword,
} from "@/server/account-password";
import {
  listAccountSessions,
  type ListSessionsResult,
  revokeAccountSession,
  revokeOtherAccountSessions,
  type RevokeSessionResult,
} from "@/server/account-sessions";

export async function changePasswordAction(values: {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
}): Promise<ChangePasswordResult | { ok: false; code: "VALIDATION_ERROR" }> {
  if (validatePasswordChange(values))
    return { ok: false, code: "VALIDATION_ERROR" };
  return changeAccountPassword({
    currentPassword: values.currentPassword,
    newPassword: values.newPassword,
  });
}

export async function getActiveSessionsAction(): Promise<ListSessionsResult> {
  return listAccountSessions();
}

export async function revokeSessionAction(
  sessionId: string,
): Promise<RevokeSessionResult> {
  return revokeAccountSession(sessionId);
}

export async function revokeOtherSessionsAction(): Promise<RevokeSessionResult> {
  return revokeOtherAccountSessions();
}
