export function maskCpf(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 11) {
    return value;
  }
  return `${digits.slice(0, 3)}.***.***-${digits.slice(9, 11)}`;
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
