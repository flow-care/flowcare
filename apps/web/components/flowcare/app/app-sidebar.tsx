"use client";

import {
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronLeft,
  ClipboardList,
  Clock3,
  FileText,
  LayoutDashboard,
  MessageCircle,
  ScrollText,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  type AppSection,
  appSections,
  canOpenSection,
  type SettingsSection,
  settingsSections,
} from "@/lib/app-navigation";
import type { CurrentUserProfile } from "@/server/invites";
import type { OrganizationSummary } from "@/server/organizations";
import { useAppSheet } from "./app-sheet-host";
import { OrganizationSwitcher } from "./organization-switcher";
import { ProfileMenu } from "./profile-menu";

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

const settingsIcons: Record<SettingsSection, typeof Settings> = {
  organization: Building2,
  hours: Clock3,
  team: Users,
  roles: ShieldCheck,
  anamnesis: Stethoscope,
  usage: ChartNoAxesCombined,
  audit: ScrollText,
};

export function AppSidebar({
  current,
  organizations,
  user,
}: {
  current: OrganizationSummary;
  organizations: OrganizationSummary[];
  user: CurrentUserProfile | null;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const setSheet = useAppSheet();
  const basePath = `/app/${encodeURIComponent(current.slug)}`;
  const settingsPath = `${basePath}/settings`;
  const inSettings =
    canOpenSection(current.role, "settings") &&
    (pathname === settingsPath || pathname.startsWith(`${settingsPath}/`));

  return (
    <Sidebar collapsible="icon" className="border-0">
      <SidebarHeader>
        <div className="flex h-12 items-center justify-between px-2 group-data-[collapsible=icon]:hidden">
          <Link href="/app" aria-label="Flowcare — início">
            <Image
              src="/logo-1.png"
              alt="Flowcare"
              width={1024}
              height={409}
              className="h-auto w-28"
            />
          </Link>
          <SidebarTrigger aria-label="Fechar ou recolher menu lateral" />
        </div>
        <div className="group/logo-toggle relative hidden size-8 self-center group-data-[collapsible=icon]:block">
          <Image
            src="/logo-2.png"
            alt=""
            width={638}
            height={582}
            className="size-8 object-contain transition-opacity group-hover/logo-toggle:opacity-0 group-focus-within/logo-toggle:opacity-0"
          />
          <SidebarTrigger
            aria-label="Expandir menu lateral"
            className="absolute inset-0 opacity-0 transition-opacity group-hover/logo-toggle:opacity-100 focus-visible:opacity-100"
          />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <OrganizationSwitcher
              current={current}
              organizations={organizations}
              onNavigate={() => setOpenMobile(false)}
              onNewClinic={() => setSheet("new-clinic")}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {inSettings && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip="Voltar ao menu principal"
                  className="relative justify-center"
                >
                  <Link
                    href={`${basePath}/dashboard`}
                    aria-label="Voltar ao menu principal"
                    onClick={() => setOpenMobile(false)}
                  >
                    <ChevronLeft className="absolute left-2" />
                    <span className="group-data-[collapsible=icon]:hidden">
                      Configurações
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {inSettings
              ? settingsSections.map((section) => {
                  const href =
                    section.segment === "hours"
                      ? `${settingsPath}/schedules`
                      : `${settingsPath}/${section.segment}`;
                  const Icon = settingsIcons[section.segment];
                  return (
                    <SidebarMenuItem key={section.segment}>
                      <SidebarMenuButton
                        asChild
                        isActive={
                          pathname === href ||
                          (section.segment === "hours" &&
                            (pathname.startsWith(`${settingsPath}/schedules`) ||
                              pathname.startsWith(`${settingsPath}/hours`)))
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
                })
              : appSections
                  .filter(
                    (section) =>
                      section.segment !== "settings" &&
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
                          <Link
                            href={href}
                            onClick={() => setOpenMobile(false)}
                          >
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
      <SidebarFooter>
        <SidebarMenu>
          <ProfileMenu
            user={user}
            settingsHref={
              canOpenSection(current.role, "settings")
                ? `${settingsPath}/organization`
                : undefined
            }
            onNavigate={() => setOpenMobile(false)}
          />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
