import { AlertCircle, RefreshCw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function WhatsAppForbidden({
  orgSlug,
  description,
}: {
  orgSlug: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[360px] w-full flex-col items-center justify-center rounded-xl border border-border bg-card p-8 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldAlert className="size-6" aria-hidden />
      </div>
      <Badge
        variant="outline"
        className="mb-3 text-xs font-semibold text-muted-foreground"
      >
        403 — Acesso Restrito
      </Badge>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Você não tem permissão para acessar esta área
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/dashboard`}>
          Voltar ao Dashboard
        </Link>
      </Button>
    </div>
  );
}

export function WhatsAppSectionError({
  title,
  message,
  retryHref,
}: {
  title: string;
  message?: string;
  retryHref: string;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-12 text-center text-card-foreground"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-6" aria-hidden />
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">
          {message ||
            "Ocorreu uma falha ao comunicar com o servidor. Verifique sua conexão e tente novamente."}
        </p>
      </div>
      <Button asChild variant="outline" className="mt-2 gap-2">
        <Link href={retryHref}>
          <RefreshCw className="size-4" aria-hidden />
          Tentar novamente
        </Link>
      </Button>
    </div>
  );
}

export function WhatsAppSectionSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
