import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  canAccessWhatsAppTab,
  WHATSAPP_TABS,
  type WhatsAppTab,
  whatsappTabHref,
} from "@/lib/whatsapp";

export function WhatsAppTabs({
  orgSlug,
  role,
  active,
}: {
  orgSlug: string;
  role: string;
  active: WhatsAppTab;
}) {
  const tabs = WHATSAPP_TABS.filter((tab) =>
    canAccessWhatsAppTab(role, tab.value),
  );

  return (
    <nav
      aria-label="Seções do WhatsApp"
      className="flex w-full gap-1 overflow-x-auto border-b border-border"
    >
      {tabs.map((tab) => {
        const isActive = tab.value === active;
        return (
          <Link
            key={tab.value}
            href={whatsappTabHref(orgSlug, tab.value)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
