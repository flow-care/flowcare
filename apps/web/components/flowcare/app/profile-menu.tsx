"use client";

import { ChevronsUpDown, LogOut, Settings } from "lucide-react";
import Link from "next/link";
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

export function ProfileMenu({
  user,
  settingsHref,
  onNavigate,
}: {
  user: CurrentUserProfile | null;
  settingsHref?: string;
  onNavigate?: () => void;
}) {
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            aria-label={`Abrir menu de ${user?.fullName || "perfil"}`}
          >
            <Avatar className="after:hidden">
              <AvatarImage
                src={`https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(user?.fullName.trim() || "Flowcare")}&lettersVariant=single`}
                alt=""
                referrerPolicy="no-referrer"
              />
              <AvatarFallback>
                {user?.fullName.trim().charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className="block truncate font-semibold">
                {user?.fullName || "Minha conta"}
              </span>
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
          {settingsHref && (
            <DropdownMenuItem asChild>
              <Link href={settingsHref} onClick={onNavigate}>
                <Settings /> Configurações
              </Link>
            </DropdownMenuItem>
          )}
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
