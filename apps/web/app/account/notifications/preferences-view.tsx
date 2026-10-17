"use client";

import { Info, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  channelLabel,
  type NotificationPreference,
  preferenceLabel,
} from "@/lib/notification-preferences";
import { updateNotificationPreferencesAction } from "./actions";

const EVENT_ORDER = [
  "APPOINTMENT_REMINDERS",
  "TEAM_UPDATES",
  "ACCOUNT_SECURITY",
];

export function NotificationPreferencesView({
  initialPreferences,
}: {
  initialPreferences: NotificationPreference[];
}) {
  const [preferences, setPreferences] = useState(initialPreferences);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const events = [
    ...new Set([
      ...EVENT_ORDER,
      ...preferences.map((preference) => preference.event),
    ]),
  ];

  async function toggle(preference: NotificationPreference) {
    if (preference.required || savingKey) return;
    const key = `${preference.event}:${preference.channel}`;
    const previous = preferences;
    const next = previous.map((item) =>
      item.event === preference.event && item.channel === preference.channel
        ? { ...item, enabled: !item.enabled }
        : item,
    );
    setPreferences(next);
    setSavingKey(key);
    try {
      const result = await updateNotificationPreferencesAction(next);
      if (!result.ok) throw new Error(result.message);
      setPreferences(result.data.preferences);
      toast.success("Preferências atualizadas.");
    } catch (error) {
      setPreferences(previous);
      toast.error(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar a preferência.",
      );
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {events.map((event) => {
          const offered = preferences.filter(
            (preference) => preference.event === event,
          );
          return (
            <section key={event} className="rounded-xl bg-card p-5 sm:p-6">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{preferenceLabel(event)}</h2>
                  <p className="text-sm text-muted-foreground">
                    {event === "ACCOUNT_SECURITY"
                      ? "Verificação da conta e recuperação de senha."
                      : "Notificações pessoais deste tipo de evento."}
                  </p>
                </div>
                {event === "ACCOUNT_SECURITY" && (
                  <LockKeyhole
                    className="size-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </div>
              {offered.length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Info className="size-4" /> Ainda não disponível.
                </p>
              ) : (
                <div className="space-y-3">
                  {offered.map((preference) => (
                    <div
                      key={`${preference.event}:${preference.channel}`}
                      className="flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <span className="text-sm font-medium">
                          {channelLabel(preference.channel)}
                        </span>
                        {preference.required && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            Obrigatório
                          </span>
                        )}
                      </div>
                      {preference.required ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex cursor-help"
                              aria-label="Notificação obrigatória de segurança"
                            >
                              <Switch
                                checked={preference.enabled}
                                disabled
                                aria-label={`${channelLabel(preference.channel)} obrigatório`}
                              />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            Notificações de segurança não podem ser desativadas.
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <Switch
                          checked={preference.enabled}
                          disabled={savingKey !== null}
                          onCheckedChange={() => toggle(preference)}
                          aria-label={`${channelLabel(preference.channel)} para ${preferenceLabel(event)}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        <p className="text-xs text-muted-foreground">
          Estas preferências são pessoais. Mensagens enviadas pela clínica a
          pacientes são configuradas separadamente.
        </p>
      </div>
    </TooltipProvider>
  );
}
