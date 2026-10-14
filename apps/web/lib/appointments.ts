import { z } from "zod";

export type AppointmentStatusKey =
  | "SCHEDULED"
  | "WAITING"
  | "IN_CONSULTATION"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export interface StatusBadgeInfo {
  key: AppointmentStatusKey;
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
}

export function normalizeAppointmentStatus(status: string): StatusBadgeInfo {
  switch (status) {
    case "RESERVED":
      return { key: "SCHEDULED", label: "Agendado", variant: "secondary" };
    case "CONFIRMED":
      return { key: "SCHEDULED", label: "Confirmado", variant: "secondary" };
    case "SCHEDULED":
      return { key: "SCHEDULED", label: "Agendado", variant: "secondary" };
    case "WAITING":
      return { key: "WAITING", label: "Aguardando", variant: "outline" };
    case "IN_PROGRESS":
    case "IN_CONSULTATION":
      return {
        key: "IN_CONSULTATION",
        label: "Em consulta",
        variant: "default",
      };
    case "COMPLETED":
      return { key: "COMPLETED", label: "Concluído", variant: "outline" };
    case "CANCELLED":
      return { key: "CANCELLED", label: "Cancelado", variant: "destructive" };
    case "NO_SHOW":
      return {
        key: "NO_SHOW",
        label: "Não compareceu",
        variant: "destructive",
      };
    default:
      return { key: "SCHEDULED", label: status, variant: "secondary" };
  }
}

export type ReceptionQueueStatusKey =
  | "WAITING"
  | "ARRIVED"
  | "CALLED"
  | "IN_SERVICE"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW";

export interface ReceptionStatusBadgeInfo {
  key: ReceptionQueueStatusKey;
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
}

export function normalizeReceptionQueueStatus(
  status: string,
): ReceptionStatusBadgeInfo {
  switch (status) {
    case "WAITING":
      return { key: "WAITING", label: "Aguardando", variant: "outline" };
    case "ARRIVED":
      return { key: "ARRIVED", label: "Presente", variant: "secondary" };
    case "CALLED":
      return { key: "CALLED", label: "Chamado", variant: "default" };
    case "IN_SERVICE":
    case "IN_CONSULTATION":
    case "IN_PROGRESS":
      return { key: "IN_SERVICE", label: "Em atendimento", variant: "default" };
    case "COMPLETED":
      return { key: "COMPLETED", label: "Concluído", variant: "outline" };
    case "CANCELLED":
      return { key: "CANCELLED", label: "Cancelado", variant: "destructive" };
    case "NO_SHOW":
      return {
        key: "NO_SHOW",
        label: "Não compareceu",
        variant: "destructive",
      };
    default:
      return { key: "WAITING", label: status, variant: "outline" };
  }
}

export function calculateWaitTimeMinutes(
  arrivedAt: string | null | undefined,
  referenceTime: Date | number = new Date(),
): number | null {
  if (!arrivedAt) return null;
  const arrivedMs =
    typeof arrivedAt === "string" ? Date.parse(arrivedAt) : Number(arrivedAt);
  if (Number.isNaN(arrivedMs)) return null;
  const refMs =
    referenceTime instanceof Date ? referenceTime.getTime() : referenceTime;
  return Math.max(0, Math.floor((refMs - arrivedMs) / 60000));
}

export function formatWaitTime(minutes: number | null): string {
  if (minutes === null) return "–";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  if (remaining === 0) return `${hours}h`;
  return `${hours}h ${remaining}min`;
}

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(dateStr: unknown): dateStr is string {
  if (typeof dateStr !== "string" || !ISO_DATE_REGEX.test(dateStr))
    return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

export function getTodayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  const nextY = date.getFullYear();
  const nextM = String(date.getMonth() + 1).padStart(2, "0");
  const nextD = String(date.getDate()).padStart(2, "0");
  return `${nextY}-${nextM}-${nextD}`;
}

export function getWeekRange(dateStr: string): {
  startDate: string;
  endDate: string;
  days: string[];
} {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dayOfWeek = date.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const startDate = addDays(dateStr, diffToMonday);
  const days = Array.from({ length: 7 }, (_, i) => addDays(startDate, i));
  const endDate = days[6];
  return { startDate, endDate, days };
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const SHORT_MONTH_NAMES = [
  "jan.",
  "fev.",
  "mar.",
  "abr.",
  "mai.",
  "jun.",
  "jul.",
  "ago.",
  "set.",
  "out.",
  "nov.",
  "dez.",
];

const WEEKDAY_NAMES = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

export const SHORT_WEEKDAY_NAMES = [
  "Dom",
  "Seg",
  "Ter",
  "Qua",
  "Qui",
  "Sex",
  "Sáb",
];

export function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = WEEKDAY_NAMES[date.getDay()];
  const month = MONTH_NAMES[date.getMonth()];
  return `${weekday}, ${d} de ${month} de ${y}`;
}

export function formatWeekRangeLabel(
  startDateStr: string,
  endDateStr: string,
): string {
  const [startY, startM, startD] = startDateStr.split("-").map(Number);
  const [endY, endM, endD] = endDateStr.split("-").map(Number);

  if (startY === endY && startM === endM) {
    const month = MONTH_NAMES[startM - 1];
    return `${startD} a ${endD} de ${month} de ${startY}`;
  }

  if (startY === endY) {
    const startMonth = SHORT_MONTH_NAMES[startM - 1];
    const endMonth = SHORT_MONTH_NAMES[endM - 1];
    return `${startD} de ${startMonth} a ${endD} de ${endMonth} de ${startY}`;
  }

  const startMonth = SHORT_MONTH_NAMES[startM - 1];
  const endMonth = SHORT_MONTH_NAMES[endM - 1];
  return `${startD} de ${startMonth} de ${startY} a ${endD} de ${endMonth} de ${endY}`;
}

export function formatAppointmentTime(
  localScheduledAt: string,
  durationMinutes: number,
): string {
  const time = localScheduledAt.slice(11, 16);
  if (!time.includes(":")) return localScheduledAt;
  const [h, m] = time.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  const totalEndMin = h * 60 + m + durationMinutes;
  const endH = Math.floor(totalEndMin / 60) % 24;
  const endM = totalEndMin % 60;
  const endTime = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
  return `${time} – ${endTime}`;
}

export function formatQueueStatus(status?: string | null): string {
  switch (status) {
    case "WAITING":
      return "Aguardando chegada";
    case "ARRIVED":
      return "Aguardando na recepção";
    case "CALLED":
      return "Chamado";
    case "IN_SERVICE":
      return "Em atendimento";
    case "COMPLETED":
      return "Finalizado";
    case "NO_SHOW":
      return "Não compareceu";
    default:
      return status || "Aguardando";
  }
}

export function canStartAppointment(
  userRole?: string,
  appointmentStatus?: string,
): boolean {
  if (userRole !== "ADMIN_PROFESSIONAL" && userRole !== "PROFESSIONAL") {
    return false;
  }
  if (!appointmentStatus) return true;
  return (
    appointmentStatus !== "CANCELLED" &&
    appointmentStatus !== "COMPLETED" &&
    appointmentStatus !== "NO_SHOW"
  );
}

export function canCancelAppointment(appointmentStatus?: string): boolean {
  if (!appointmentStatus) return false;
  return (
    appointmentStatus !== "CANCELLED" &&
    appointmentStatus !== "COMPLETED" &&
    appointmentStatus !== "NO_SHOW"
  );
}

export function canEditAppointment(appointmentStatus?: string): boolean {
  if (!appointmentStatus) return false;
  return (
    appointmentStatus !== "CANCELLED" &&
    appointmentStatus !== "COMPLETED" &&
    appointmentStatus !== "NO_SHOW"
  );
}

function dateParts(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function zonedDateTimeToUtc(
  date: string,
  time: string,
  timeZone = "America/Sao_Paulo",
): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = dateParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const offset = represented - target;
    if (offset === 0) return new Date(candidate).toISOString();
    candidate -= offset;
  }
  return new Date(candidate).toISOString();
}

export function getDefaultAppointmentTime(): string {
  const now = new Date();
  const nextHour = (now.getHours() + 1) % 24;
  return `${String(nextHour).padStart(2, "0")}:00`;
}

export const APPOINTMENT_DURATION_OPTIONS = [
  { value: 15, label: "15 minutos" },
  { value: 30, label: "30 minutos" },
  { value: 45, label: "45 minutos" },
  { value: 60, label: "60 minutos" },
] as const;

export const cancellationReasonTypeSchema = z.enum([
  "PATIENT_REQUEST",
  "PROFESSIONAL_UNAVAILABLE",
  "NO_SHOW",
  "SCHEDULING_ERROR",
  "OTHER",
]);

export type CancellationReasonType = z.infer<
  typeof cancellationReasonTypeSchema
>;

export const CANCELLATION_REASONS = [
  { value: "PATIENT_REQUEST", label: "Desistência do paciente" },
  {
    value: "PROFESSIONAL_UNAVAILABLE",
    label: "Imprevisto do profissional médico",
  },
  { value: "NO_SHOW", label: "Paciente não compareceu" },
  { value: "SCHEDULING_ERROR", label: "Erro no agendamento" },
  { value: "OTHER", label: "Outros motivos" },
] as const;

export const CANCELLATION_REASON_LABELS: Record<
  CancellationReasonType,
  string
> = {
  PATIENT_REQUEST: "Desistência do paciente",
  PROFESSIONAL_UNAVAILABLE: "Imprevisto do profissional médico",
  NO_SHOW: "Paciente não compareceu",
  SCHEDULING_ERROR: "Erro no agendamento",
  OTHER: "Outros motivos",
};
