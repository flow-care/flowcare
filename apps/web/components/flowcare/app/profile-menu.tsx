"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";
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
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { CurrentUserProfile } from "@/server/invites";

export function ProfileMenu({ user }: { user: CurrentUserProfile | null }) {
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            aria-label={`Abrir menu de ${user?.fullName || "perfil"}`}
          >
            <Avatar className="after:hidden">
              {user?.photoUrl && <AvatarImage src={user.photoUrl} alt="" />}
              <AvatarFallback>
                {user?.fullName.trim().charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className="block truncate font-semibold">
                {user?.fullName || "Minha conta"}
              </span>
              {user?.email && (
                <span className="block truncate text-xs text-muted-foreground">
                  {user.email}
                </span>
              )}
            </span>
            <ChevronsUpDown className="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-56">
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
    </SidebarMenuItem>
  );
}
