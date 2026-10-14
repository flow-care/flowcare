export function maskCpf(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) {
    return value;
  }
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9, 11)}`;
}

const FIRST_DIGIT_WEIGHTS = [10, 9, 8, 7, 6, 5, 4, 3, 2] as const;
const SECOND_DIGIT_WEIGHTS = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2] as const;

function checkDigit(digits: string, weights: readonly number[]): number {
  const sum = weights.reduce(
    (total, weight, index) => total + Number(digits[index]) * weight,
    0,
  );
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidCpf(value: string): boolean {
  const digits = normalizeCpf(value);
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  return (
    Number(digits[9]) === checkDigit(digits.slice(0, 9), FIRST_DIGIT_WEIGHTS) &&
    Number(digits[10]) === checkDigit(digits.slice(0, 10), SECOND_DIGIT_WEIGHTS)
  );
}

export function formatCpf(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9)
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

export function formatBirthDateAndAge(birthDateStr?: string | null): {
  ageText: string;
  birthDateFormatted: string;
} {
  if (!birthDateStr) {
    return { ageText: "—", birthDateFormatted: "—" };
  }

  const [yearStr, monthStr, dayStr] = birthDateStr.slice(0, 10).split("-");
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10) - 1;
  const day = Number.parseInt(dayStr, 10);

  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return { ageText: "—", birthDateFormatted: birthDateStr };
  }

  const today = new Date();
  let age = today.getFullYear() - year;
  const monthDiff = today.getMonth() - month;
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
    age--;
  }

  const dayFormatted = String(day).padStart(2, "0");
  const monthFormatted = String(month + 1).padStart(2, "0");
  const birthDateFormatted = `${dayFormatted}/${monthFormatted}/${year}`;

  const ageText = age === 1 ? "1 ano" : `${Math.max(0, age)} anos`;

  return { ageText, birthDateFormatted };
}
