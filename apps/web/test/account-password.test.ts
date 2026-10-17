import { describe, expect, test } from "bun:test";
import {
  passwordRequirements,
  validatePasswordChange,
} from "../lib/account-password";

const valid = {
  currentPassword: "Current#123",
  newPassword: "NewSecret#456",
  confirmation: "NewSecret#456",
};

describe("change password validation", () => {
  test("accepts a distinct password with all required properties", () => {
    expect(validatePasswordChange(valid)).toBeUndefined();
    expect(
      passwordRequirements.every(({ test }) => test(valid.newPassword)),
    ).toBe(true);
  });

  test("rejects weak, matching, and unconfirmed passwords", () => {
    expect(
      validatePasswordChange({
        ...valid,
        newPassword: "short",
        confirmation: "short",
      }),
    ).toBeDefined();
    expect(
      validatePasswordChange({
        ...valid,
        newPassword: valid.currentPassword,
        confirmation: valid.currentPassword,
      }),
    ).toBe("A nova senha deve ser diferente da atual.");
    expect(
      validatePasswordChange({ ...valid, confirmation: "Other#456" }),
    ).toBe("A confirmação deve ser igual à nova senha.");
  });

  test("enforces backend maximum length and requires current password", () => {
    expect(validatePasswordChange({ ...valid, currentPassword: "" })).toBe(
      "Informe sua senha atual.",
    );
    expect(
      validatePasswordChange({
        ...valid,
        newPassword: "A1!".repeat(25),
        confirmation: "A1!".repeat(25),
      }),
    ).toBe("A nova senha deve ter no máximo 72 caracteres.");
  });
});
