"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";

export function AppHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center md:hidden">
      <SidebarTrigger aria-label="Abrir menu lateral" />
    </header>
  );
}
