import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocumentsErrorView } from "@/components/flowcare/documents/documents-error";
import { DocumentsView } from "@/components/flowcare/documents/documents-view";
import { canOpenSection } from "@/lib/app-navigation";
import { getDocuments } from "@/server/documents";
import { getAvailableOrganizations } from "@/server/organizations";

export const metadata: Metadata = {
  title: "Documentos Clínicos | Flowcare",
};

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    type?: string;
    status?: string;
    search?: string;
    patientId?: string;
    page?: string;
    cursor?: string;
    sheet?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const { type, status, search, patientId, page, cursor } = await searchParams;

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );

  if (!current || !canOpenSection(current.role, "documents")) {
    notFound();
  }

  const parsedPage = page ? Number.parseInt(page, 10) : 1;
  const safePage = Number.isNaN(parsedPage) || parsedPage < 1 ? 1 : parsedPage;

  const result = await getDocuments(orgSlug, {
    type,
    status,
    search,
    patientId,
    cursor,
    page: safePage,
    limit: 20,
  });

  if (!result) {
    return <DocumentsErrorView />;
  }

  return (
    <DocumentsView
      orgSlug={orgSlug}
      documents={result.data}
      pageInfo={result.pageInfo}
      currentFilters={{
        type,
        status,
        search,
        patientId,
        page: safePage,
      }}
    />
  );
}
