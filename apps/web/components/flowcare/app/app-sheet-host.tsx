"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext } from "react";
import { NewClinicSheet } from "./new-clinic-sheet";

type AppSheet = "new-clinic";
const SheetContext = createContext<(sheet: AppSheet | null) => void>(() => {});

export function useAppSheet() {
  return useContext(SheetContext);
}

export function AppSheetHost({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const activeSheet = searchParams.get("sheet");
  const setSheet = useCallback((sheet: AppSheet | null) => {
    const url = new URL(window.location.href);
    if (sheet) url.searchParams.set("sheet", sheet);
    else url.searchParams.delete("sheet");
    window.history[sheet ? "pushState" : "replaceState"](null, "", url);
  }, []);

  return (
    <SheetContext.Provider value={setSheet}>
      {children}
      <NewClinicSheet
        open={activeSheet === "new-clinic"}
        onOpenChange={(open) => setSheet(open ? "new-clinic" : null)}
        onCreated={() => setSheet(null)}
      />
    </SheetContext.Provider>
  );
}
