"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  isServerActionMissingError,
  recoverFromStaleBuild,
  STALE_BUILD_MESSAGE,
} from "@/lib/stale-build";

/**
 * Boundary de último recurso: só existe para o caso de build desatualizado no
 * navegador (Server Action de uma build anterior). Nesse caso recarrega em vez
 * de mostrar "algo deu errado" — que foi o que confundiu o usuário.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [staleBuild, setStaleBuild] = useState(false);

  useEffect(() => {
    if (isServerActionMissingError(error)) {
      setStaleBuild(true);
      recoverFromStaleBuild();
    }
  }, [error]);

  return (
    <div className="relative flex min-h-svh flex-col bg-background py-28 text-foreground">
      <header className="absolute inset-x-0 top-7 flex justify-center">
        <Link href="/" aria-label="Flowcare — início">
          <Image
            src="/logo-1.png"
            alt="Flowcare"
            width={1024}
            height={409}
            className="h-auto w-[148px]"
            priority
          />
        </Link>
      </header>
      <main className="mx-auto my-auto flex w-full max-w-[424px] flex-col items-center px-6 text-center">
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {staleBuild ? "Atualizando o Flowcare" : "Algo deu errado"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {staleBuild
            ? STALE_BUILD_MESSAGE
            : "A página encontrou um erro inesperado. Tente novamente; se continuar, avise o suporte."}
        </p>
        <Button
          asChild
          className="mt-6 h-[46px] w-full rounded-lg text-base font-normal cursor-pointer"
        >
          <Link href="/">{staleBuild ? "Recarregar" : "Ir para o início"}</Link>
        </Button>
        {!staleBuild && (
          <Button
            type="button"
            variant="ghost"
            onClick={reset}
            className="mt-2 h-[46px] w-full rounded-lg text-base font-normal cursor-pointer"
          >
            Tentar novamente
          </Button>
        )}
      </main>
    </div>
  );
}
