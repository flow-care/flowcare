"use client";

import {
  ChevronsUpDown,
  LockKeyhole,
  LogOut,
  Settings,
  User,
} from "lucide-react";
import Link from "next/link";
import { logoutAction } from "@/app/app/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { CurrentUserProfile } from "@/server/invites";
import { ThemeSelector } from "./theme-selector";

export function ProfileMenu({
  user,
  settingsHref,
  onNavigate,
}: {
  user: CurrentUserProfile | null;
  settingsHref?: string;
  onNavigate?: () => void;
}) {
  const avatarUrl =
    (user as { profilePhotoUrl?: string | null; photoUrl?: string | null })
      ?.profilePhotoUrl ||
    user?.photoUrl ||
    `https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(user?.fullName.trim() || "Flowcare")}&lettersVariant=single`;

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
                src={avatarUrl}
                alt={user?.fullName || ""}
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
          <DropdownMenuItem asChild>
            <Link href="/account/profile" onClick={onNavigate}>
              <User /> Meu Perfil
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/account/security" onClick={onNavigate}>
              <LockKeyhole /> Segurança
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="h-0 border-t border-dashed border-border bg-transparent" />
          {settingsHref && (
            <>
              <DropdownMenuItem asChild>
                <Link href={settingsHref} onClick={onNavigate}>
                  <Settings /> Configurações
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="h-0 border-t border-dashed border-border bg-transparent" />
            </>
          )}
          <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-xs text-muted-foreground">
            <span>Tema</span>
            <ThemeSelector />
          </div>
          <DropdownMenuSeparator className="h-0 border-t border-dashed border-border bg-transparent" />
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
