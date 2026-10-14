"use client";

import { AlertCircleIcon, RotateCcwIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function PatientsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Patients error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center rounded-lg border border-dashed border-destructive/30 bg-card p-12 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircleIcon className="size-6" />
      </div>
      <h2 className="text-xl font-semibold text-foreground">
        Não foi possível carregar os pacientes
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Ocorreu um erro ao obter os dados da clínica. Verifique sua conexão e
        tente novamente.
      </p>
      <Button onClick={() => reset()} variant="default" className="mt-6">
        <RotateCcwIcon className="mr-2 size-4" />
        Tentar novamente
      </Button>
    </div>
  );
}
