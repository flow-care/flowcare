export const passwordRequirements = [
  {
    label: "Pelo menos 8 caracteres",
    test: (value: string) => value.length >= 8,
  },
  { label: "Pelo menos um número", test: (value: string) => /\d/.test(value) },
  {
    label: "Pelo menos um caractere especial",
    test: (value: string) => /[^\p{L}\p{N}\s]/u.test(value),
  },
] as const;

export function validatePasswordChange(values: {
  currentPassword: string;
  newPassword: string;
  confirmation: string;
}): string | undefined {
  if (!values.currentPassword) return "Informe sua senha atual.";
  if (values.currentPassword.length > 72)
    return "A senha atual deve ter no máximo 72 caracteres.";
  if (
    !values.newPassword ||
    passwordRequirements.some(({ test }) => !test(values.newPassword))
  ) {
    return "A nova senha precisa atender a todos os requisitos de segurança.";
  }
  if (values.newPassword.length > 72)
    return "A nova senha deve ter no máximo 72 caracteres.";
  if (values.newPassword === values.currentPassword)
    return "A nova senha deve ser diferente da atual.";
  if (values.confirmation !== values.newPassword)
    return "A confirmação deve ser igual à nova senha.";
  return undefined;
}
