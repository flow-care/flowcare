import { AlertCircle, RefreshCw, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ListAuditLogsResponse } from "@/lib/audit";
import {
  AuditApiError,
  type AuditLogsQueryParams,
  getAuditLogs,
} from "@/server/audit";
import { getAvailableOrganizations } from "@/server/organizations";
import { AuditLogsView } from "./audit-logs-view";

export const metadata: Metadata = {
  title: "Trilha de Auditoria | Flowcare",
};

export function AuditSettingsForbidden({ orgSlug }: { orgSlug: string }) {
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
        Apenas administradores da clínica possuem permissão para visualizar e
        auditar a trilha de ações e acessos sensíveis em conformidade com a
        LGPD.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/dashboard`}>
          Voltar ao Dashboard
        </Link>
      </Button>
    </div>
  );
}

export function AuditSettingsError({
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
          Não foi possível carregar a trilha de auditoria
        </h2>
        <p className="text-sm text-muted-foreground">
          {errorMessage ||
            "Ocorreu uma falha ao consultar os registros de auditoria. Verifique sua conexão e tente novamente."}
        </p>
      </div>
      <Button asChild variant="outline" className="mt-2 gap-2">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/settings/audit`}>
          <RefreshCw className="size-4" />
          Tentar novamente
        </Link>
      </Button>
    </div>
  );
}

export default async function AuditSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams?: Promise<{
    startDate?: string;
    endDate?: string;
    category?: string;
    actor?: string;
    action?: string;
    page?: string;
    limit?: string;
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
    return <AuditSettingsForbidden orgSlug={orgSlug} />;
  }

  const queryParams: AuditLogsQueryParams = {
    action: query.action,
    actorUserId: query.actor,
    startDate: query.startDate,
    endDate: query.endDate,
    page: query.page ? Number.parseInt(query.page, 10) : 1,
    limit: query.limit ? Number.parseInt(query.limit, 10) : 20,
  };

  let auditData: ListAuditLogsResponse | null = null;
  let hasError = false;
  let errorMessage: string | null = null;

  try {
    auditData = await getAuditLogs(orgSlug, queryParams);
  } catch (err) {
    hasError = true;
    if (err instanceof AuditApiError && err.code === "FORBIDDEN") {
      return <AuditSettingsForbidden orgSlug={orgSlug} />;
    }
    errorMessage =
      err instanceof Error
        ? err.message
        : "Ocorreu um erro ao carregar a trilha de auditoria.";
  }

  if (hasError || !auditData) {
    return <AuditSettingsError orgSlug={orgSlug} errorMessage={errorMessage} />;
  }

  return (
    <AuditLogsView
      orgSlug={orgSlug}
      initialEvents={auditData.data}
      pagination={auditData.pagination}
      currentFilters={{
        startDate: query.startDate,
        endDate: query.endDate,
        category: query.category,
        actor: query.actor,
        action: query.action,
        page: queryParams.page,
        limit: queryParams.limit,
      }}
    />
  );
}
