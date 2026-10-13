import Link from "next/link";
import { AppShell } from "@/components/flowcare/app/app-shell";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/server/invites";
import { getAvailableOrganizations } from "@/server/organizations";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const [organizations, user] = await Promise.all([
    getAvailableOrganizations(),
    getCurrentUser(),
  ]);
  if (!organizations) {
    return (
      <main className="mx-auto w-full max-w-4xl px-6 py-16">
        <h1 className="text-2xl font-semibold">
          Não foi possível carregar a clínica
        </h1>
        <p className="mt-3 text-muted-foreground">
          Atualize a página para tentar novamente.
        </p>
      </main>
    );
  }
  const current = organizations.find(
    (organization) => organization.slug === orgSlug,
  );
  if (!current) {
    return (
      <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold">
          Acesso à clínica indisponível
        </h1>
        <p className="mt-3 text-muted-foreground">
          Esta clínica não existe ou sua conta não tem acesso a ela.
        </p>
        <Button asChild className="mt-6">
          <Link href="/app">Ir para minhas clínicas</Link>
        </Button>
      </main>
    );
  }

  return (
    <AppShell current={current} organizations={organizations} user={user}>
      {children}
    </AppShell>
  );
}
