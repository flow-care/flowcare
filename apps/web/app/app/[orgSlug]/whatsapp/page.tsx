import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { canOpenSection } from "@/lib/app-navigation";
import {
  canAccessWhatsAppTab,
  resolveWhatsAppTab,
  type WhatsAppTab,
} from "@/lib/whatsapp";
import { getAvailableOrganizations } from "@/server/organizations";
import { ConnectionSection } from "./connection-section";
import { MessagesSection } from "./messages-section";
import { TemplatesSection } from "./templates-section";
import { WhatsAppForbidden, WhatsAppSectionSkeleton } from "./whatsapp-states";
import { WhatsAppTabs } from "./whatsapp-tabs";

export const metadata: Metadata = {
  title: "WhatsApp | Flowcare",
};

const FORBIDDEN_DESCRIPTIONS: Record<WhatsAppTab, string> = {
  connection:
    "Apenas administradores da clínica podem conectar ou recuperar a sessão do WhatsApp.",
  messages:
    "Seu perfil não permite acompanhar o histórico de mensagens do WhatsApp.",
  settings:
    "Apenas administradores da clínica podem editar os textos das mensagens automáticas.",
};

export default async function WhatsAppPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    tab?: string;
    status?: string;
    period?: string;
    cursor?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const query = await searchParams;

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );
  if (!current || !canOpenSection(current.role, "whatsapp")) notFound();

  const tab = resolveWhatsAppTab(query.tab, current.role);
  const allowed = canAccessWhatsAppTab(current.role, tab);

  // Remount the section when the filters change so Suspense shows the skeleton.
  const sectionKey = `${tab}:${query.status ?? ""}:${query.period ?? ""}:${query.cursor ?? ""}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          WhatsApp
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conexão da clínica, histórico de envios e textos das mensagens
          automáticas de confirmação, lembrete e cancelamento.
        </p>
      </div>

      <WhatsAppTabs orgSlug={orgSlug} role={current.role} active={tab} />

      {!allowed ? (
        <WhatsAppForbidden
          orgSlug={orgSlug}
          description={FORBIDDEN_DESCRIPTIONS[tab]}
        />
      ) : (
        <Suspense key={sectionKey} fallback={<WhatsAppSectionSkeleton />}>
          {tab === "connection" ? (
            <ConnectionSection orgSlug={orgSlug} />
          ) : tab === "messages" ? (
            <MessagesSection
              orgSlug={orgSlug}
              status={query.status}
              period={query.period}
              cursor={query.cursor}
            />
          ) : (
            <TemplatesSection orgSlug={orgSlug} />
          )}
        </Suspense>
      )}
    </div>
  );
}
