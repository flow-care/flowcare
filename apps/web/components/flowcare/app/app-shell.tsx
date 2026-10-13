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
        <SidebarInset className="p-">
          <AppHeader />
          {children}
        </SidebarInset>
      </AppSheetHost>
    </SidebarProvider>
  );
}
