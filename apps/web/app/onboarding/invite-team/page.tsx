import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InviteTeamForm } from "@/components/flowcare/onboarding/invite-team-form";
import { OnboardingStepper } from "@/components/flowcare/onboarding/onboarding-stepper";
import { onboardingStepPath } from "@/lib/onboarding-steps";
import { getOnboardingProgress } from "@/server/onboarding";
import { listPendingInvites } from "@/server/onboarding-invites";
import { getAvailableOrganizations } from "@/server/organizations";

export const metadata: Metadata = { title: "Convidar equipe | Flowcare" };

export default async function InviteTeamPage() {
  const progress = await getOnboardingProgress();
  if (!progress) redirect("/login");
  if (progress.completed) redirect("/app");
  if (progress.currentStep !== "TEAM_INVITES")
    redirect(onboardingStepPath(progress.currentStep));

  const organizations = await getAvailableOrganizations();
  const clinic = organizations?.find(
    (org) =>
      org.id === progress.draftData.organizationId && org.role === "ADMIN",
  );
  if (!clinic) redirect("/onboarding/pending");
  const invites = await listPendingInvites(clinic.slug).catch(() => null);

  return (
    <main className="flex flex-1 justify-center px-5 pt-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8">
          <OnboardingStepper currentStep="TEAM_INVITES" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Convide sua equipe
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Convide pessoas para acessar a clínica. Você também pode fazer isso
          depois.
        </p>
        <InviteTeamForm
          initial={invites ?? { data: [], roles: [] }}
          loadError={!invites}
        />
      </div>
    </main>
  );
}
