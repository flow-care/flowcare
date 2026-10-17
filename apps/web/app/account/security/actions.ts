"use server";

import { validatePasswordChange } from "@/lib/account-password";
import {
  type ChangePasswordResult,
  changeAccountPassword,
} from "@/server/account-password";

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
