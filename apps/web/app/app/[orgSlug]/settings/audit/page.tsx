import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ListAuditLogsResponse } from "@/lib/audit";
import {
  AuditApiError,
  type AuditLogsQueryParams,
  getAuditLogs,
} from "@/server/audit";
import { getAvailableOrganizations } from "@/server/organizations";
import { AuditLogsView } from "./audit-logs-view";
import { AuditSettingsError, AuditSettingsForbidden } from "./audit-states";

export const metadata: Metadata = {
  title: "Trilha de Auditoria | Flowcare",
};

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
