"use client";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { CurrentUserProfile } from "@/server/invites";
import type { OrganizationSummary } from "@/server/organizations";
import { AppHeader } from "./app-header";
import { AppSheetHost } from "./app-sheet-host";
import { AppSidebar } from "./app-sidebar";

export function AppShell({
  children,
  current,
  organizations,
  user,
}: {
  children: React.ReactNode;
  current: OrganizationSummary;
  organizations: OrganizationSummary[];
  user: CurrentUserProfile | null;
}) {
  return (
    <SidebarProvider>
      <AppSheetHost>
        <AppSidebar
          current={current}
          organizations={organizations}
          user={user}
        />
        <SidebarInset className="my-2 mr-2">
          <AppHeader />
          <div className="flex-1 rounded-xl bg-card p-1.5">{children}</div>
        </SidebarInset>
      </AppSheetHost>
    </SidebarProvider>
  );
}
