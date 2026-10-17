import { AlertCircle, RefreshCw, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getAvailableOrganizations } from "@/server/organizations";
import {
  getTeamMembersAndInvites,
  TeamApiError,
  type TeamData,
} from "@/server/team";
import { TeamSettingsView } from "./team-settings-view";

export const metadata: Metadata = {
  title: "Equipe e Permissões | Flowcare",
};

export function TeamSettingsForbidden({ orgSlug }: { orgSlug: string }) {
  return (
    <div className="flex min-h-[420px] w-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldAlert className="size-6 text-muted-foreground" />
      </div>
      <Badge
        variant="outline"
        className="mb-3 text-xs font-semibold text-muted-foreground"
      >
        403 — Acesso Restrito
      </Badge>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Acesso restrito a administradores da clínica
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Apenas administradores da clínica possuem permissão para visualizar e
        gerenciar a equipe, alterar papéis de acesso e enviar ou revogar
        convites.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/dashboard`}>
          Voltar ao Dashboard
        </Link>
      </Button>
    </div>
  );
}

export function TeamSettingsError({
  orgSlug,
  errorMessage,
}: {
  orgSlug: string;
  errorMessage?: string | null;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-12 text-center text-card-foreground my-8 mx-6">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-6" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">
          Não foi possível carregar a equipe
        </h2>
        <p className="text-sm text-muted-foreground">
          {errorMessage ||
            "Ocorreu uma falha ao consultar os colaboradores e convites. Verifique sua conexão e tente novamente."}
        </p>
      </div>
      <Button asChild variant="outline" className="gap-2 mt-2">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/settings/team`}>
          <RefreshCw className="size-4" />
          Tentar novamente
        </Link>
      </Button>
    </div>
  );
}

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
  let hasError = false;
  let errorMessage: string | null = null;

  try {
    teamData = await getTeamMembersAndInvites(orgSlug);
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
      initialInvites={teamData.invites}
      initialSheet={resolvedSearchParams?.sheet}
      initialMemberId={resolvedSearchParams?.memberId}
      defaultTab={
        resolvedSearchParams?.tab === "invites" ? "invites" : "members"
      }
    />
  );
}
