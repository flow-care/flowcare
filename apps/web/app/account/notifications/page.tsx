import { AlertCircle, Bell, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { NotificationPreference } from "@/lib/notification-preferences";
import { getNotificationPreferences } from "@/server/notification-preferences";
import { NotificationPreferencesView } from "./preferences-view";

export const metadata: Metadata = { title: "Notificações — Flowcare" };

export default async function NotificationsPage() {
  let preferences: NotificationPreference[];
  try {
    preferences = (await getNotificationPreferences()).preferences;
  } catch {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="text-2xl font-semibold">Notificações</h1>
        <div className="flex items-center gap-3 rounded-xl bg-card p-5 text-sm">
          <AlertCircle className="size-5 text-destructive" />
          <span className="flex-1">
            Não foi possível carregar suas preferências.
          </span>
          <Button asChild variant="outline" size="sm">
            <Link href="/account/notifications">
              <RefreshCw /> Tentar novamente
            </Link>
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Bell className="size-6" /> Notificações
        </h1>
        <p className="text-sm text-muted-foreground">
          Escolha como receber notificações da sua conta.
        </p>
      </div>
      <NotificationPreferencesView initialPreferences={preferences} />
    </div>
  );
}
