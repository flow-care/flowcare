import { notFound, redirect } from "next/navigation";
import { ModulePlaceholder } from "@/components/flowcare/app/module-placeholder";
import { canOpenSection, settingsSections } from "@/lib/app-navigation";
import { getAvailableOrganizations } from "@/server/organizations";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string; section?: string[] }>;
}) {
  const { orgSlug, section } = await params;
  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );
  if (!current || !canOpenSection(current.role, "settings")) notFound();
  if (!section || section[0] === "clinic" || section[0] === "organization") {
    redirect(`/app/${encodeURIComponent(orgSlug)}/settings/organization`);
  }
  if (section[0] === "audit") {
    redirect(`/app/${encodeURIComponent(orgSlug)}/settings/audit`);
  }
  if (section[0] === "hours" || section[0] === "schedules") {
    redirect(`/app/${encodeURIComponent(orgSlug)}/settings/schedules`);
  }
  const selected = settingsSections.find((item) => item.segment === section[0]);
  if (section.length !== 1 || !selected) notFound();

  return <ModulePlaceholder title={selected.label} />;
}
