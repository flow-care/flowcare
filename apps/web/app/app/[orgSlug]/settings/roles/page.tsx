import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { OrganizationRolesData } from "@/lib/roles";
import { getAvailableOrganizations } from "@/server/organizations";
import { getOrganizationRoles, RolesApiError } from "@/server/roles";
import { RolesSettingsError, RolesSettingsForbidden } from "./roles-states";
import { RolesView } from "./roles-view";

export const metadata: Metadata = {
  title: "Papéis de Acesso | Flowcare",
};

export default async function RolesSettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organizations = await getAvailableOrganizations();
  const current = organizations?.find((org) => org.slug === orgSlug);

  if (!current) {
    notFound();
  }

  // Role check: Only ADMIN and ADMIN_PROFESSIONAL have access.
  if (current.role !== "ADMIN" && current.role !== "ADMIN_PROFESSIONAL") {
    return <RolesSettingsForbidden orgSlug={orgSlug} />;
  }

  let rolesData: OrganizationRolesData | null = null;
  let hasError = false;
  let errorMessage: string | null = null;

  try {
    rolesData = await getOrganizationRoles(orgSlug);
  } catch (err) {
    hasError = true;
    if (err instanceof RolesApiError && err.code === "FORBIDDEN") {
      return <RolesSettingsForbidden orgSlug={orgSlug} />;
    }
    errorMessage =
      err instanceof Error
        ? err.message
        : "Ocorreu um erro ao carregar os papéis de acesso.";
  }

  if (hasError || !rolesData) {
    return <RolesSettingsError orgSlug={orgSlug} errorMessage={errorMessage} />;
  }

  return <RolesView orgSlug={orgSlug} rolesData={rolesData} />;
}
