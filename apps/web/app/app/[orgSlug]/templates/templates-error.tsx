"use client";

import { AlertCircleIcon, RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function TemplatesErrorView({ onRetry }: { onRetry?: () => void }) {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Modelos de Documentos
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gerencie e organize os modelos de receitas, atestados e laudos da
          clínica.
        </p>
      </div>

      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card p-12 text-center">
        <AlertCircleIcon className="mb-3 size-10 text-destructive" />
        <h2 className="text-lg font-semibold text-card-foreground">
          Não foi possível carregar os modelos de documentos
        </h2>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          Ocorreu uma falha ao comunicar com o servidor. Verifique sua conexão e
          tente novamente.
        </p>
        <Button
          variant="outline"
          className="mt-6"
          onClick={() => {
            if (onRetry) {
              onRetry();
            } else {
              router.refresh();
            }
          }}
        >
          <RotateCcwIcon className="mr-2 size-4" />
          Tentar novamente
        </Button>
      </div>
    </div>
  );
}
