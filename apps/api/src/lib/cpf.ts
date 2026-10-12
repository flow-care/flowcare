const FIRST_DIGIT_WEIGHTS = [10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const SECOND_DIGIT_WEIGHTS = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;

function checkDigit(digits: string, weights: readonly number[]) {
  const sum = weights.reduce(
    (total, weight, index) => total + Number(digits[index]) * weight,
    0,
  );
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

export function normalizeCpf(value: string) {
  return value.replace(/\D/g, "");
}

export function isValidCpf(value: string) {
  const digits = normalizeCpf(value);
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  return (
    Number(digits[9]) === checkDigit(digits.slice(0, 9), FIRST_DIGIT_WEIGHTS) &&
    Number(digits[10]) === checkDigit(digits.slice(0, 10), SECOND_DIGIT_WEIGHTS)
  );
}
