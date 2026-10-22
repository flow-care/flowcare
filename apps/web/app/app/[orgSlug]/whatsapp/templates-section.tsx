import { TEMPLATE_TYPES, type WhatsAppTemplateItem } from "@/lib/whatsapp";
import { listWhatsAppTemplates, WhatsAppApiError } from "@/server/whatsapp";
import { TemplatesEditor } from "./templates-editor";
import { WhatsAppForbidden, WhatsAppSectionError } from "./whatsapp-states";

export async function TemplatesSection({ orgSlug }: { orgSlug: string }) {
  let templates: WhatsAppTemplateItem[];
  try {
    templates = await listWhatsAppTemplates(orgSlug);
  } catch (error) {
    if (error instanceof WhatsAppApiError && error.code === "FORBIDDEN") {
      return (
        <WhatsAppForbidden
          orgSlug={orgSlug}
          description="Apenas administradores da clínica podem editar os textos das mensagens automáticas."
        />
      );
    }
    return (
      <WhatsAppSectionError
        title="Não foi possível carregar os textos das mensagens"
        message={error instanceof WhatsAppApiError ? error.message : undefined}
        retryHref={`/app/${encodeURIComponent(orgSlug)}/whatsapp?tab=settings`}
      />
    );
  }

  const byType = new Map(
    templates.map((template) => [template.type, template]),
  );
  return (
    <TemplatesEditor
      orgSlug={orgSlug}
      templates={TEMPLATE_TYPES.map((type) => ({
        type,
        saved: byType.get(type) ?? null,
      }))}
    />
  );
}
