"use client";

import {
  Building2,
  Check,
  ChevronsUpDown,
  LayoutDashboard,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { chooseOrganization } from "@/app/select-organization/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
          className="flex h-12 items-center px-2"
        >
          <Image
            src="/logo-2.png"
            alt="Flowcare"
            width={638}
            height={582}
            className="size-8 object-contain"
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
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Building2 className="size-4" />
                  </span>
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
    </Sidebar>
  );
}
