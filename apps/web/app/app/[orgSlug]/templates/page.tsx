import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canOpenSection } from "@/lib/app-navigation";
import { getAvailableOrganizations } from "@/server/organizations";
import { getTemplatesList } from "@/server/templates";
import { TemplatesErrorView } from "./templates-error";
import { TemplatesView } from "./templates-view";

export const metadata: Metadata = {
  title: "Modelos de Documentos | Flowcare",
};

export default async function TemplatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    type?: string;
    status?: string;
    search?: string;
    cursor?: string;
    sheet?: string;
    templateId?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const { type, status, search, cursor } = await searchParams;

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );

  if (!current || !canOpenSection(current.role, "templates")) {
    notFound();
  }

  const normalizedStatus =
    status?.toUpperCase() === "ARCHIVED" ? "ARCHIVED" : "ACTIVE";

  let result: Awaited<ReturnType<typeof getTemplatesList>> | null = null;
  try {
    result = await getTemplatesList(orgSlug, {
      type,
      status: normalizedStatus,
      search,
      cursor,
      limit: 50,
    });
  } catch {
    return <TemplatesErrorView />;
  }

  if (!result) {
    return <TemplatesErrorView />;
  }

  return (
    <TemplatesView
      orgSlug={orgSlug}
      templates={result.data}
      pageInfo={result.pageInfo}
      currentFilters={{
        type: type ?? "all",
        status: normalizedStatus.toLowerCase(),
        search: search ?? "",
      }}
    />
  );
}
