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
