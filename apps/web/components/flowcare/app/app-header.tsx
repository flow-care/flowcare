"use client";

import { LogOut } from "lucide-react";
import { logoutAction } from "@/app/app/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger } from "@/components/ui/sidebar";
import type { CurrentUserProfile } from "@/server/invites";
import type { OrganizationSummary } from "@/server/organizations";
import { useAppSheet } from "./app-sheet-host";
import { OrganizationSwitcher } from "./organization-switcher";

export function AppHeader({
  current,
  organizations,
  user,
}: {
  current: OrganizationSummary;
  organizations: OrganizationSummary[];
  user: CurrentUserProfile | null;
}) {
  const setSheet = useAppSheet();

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 px-5 md:px-8">
      <SidebarTrigger aria-label="Alternar menu lateral" />
      <OrganizationSwitcher
        current={current}
        organizations={organizations}
        onNewClinic={() => setSheet("new")}
        placement="header"
      />
      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Abrir menu do perfil"
              className="rounded-full focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Avatar className="after:hidden">
                {user?.photoUrl && <AvatarImage src={user.photoUrl} alt="" />}
                <AvatarFallback>
                  {user?.fullName.trim().charAt(0).toUpperCase() || "?"}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="truncate text-sm text-foreground">
                {user?.fullName || "Minha conta"}
              </span>
              {user?.email && (
                <span className="truncate font-normal">{user.email}</span>
              )}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <form action={logoutAction}>
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full">
                  <LogOut /> Sair
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
