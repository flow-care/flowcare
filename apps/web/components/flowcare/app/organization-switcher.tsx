"use client";

import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { chooseOrganization } from "@/app/select-organization/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import type { OrganizationSummary } from "@/server/organizations";

const roleLabels: Record<OrganizationSummary["role"], string> = {
  ADMIN: "Administrador",
  ADMIN_PROFESSIONAL: "Administrador e profissional",
  PROFESSIONAL: "Profissional",
  RECEPTIONIST: "Recepção",
};

export function OrganizationSwitcher({
  current,
  organizations,
  onNavigate,
  onNewClinic,
  placement = "sidebar",
}: {
  current: OrganizationSummary;
  organizations: OrganizationSummary[];
  onNavigate?: () => void;
  onNewClinic: () => void;
  placement?: "sidebar" | "header";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchOrganization(organization: OrganizationSummary) {
    if (organization.id === current.id || pending) return;
    startTransition(async () => {
      try {
        if (!(await chooseOrganization(organization.slug))) {
          toast.error("Não foi possível selecionar a clínica.");
          return;
        }
        onNavigate?.();
        router.replace(
          `/app/${encodeURIComponent(organization.slug)}/dashboard`,
        );
      } catch {
        toast.error("Não foi possível selecionar a clínica.");
      }
    });
  }

  const triggerContent = (
    <>
      {placement === "sidebar" && (
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
      )}
      <span className="min-w-0 flex-1 text-left leading-tight">
        <span className="block truncate font-semibold">{current.name}</span>
        {placement === "sidebar" && (
          <span className="block truncate text-xs text-muted-foreground">
            {roleLabels[current.role]}
          </span>
        )}
      </span>
      <ChevronsUpDown className="ml-auto size-4" />
    </>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {placement === "sidebar" ? (
          <SidebarMenuButton
            size="lg"
            aria-label={`Clínica atual: ${current.name}. Trocar clínica`}
            disabled={pending}
          >
            {triggerContent}
          </SidebarMenuButton>
        ) : (
          <button
            type="button"
            aria-label={`Clínica atual: ${current.name}. Trocar clínica`}
            disabled={pending}
            className="flex min-w-0 max-w-52 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
          >
            {triggerContent}
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="min-w-56">
        <DropdownMenuLabel>Suas clínicas</DropdownMenuLabel>
        {organizations.map((organization) => (
          <DropdownMenuItem
            key={organization.id}
            disabled={pending}
            onSelect={() => switchOrganization(organization)}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{organization.name}</span>
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
            onNavigate?.();
            onNewClinic();
          }}
        >
          <Plus />
          Nova clínica
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
