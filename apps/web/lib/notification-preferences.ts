export interface NotificationPreference {
  event: string;
  channel: string;
  enabled: boolean;
  required: boolean;
}

export interface NotificationPreferencesResponse {
  preferences: NotificationPreference[];
}

export function preferenceLabel(event: string): string {
  switch (event) {
    case "ACCOUNT_SECURITY":
      return "Segurança da conta";
    case "APPOINTMENT_REMINDERS":
      return "Lembretes de agenda";
    case "TEAM_UPDATES":
      return "Atualizações da equipe";
    default:
      return event.replaceAll("_", " ");
  }
}

export function channelLabel(channel: string): string {
  switch (channel) {
    case "EMAIL":
      return "E-mail";
    case "APP":
      return "Aplicativo";
    case "WHATSAPP":
      return "WhatsApp";
    default:
      return channel;
  }
}
