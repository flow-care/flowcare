import { AlertCircle, RefreshCw, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ClinicUsageResponse } from "@/lib/usage";
import { getAvailableOrganizations } from "@/server/organizations";
import { getTranscriptionUsage, UsageApiError } from "@/server/usage";
import { UsageView } from "./usage-view";

export const metadata: Metadata = {
  title: "Consumo de Transcrições | Flowcare",
};

export function UsageSettingsForbidden({ orgSlug }: { orgSlug: string }) {
  return (
    <div className="flex min-h-[420px] w-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldAlert className="size-6 text-muted-foreground" />
      </div>
      <Badge
        variant="outline"
        className="mb-3 text-xs font-semibold text-muted-foreground"
      >
        403 — Acesso Restrito
      </Badge>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Acesso restrito a administradores da clínica
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Apenas administradores da clínica possuem permissão para acompanhar
        métricas e consumo de transcrição por inteligência artificial.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/dashboard`}>
          Voltar ao Dashboard
        </Link>
      </Button>
    </div>
  );
}

export function UsageSettingsError({
  orgSlug,
  errorMessage,
}: {
  orgSlug: string;
  errorMessage?: string | null;
}) {
  return (
    <div className="my-8 mx-6 flex flex-col items-center justify-center gap-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-12 text-center text-card-foreground">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-6" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">
          Não foi possível carregar o consumo de transcrições
        </h2>
        <p className="text-sm text-muted-foreground">
          {errorMessage ||
            "Ocorreu uma falha ao consultar as métricas de consumo de transcrição. Verifique sua conexão e tente novamente."}
        </p>
      </div>
      <Button asChild variant="outline" className="mt-2 gap-2">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/settings/usage`}>
          <RefreshCw className="size-4" />
          Tentar novamente
        </Link>
      </Button>
    </div>
  );
}

export default async function UsageSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams?: Promise<{
    month?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const query = (await searchParams) ?? {};

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find((org) => org.slug === orgSlug);

  if (!current) {
    notFound();
  }

  // Role check: Only ADMIN and ADMIN_PROFESSIONAL have access.
  if (current.role !== "ADMIN" && current.role !== "ADMIN_PROFESSIONAL") {
    return <UsageSettingsForbidden orgSlug={orgSlug} />;
  }

  let usageData: ClinicUsageResponse | null = null;
  let hasError = false;
  let errorMessage: string | null = null;

  try {
    usageData = await getTranscriptionUsage(orgSlug, {
      month: query.month,
    });
  } catch (err) {
    hasError = true;
    if (err instanceof UsageApiError && err.code === "FORBIDDEN") {
      return <UsageSettingsForbidden orgSlug={orgSlug} />;
    }
    errorMessage =
      err instanceof Error
        ? err.message
        : "Ocorreu um erro ao carregar as métricas de consumo.";
  }

  if (hasError || !usageData) {
    return <UsageSettingsError orgSlug={orgSlug} errorMessage={errorMessage} />;
  }

  return <UsageView orgSlug={orgSlug} data={usageData} />;
}
