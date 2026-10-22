import {
  MESSAGES_PAGE_SIZE,
  parseMessagePeriod,
  parseMessageStatusFilter,
  resolvePeriodRange,
  type WhatsAppMessagesPage,
  whatsappTabHref,
} from "@/lib/whatsapp";
import {
  getPatientNames,
  listWhatsAppMessages,
  WhatsAppApiError,
} from "@/server/whatsapp";
import { MessagesView } from "./messages-view";
import { WhatsAppForbidden, WhatsAppSectionError } from "./whatsapp-states";

export async function MessagesSection({
  orgSlug,
  status,
  period,
  cursor,
}: {
  orgSlug: string;
  status?: string;
  period?: string;
  cursor?: string;
}) {
  const statusFilter = parseMessageStatusFilter(status);
  const periodFilter = parseMessagePeriod(period);
  const retryHref = whatsappTabHref(orgSlug, "messages", {
    status: statusFilter,
    period: periodFilter === "all" ? undefined : periodFilter,
    cursor,
  });

  let page: WhatsAppMessagesPage;
  try {
    page = await listWhatsAppMessages(orgSlug, {
      status: statusFilter,
      ...resolvePeriodRange(periodFilter),
      cursor,
      limit: MESSAGES_PAGE_SIZE,
    });
  } catch (error) {
    if (error instanceof WhatsAppApiError && error.code === "FORBIDDEN") {
      return (
        <WhatsAppForbidden
          orgSlug={orgSlug}
          description="Seu perfil não permite acompanhar o histórico de mensagens do WhatsApp."
        />
      );
    }
    if (
      error instanceof WhatsAppApiError &&
      error.code === "VALIDATION_ERROR"
    ) {
      // Stale cursor (filters changed): restart from the first page.
      return (
        <WhatsAppSectionError
          title="Esta página de resultados não está mais disponível"
          message="Os filtros ou as mensagens mudaram. Volte ao início da lista."
          retryHref={whatsappTabHref(orgSlug, "messages", {
            status: statusFilter,
            period: periodFilter === "all" ? undefined : periodFilter,
          })}
        />
      );
    }
    return (
      <WhatsAppSectionError
        title="Não foi possível carregar as mensagens"
        message={error instanceof WhatsAppApiError ? error.message : undefined}
        retryHref={retryHref}
      />
    );
  }

  const names = await getPatientNames(
    orgSlug,
    page.items.map((item) => item.patientId),
  );
  const items = page.items.map((item) => ({
    ...item,
    patientName: names.get(item.patientId) ?? null,
  }));

  return (
    <MessagesView
      key={items.map((item) => `${item.id}:${item.status}`).join("|")}
      orgSlug={orgSlug}
      items={items}
      nextCursor={page.nextCursor}
      hasPreviousPage={Boolean(cursor)}
      filters={{ status: statusFilter ?? "all", period: periodFilter }}
      canResend
    />
  );
}
