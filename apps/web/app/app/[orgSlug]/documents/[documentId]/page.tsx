import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { canOpenSection } from "@/lib/app-navigation";
import {
  type DocumentDetail,
  DocumentsApiError,
  getDocumentDetails,
} from "@/server/documents";
import { getAvailableOrganizations } from "@/server/organizations";
import { DocumentDetailView } from "./document-detail-view";

export const metadata: Metadata = {
  title: "Visualização do Documento | Flowcare",
};

export default async function DocumentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; documentId: string }>;
  searchParams: Promise<{ tab?: string; sheet?: string }>;
}) {
  const { orgSlug, documentId } = await params;
  const { tab, sheet } = await searchParams;

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );

  if (!current || !canOpenSection(current.role, "documents")) {
    notFound();
  }

  // Acceptance criterion:
  // Acesso à URL /documents/:documentId sem tab direciona e renderiza a aba de prévia por padrão (tab=preview).
  if (!tab) {
    const qs = new URLSearchParams();
    qs.set("tab", "preview");
    if (sheet) qs.set("sheet", sheet);
    redirect(
      `/app/${encodeURIComponent(orgSlug)}/documents/${encodeURIComponent(documentId)}?${qs.toString()}`,
    );
  }

  let document: DocumentDetail;
  try {
    document = await getDocumentDetails(orgSlug, documentId);
  } catch (error) {
    if (error instanceof DocumentsApiError && error.code === "NOT_FOUND") {
      notFound();
    }
    throw error;
  }

  return (
    <DocumentDetailView
      orgSlug={orgSlug}
      document={document}
      activeTab={tab || "preview"}
      initialSheet={sheet}
      userRole={current.role}
      organizationName={current.name}
    />
  );
}
