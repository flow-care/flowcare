import { notFound } from "next/navigation";
import { ModulePlaceholder } from "@/components/flowcare/app/module-placeholder";
import { appSections, canOpenSection } from "@/lib/app-navigation";
import { getAvailableOrganizations } from "@/server/organizations";

export default async function ModulePage({
  params,
}: {
  params: Promise<{ orgSlug: string; module: string }>;
}) {
  const { orgSlug, module } = await params;
  const section = appSections.find(
    (item) =>
      item.segment === module &&
      module !== "dashboard" &&
      module !== "settings" &&
      module !== "patients",
  );
  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );
  if (!section || !current || !canOpenSection(current.role, module)) notFound();

  return <ModulePlaceholder title={section.label} />;
}
