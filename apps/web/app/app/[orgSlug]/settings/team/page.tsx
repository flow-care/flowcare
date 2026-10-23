import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAvailableOrganizations } from "@/server/organizations";
import {
  getPermissionCatalog,
  getTeamMembersAndInvites,
  type PermissionCatalog,
  TeamApiError,
  type TeamData,
} from "@/server/team";
import { TeamSettingsView } from "./team-settings-view";
import { TeamSettingsError, TeamSettingsForbidden } from "./team-states";

export const metadata: Metadata = {
  title: "Equipe e Permissões | Flowcare",
};

export default async function TeamSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams?: Promise<{
    sheet?: string;
    tab?: string;
    memberId?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const organizations = await getAvailableOrganizations();
  const current = organizations?.find((org) => org.slug === orgSlug);

  if (!current) {
    notFound();
  }

  // Role check: Only ADMIN and ADMIN_PROFESSIONAL have access.
  if (current.role !== "ADMIN" && current.role !== "ADMIN_PROFESSIONAL") {
    return <TeamSettingsForbidden orgSlug={orgSlug} />;
  }

  let teamData: TeamData | null = null;
  let catalog: PermissionCatalog | null = null;
  let hasError = false;
  let errorMessage: string | null = null;

  try {
    [teamData, catalog] = await Promise.all([
      getTeamMembersAndInvites(orgSlug),
      getPermissionCatalog(orgSlug),
    ]);
  } catch (err) {
    hasError = true;
    if (err instanceof TeamApiError && err.code === "FORBIDDEN") {
      return <TeamSettingsForbidden orgSlug={orgSlug} />;
    }
    errorMessage =
      err instanceof Error
        ? err.message
        : "Ocorreu um erro ao carregar a equipe.";
  }

  if (hasError || !teamData) {
    return <TeamSettingsError orgSlug={orgSlug} errorMessage={errorMessage} />;
  }

  return (
    <TeamSettingsView
      orgSlug={orgSlug}
      initialMembers={teamData.members}
      permissionCatalog={catalog}
      isSoloClinic={teamData.isSoloClinic}
      initialInvites={teamData.invites}
      initialSheet={resolvedSearchParams?.sheet}
      initialMemberId={resolvedSearchParams?.memberId}
      defaultTab={
        resolvedSearchParams?.tab === "invites" ? "invites" : "members"
      }
    />
  );
}
