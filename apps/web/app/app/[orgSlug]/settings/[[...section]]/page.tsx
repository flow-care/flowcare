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
  if (section[0] === "team") {
    redirect(`/app/${encodeURIComponent(orgSlug)}/settings/team`);
  }
  if (section[0] === "roles") {
    redirect(`/app/${encodeURIComponent(orgSlug)}/settings/roles`);
  }
  if (section[0] === "audit") {
    redirect(`/app/${encodeURIComponent(orgSlug)}/settings/audit`);
  }
  if (section[0] === "usage") {
    redirect(`/app/${encodeURIComponent(orgSlug)}/settings/usage`);
  }
  const selected = settingsSections.find((item) => item.segment === section[0]);
  if (section.length !== 1 || !selected) notFound();

  return <ModulePlaceholder title={selected.label} />;
}
