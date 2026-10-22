import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ClinicUsageResponse } from "@/lib/usage";
import { getAvailableOrganizations } from "@/server/organizations";
import { getTranscriptionUsage, UsageApiError } from "@/server/usage";
import { UsageSettingsError, UsageSettingsForbidden } from "./usage-states";
import { UsageView } from "./usage-view";

export const metadata: Metadata = {
  title: "Consumo de Transcrições | Flowcare",
};

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
