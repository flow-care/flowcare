import { notFound } from "next/navigation";
import { AppSidebar } from "@/components/flowcare/app/app-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getAvailableOrganizations } from "@/server/organizations";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organizations = await getAvailableOrganizations();
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
  if (!current) notFound();

  return (
    <SidebarProvider>
      <AppSidebar current={current} organizations={organizations} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-3 px-5 md:px-8">
          <SidebarTrigger aria-label="Alternar menu lateral" />
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
