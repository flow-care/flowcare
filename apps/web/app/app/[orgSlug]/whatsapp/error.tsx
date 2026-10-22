"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Deliberately does not log the error: server errors on this route may carry
// session or QR data from the WhatsApp provider.
export default function WhatsAppErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">
          Não foi possível carregar o WhatsApp
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Ocorreu um erro inesperado. Tente novamente em instantes.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => reset()}
        className="mt-2 gap-2"
      >
        <RotateCcw className="size-4" aria-hidden />
        Tentar novamente
      </Button>
    </div>
  );
}
