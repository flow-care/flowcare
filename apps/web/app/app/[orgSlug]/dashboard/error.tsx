"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Não foi possível carregar os dados
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {error.message ||
            "Ocorreu um erro ao carregar os indicadores operacionais da clínica."}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => reset()}
        className="mt-2 gap-2"
      >
        <RotateCcw className="size-4" />
        Tentar novamente
      </Button>
    </div>
  );
}
