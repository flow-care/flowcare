import { redirect } from "next/navigation";
import { OrganizationSelector } from "@/components/flowcare/organizations/organization-selector";
import { onboardingStepPath } from "@/lib/onboarding-steps";
import { getOnboardingProgress } from "@/server/onboarding";
import { getAvailableOrganizations } from "@/server/organizations";
import { getSessionToken } from "@/server/session";

export default async function SelectOrganizationPage() {
  if (!(await getSessionToken())) redirect("/login");
  const progress = await getOnboardingProgress();
  if (!progress) redirect("/login");
  if (!progress.completed) redirect(onboardingStepPath(progress.currentStep));

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

  return (
    <main className="mx-auto w-full max-w-lg px-5 py-20">
      <h1 className="text-3xl font-semibold tracking-tight">
        Escolha uma clínica
      </h1>
      <OrganizationSelector organizations={organizations} />
    </main>
  );
}
