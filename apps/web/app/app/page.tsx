import { redirect } from "next/navigation";
import {
  getActiveOrganization,
  getAvailableOrganizations,
} from "@/server/organizations";
import { getSessionToken } from "@/server/session";

export default async function AppIndexPage() {
  if (!(await getSessionToken())) redirect("/login");

  const organizations = await getAvailableOrganizations();
  if (!organizations) {
    return (
      <main className="mx-auto w-full max-w-lg px-5 py-20">
        <h1 className="text-2xl font-semibold">
          Não foi possível carregar suas clínicas
        </h1>
        <p className="mt-3 text-muted-foreground">
          Atualize a página para tentar novamente.
        </p>
      </main>
    );
  }
  if (organizations.length === 0) redirect("/onboarding/clinic");
  if (organizations.length === 1) {
    redirect(`/app/${encodeURIComponent(organizations[0].slug)}/dashboard`);
  }
  const activeOrganization = await getActiveOrganization();
  const active = organizations.find(
    (organization) =>
      organization.id === activeOrganization?.id &&
      organization.slug === activeOrganization.slug,
  );
  if (active) redirect(`/app/${encodeURIComponent(active.slug)}/dashboard`);
  redirect("/select-organization");
}
