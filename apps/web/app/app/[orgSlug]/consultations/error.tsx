"use client";

import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default function ConsultationsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-6">
      <Empty className="border border-destructive/20 bg-destructive/5 py-12">
        <EmptyMedia
          variant="icon"
          className="bg-destructive/10 text-destructive"
        >
          <AlertCircle className="size-6 text-destructive" />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle className="text-destructive">
            Erro ao carregar atendimentos clínicos
          </EmptyTitle>
          <EmptyDescription>
            {error.message ||
              "Ocorreu uma falha inesperada ao buscar os dados da clínica."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => reset()}>
            <RotateCcw className="mr-2 size-4" />
            Tentar novamente
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
