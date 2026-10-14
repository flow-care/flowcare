"use client";

import { AlertCircleIcon, RefreshCwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function AppointmentsErrorState() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-12 text-center text-card-foreground my-8">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircleIcon className="size-6" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">
          Não foi possível carregar a agenda
        </h2>
        <p className="text-sm text-muted-foreground">
          Ocorreu uma falha ao consultar os agendamentos. Verifique sua conexão
          e tente novamente.
        </p>
      </div>
      <Button
        variant="outline"
        onClick={() => router.refresh()}
        className="gap-2 mt-2"
      >
        <RefreshCwIcon className="size-4" />
        Tentar novamente
      </Button>
    </div>
  );
}
