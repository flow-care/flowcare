import { AlertCircle, RefreshCw, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  getOrganizationSettings,
  type OrganizationSettings,
} from "@/server/organization-settings";
import { getAvailableOrganizations } from "@/server/organizations";
import { OrganizationSettingsForm } from "./organization-settings-form";

export const metadata = {
  title: "Configurações da Clínica — Flowcare",
};

interface OrganizationSettingsPageProps {
  params: Promise<{ orgSlug: string }>;
}

export default async function OrganizationSettingsPage({
  params,
}: OrganizationSettingsPageProps) {
  const { orgSlug } = await params;
  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );

  if (!current) {
    notFound();
  }

  // Role check: Only ADMIN and ADMIN_PROFESSIONAL can access
  const isAdmin =
    current.role === "ADMIN" || current.role === "ADMIN_PROFESSIONAL";
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Card className="border-destructive/20 bg-destructive/5 p-8 text-center shadow-xs">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="size-6" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-destructive">
            Acesso restrito a administradores da clínica
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Você não possui permissão para visualizar ou alterar os dados
            cadastrais, endereço ou logotipo desta organização.
          </p>
          <div className="mt-6 flex justify-center">
            <Button asChild variant="outline" size="sm">
              <Link href={`/app/${encodeURIComponent(orgSlug)}/dashboard`}>
                Voltar ao dashboard
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // Load clinic settings
  let settings: OrganizationSettings | null = null;
  let loadError: string | null = null;

  try {
    settings = await getOrganizationSettings(orgSlug);
  } catch (err) {
    loadError =
      err instanceof Error
        ? err.message
        : "Não foi possível carregar as configurações da clínica.";
  }

  if (loadError || !settings) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Configurações da Clínica
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie os dados institucionais, endereço oficial e identidade
            visual da organização.
          </p>
        </div>

        <Card className="border-destructive/20 bg-destructive/5 p-6 shadow-xs">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="size-5" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-destructive">
                Erro ao carregar dados da clínica
              </h2>
              <p className="text-sm text-muted-foreground">{loadError}</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/app/${encodeURIComponent(orgSlug)}/settings/organization`}
              >
                <RefreshCw className="mr-2 size-4" />
                Tentar novamente
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Configurações da Clínica
        </h1>
        <p className="text-sm text-muted-foreground">
          Gerencie os dados cadastrais, endereço oficial e logotipo exibido em
          receituários e cabeçalhos.
        </p>
      </div>

      <OrganizationSettingsForm orgSlug={orgSlug} initialSettings={settings} />
    </div>
  );
}
