import type { WhatsAppStatus } from "@/lib/whatsapp";
import { getWhatsAppStatus, WhatsAppApiError } from "@/server/whatsapp";
import { ConnectionPanel } from "./connection-panel";
import { WhatsAppForbidden } from "./whatsapp-states";

export async function ConnectionSection({ orgSlug }: { orgSlug: string }) {
  let status: WhatsAppStatus | null = null;
  let errorMessage: string | null = null;

  try {
    status = await getWhatsAppStatus(orgSlug);
  } catch (error) {
    if (error instanceof WhatsAppApiError && error.code === "FORBIDDEN") {
      return (
        <WhatsAppForbidden
          orgSlug={orgSlug}
          description="Apenas administradores da clínica podem conectar ou recuperar a sessão do WhatsApp."
        />
      );
    }
    errorMessage =
      error instanceof WhatsAppApiError
        ? error.message
        : "Não foi possível verificar o status da conexão.";
  }

  return (
    <ConnectionPanel
      orgSlug={orgSlug}
      initialStatus={status}
      initialError={errorMessage}
    />
  );
}
