export function formatScheduledAt(
  scheduledAtIso: string,
  localScheduledAt?: string,
): string {
  const value = localScheduledAt || scheduledAtIso;
  try {
    const [datePart, timePart] = value.split("T");
    if (datePart && timePart) {
      const [year, month, day] = datePart.split("-");
      const [hour, minute] = timePart.split(":");
      return `${day}/${month}/${year} às ${hour}:${minute}`;
    }
    const date = new Date(value);
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return value;
  }
}

export function formatDateTime(isoDate?: string | null): string {
  if (!isoDate) return "—";
  try {
    const [datePart, timePart] = isoDate.split("T");
    if (datePart && timePart) {
      const [year, month, day] = datePart.split("-");
      const [hour, minute] = timePart.split(":");
      if (year && month && day && hour !== undefined && minute !== undefined) {
        return `${day}/${month}/${year} às ${hour}:${minute}`;
      }
    }
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return isoDate;
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    }).format(date);
  } catch {
    return isoDate;
  }
}
