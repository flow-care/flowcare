import { notFound } from "next/navigation";
import { ModulePlaceholder } from "@/components/flowcare/app/module-placeholder";
import { canOpenSection } from "@/lib/app-navigation";
import { getAvailableOrganizations } from "@/server/organizations";

const settingsTitles: Record<string, string> = {
  team: "Equipe",
  roles: "Papéis",
  clinic: "Clínica",
  hours: "Horários",
  usage: "Consumo",
  audit: "Auditoria",
};

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
  if (section && (section.length !== 1 || !settingsTitles[section[0]]))
    notFound();

  return (
    <ModulePlaceholder
      title={section ? settingsTitles[section[0]] : "Configurações"}
    />
  );
}
