"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useTeamNavigation() {
  return {
    router: useRouter(),
    pathname: usePathname(),
    searchParams: useSearchParams(),
  };
}
