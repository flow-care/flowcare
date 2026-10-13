"use client";

import {
  CalendarDays,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MessageCircle,
  Settings,
  Stethoscope,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  type AppSection,
  appSections,
  canOpenSection,
} from "@/lib/app-navigation";
import type { OrganizationSummary } from "@/server/organizations";
import { useAppSheet } from "./app-sheet-host";
import { OrganizationSwitcher } from "./organization-switcher";

const sectionIcons: Record<AppSection, typeof LayoutDashboard> = {
  dashboard: LayoutDashboard,
  appointments: CalendarDays,
  patients: Users,
  consultations: Stethoscope,
  documents: FileText,
  templates: ClipboardList,
  whatsapp: MessageCircle,
  settings: Settings,
};

export function AppSidebar({
  current,
  organizations,
}: {
  current: OrganizationSummary;
  organizations: OrganizationSummary[];
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const setSheet = useAppSheet();
  const basePath = `/app/${encodeURIComponent(current.slug)}`;

  return (
    <Sidebar collapsible="icon" className="border-0">
      <SidebarHeader>
        <Link
          href="/app"
          aria-label="Flowcare — início"
          className="flex h-12 items-center px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <Image
            src="/logo-1.png"
            alt="Flowcare"
            width={1024}
            height={409}
            className="h-auto w-28 group-data-[collapsible=icon]:hidden"
          />
          <Image
            src="/logo-2.png"
            alt=""
            width={638}
            height={582}
            className="hidden size-8 object-contain group-data-[collapsible=icon]:block"
          />
        </Link>
        <SidebarMenu>
          <SidebarMenuItem>
            <OrganizationSwitcher
              current={current}
              organizations={organizations}
              onNavigate={() => setOpenMobile(false)}
              onNewClinic={() => setSheet("new")}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {appSections
              .filter((section) =>
                canOpenSection(current.role, section.segment),
              )
              .map((section) => {
                const href = `${basePath}/${section.segment}`;
                const Icon = sectionIcons[section.segment];
                return (
                  <SidebarMenuItem key={section.segment}>
                    <SidebarMenuButton
                      asChild
                      isActive={
                        pathname === href || pathname.startsWith(`${href}/`)
                      }
                      tooltip={section.label}
                    >
                      <Link href={href} onClick={() => setOpenMobile(false)}>
                        <Icon />
                        <span>{section.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
