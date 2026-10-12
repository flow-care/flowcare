import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type { PreferencesResponse, UpdatePreferencesBody } from "./model";

// Only account security email is delivered today (verification and password reset).
// Patient WhatsApp consent is a separate, organization-scoped policy.
const OFFERED = [
  { event: "ACCOUNT_SECURITY", channel: "EMAIL", required: true },
] as const;

export class NotificationsService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(userId: string): Promise<PreferencesResponse> {
    const saved = await this.prisma.userNotificationPreference.findMany({
      where: { userId },
      select: { event: true, channel: true, enabled: true },
    });
    return {
      preferences: OFFERED.map((item) => ({
        ...item,
        enabled:
          saved.find(
            (row) => row.event === item.event && row.channel === item.channel,
          )?.enabled ?? true,
      })),
    };
  }

  async update(
    userId: string,
    body: UpdatePreferencesBody,
  ): Promise<PreferencesResponse> {
    if (body.preferences.length !== OFFERED.length) {
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Informe todas as preferências disponíveis.",
      );
    }
    for (const item of body.preferences) {
      const offered = OFFERED.find(
        (option) =>
          option.event === item.event && option.channel === item.channel,
      );
      if (!offered) {
        throw new ApiError(
          "VALIDATION_ERROR",
          400,
          "Combinação de evento e canal indisponível.",
        );
      }
      if (offered.required && !item.enabled) {
        throw new ApiError(
          "REQUIRED_NOTIFICATION",
          400,
          "Notificações de segurança não podem ser desativadas.",
        );
      }
    }
    await this.prisma.userNotificationPreference.upsert({
      where: {
        userId_event_channel: {
          userId,
          event: "ACCOUNT_SECURITY",
          channel: "EMAIL",
        },
      },
      create: {
        userId,
        event: "ACCOUNT_SECURITY",
        channel: "EMAIL",
        enabled: true,
      },
      update: { enabled: true },
    });
    return this.get(userId);
  }
}
