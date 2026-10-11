const FIRST_DIGIT_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const SECOND_DIGIT_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] as const;

function computeCheckDigit(digits: string, weights: readonly number[]): number {
  const remainder =
    weights.reduce(
      (sum, weight, index) => sum + Number(digits[index]) * weight,
      0,
    ) % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCnpj(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) {
    return false;
  }
  return (
    Number(digits[12]) === computeCheckDigit(digits, FIRST_DIGIT_WEIGHTS) &&
    Number(digits[13]) === computeCheckDigit(digits, SECOND_DIGIT_WEIGHTS)
  );
}

export function isValidOptionalCnpj(raw: string): boolean {
  if (raw.trim() === "") return true;
  return isValidCnpj(raw);
}
