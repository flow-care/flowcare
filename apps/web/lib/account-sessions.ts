export interface AccountSession {
  id: string;
  isCurrent: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: string;
}

export function formatSessionDevice(userAgent: string | null): string {
  if (!userAgent || !userAgent.trim()) {
    return "Dispositivo não identificado";
  }
  return userAgent.trim();
}

export function formatSessionIp(ipAddress: string | null): string {
  if (!ipAddress || !ipAddress.trim()) {
    return "IP não disponível";
  }
  return ipAddress.trim();
}

export function formatSessionDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return isoString;
    }
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return isoString;
  }
}
