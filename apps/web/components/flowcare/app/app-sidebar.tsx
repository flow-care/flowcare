"use client";

import { Check, ChevronsUpDown, LayoutDashboard, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { chooseOrganization } from "@/app/select-organization/actions";
import { NewClinicSheet } from "@/components/flowcare/app/new-clinic-sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { OrganizationSummary } from "@/server/organizations";

const roleLabels: Record<OrganizationSummary["role"], string> = {
  ADMIN: "Administrador",
  ADMIN_PROFESSIONAL: "Administrador e profissional",
  PROFESSIONAL: "Profissional",
  RECEPTIONIST: "Recepção",
};

export function AppSidebar({
  current,
  organizations,
}: {
  current: OrganizationSummary;
  organizations: OrganizationSummary[];
}) {
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const [pending, startTransition] = useTransition();
  const [newClinicOpen, setNewClinicOpen] = useState(false);

  useEffect(() => {
    const syncSheetFromUrl = () => {
      setNewClinicOpen(
        new URL(window.location.href).searchParams.get("sheet") === "new",
      );
    };
    syncSheetFromUrl();
    window.addEventListener("popstate", syncSheetFromUrl);
    return () => window.removeEventListener("popstate", syncSheetFromUrl);
  }, []);

  function setNewClinicSheetOpen(open: boolean) {
    const url = new URL(window.location.href);
    if (open) url.searchParams.set("sheet", "new");
    else url.searchParams.delete("sheet");
    if (open) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    setNewClinicOpen(open);
  }

  function switchOrganization(organization: OrganizationSummary) {
    if (organization.id === current.id || pending) return;
    startTransition(async () => {
      try {
        if (!(await chooseOrganization(organization.slug))) {
          toast.error("Não foi possível selecionar a clínica.");
          return;
        }
        setOpenMobile(false);
        router.replace(
          `/app/${encodeURIComponent(organization.slug)}/dashboard`,
        );
      } catch {
        toast.error("Não foi possível selecionar a clínica.");
      }
    });
  }

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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  aria-label={`Clínica atual: ${current.name}. Trocar clínica`}
                  disabled={pending}
                >
                  <Avatar className="after:hidden">
                    <AvatarImage
                      src={`https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(current.name.trim() || current.slug)}&lettersVariant=single`}
                      alt=""
                      referrerPolicy="no-referrer"
                    />
                    <AvatarFallback>
                      {current.name.trim().charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 text-left leading-tight">
                    <span className="block truncate font-semibold">
                      {current.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {roleLabels[current.role]}
                    </span>
                  </span>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={isMobile ? "bottom" : "right"}
                align="start"
                className="min-w-56"
              >
                <DropdownMenuLabel>Suas clínicas</DropdownMenuLabel>
                {organizations.map((organization) => (
                  <DropdownMenuItem
                    key={organization.id}
                    disabled={pending}
                    onSelect={() => switchOrganization(organization)}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium">
                        {organization.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {roleLabels[organization.role]}
                      </span>
                    </span>
                    {organization.id === current.id && (
                      <Check aria-label="Selecionada" className="size-4" />
                    )}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    setOpenMobile(false);
                    setNewClinicSheetOpen(true);
                  }}
                >
                  <Plus />
                  Nova clínica
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive tooltip="Dashboard">
                <Link
                  href={`/app/${encodeURIComponent(current.slug)}/dashboard`}
                  onClick={() => setOpenMobile(false)}
                >
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
      <NewClinicSheet
        open={newClinicOpen}
        onOpenChange={setNewClinicSheetOpen}
        onCreated={() => setOpenMobile(false)}
      />
    </Sidebar>
  );
}
