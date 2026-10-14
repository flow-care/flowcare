import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModulePlaceholder } from "@/components/flowcare/app/module-placeholder";
import { canOpenSection } from "@/lib/app-navigation";
import { getAvailableOrganizations } from "@/server/organizations";

export const metadata: Metadata = {
  title: "Documento Clínico | Flowcare",
};

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; documentId: string }>;
}) {
  const { orgSlug } = await params;
  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );

  if (!current || !canOpenSection(current.role, "documents")) {
    notFound();
  }

  return <ModulePlaceholder title="Visualização do Documento" />;
}
