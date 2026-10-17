export interface UsageByProfessionalItem {
  professionalId: string;
  professionalName: string;
  specialty?: string | null;
  processedSeconds: number;
  processedMinutes: number;
  successfulAudioCount: number;
}

export interface ClinicUsageResponse {
  month: string;
  timeZone: string;
  periodStart: string;
  periodEnd: string;
  processedSeconds: number;
  processedMinutes: number;
  successfulAudioCount: number;
  transcribedConsultations: number;
  failedAudioCount: number;
  byProfessional: UsageByProfessionalItem[];
}

export interface ClinicUsageQuery {
  month?: string;
}

export const EXPLANATORY_USAGE_NOTICE =
  "O consumo é contabilizado pela soma dos segundos de áudio processados com sucesso divididos por 60. Falhas e interrupções técnicas são isentas de cobrança.";

export const MONTH_NAMES_PT = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

/**
 * Formats total usage duration in a human-friendly format.
 * Examples:
 * - 0s -> "0 min"
 * - 2700s (45m) -> "45 min"
 * - 8520s (142m) -> "2h 22min"
 * - 3600s (60m) -> "1h"
 */
export function formatUsageDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0 min";
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes === 0) return "< 1 min";
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}min`;
}

/**
 * Returns exact minutes formatted for secondary display or precision view.
 */
export function formatMinutesExact(minutes: number): string {
  if (typeof minutes !== "number" || Number.isNaN(minutes)) return "0 min";
  return `${minutes.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} min`;
}

/**
 * Formats consultation count.
 * Examples:
 * - 0 -> "0 consultas"
 * - 1 -> "1 consulta"
 * - 38 -> "38 consultas"
 */
export function formatConsultationsCount(count: number): string {
  const safeCount = Number.isFinite(count) && count >= 0 ? count : 0;
  if (safeCount === 1) return "1 consulta";
  return `${safeCount} consultas`;
}

/**
 * Formats failed attempts with exemption guarantee.
 * Examples:
 * - 0 -> "0 falhas — sem cobrança"
 * - 1 -> "1 falha — sem cobrança"
 * - 2 -> "2 falhas — sem cobrança"
 */
export function formatFailedAttemptsCount(count: number): string {
  const safeCount = Number.isFinite(count) && count >= 0 ? count : 0;
  if (safeCount === 1) return "1 falha — sem cobrança";
  return `${safeCount} falhas — sem cobrança`;
}

/**
 * Calculates percentage of individual professional usage relative to clinic total.
 */
export function calculateUsagePercentage(
  professionalSeconds: number,
  totalClinicSeconds: number,
): number {
  if (!totalClinicSeconds || totalClinicSeconds <= 0) return 0;
  if (!professionalSeconds || professionalSeconds <= 0) return 0;
  const pct = (professionalSeconds / totalClinicSeconds) * 100;
  return Math.min(100, Math.round(pct * 10) / 10);
}

/**
 * Formats percentage with one decimal place.
 */
export function formatPercentage(percentage: number): string {
  const safePct =
    Number.isFinite(percentage) && percentage >= 0 ? percentage : 0;
  return `${safePct.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * Formats month string (YYYY-MM) to Portuguese label.
 * Example: "2026-10" -> "Outubro de 2026"
 */
export function formatMonthLabel(monthString: string): string {
  if (!monthString) return "";
  const match = /^(\d{4})-(\d{2})$/.exec(monthString.trim());
  if (!match) return monthString;
  const year = match[1];
  const monthIdx = Number.parseInt(match[2], 10) - 1;
  const name = MONTH_NAMES_PT[monthIdx] ?? match[2];
  return `${name} de ${year}`;
}

/**
 * Generates options for the recent months (e.g. past 12 months).
 */
export function getRecentMonthOptions(
  referenceDate: Date = new Date(),
  count = 12,
): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  const d = new Date(referenceDate);
  d.setDate(1);

  for (let i = 0; i < count; i++) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const value = `${year}-${month}`;
    const label = formatMonthLabel(value);
    options.push({ value, label });
    d.setMonth(d.getMonth() - 1);
  }

  return options;
}

/**
 * Resolves display specialty for professional in breakdown table.
 */
export function resolveProfessionalSpecialty(
  item: UsageByProfessionalItem,
): string {
  if (item.specialty?.trim()) return item.specialty.trim();
  if (item.professionalId === "unassigned") return "—";
  return "Profissional Clínico";
}
