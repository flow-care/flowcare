import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ClinicForm } from "@/components/flowcare/onboarding/clinic-form";
import { OnboardingStepper } from "@/components/flowcare/onboarding/onboarding-stepper";
import type { Profile } from "@/lib/onboarding-profile";
import { onboardingStepPath } from "@/lib/onboarding-steps";
import { getOnboardingProgress } from "@/server/onboarding";
import {
  ProfileApiError,
  profileApiRequest,
} from "@/server/onboarding-profile";

export const metadata: Metadata = { title: "Criar clínica | Flowcare" };

export default async function OnboardingClinicPage() {
  let profile: Profile | null = null;
  let unauthenticated = false;

  try {
    profile = await profileApiRequest("GET", null);
  } catch (error) {
    unauthenticated =
      error instanceof ProfileApiError && error.code === "UNAUTHENTICATED";
  }

  if (unauthenticated) redirect("/login");
  const progress = await getOnboardingProgress();
  if (progress?.pendingInviteId) {
    redirect(`/accept-invite/${encodeURIComponent(progress.pendingInviteId)}`);
  }
  if (profile && !profile.completed) redirect("/onboarding/profile");
  if (progress?.completed) redirect("/app");
  if (progress && progress.currentStep !== "ORGANIZATION_SETUP") {
    redirect(onboardingStepPath(progress.currentStep));
  }

  return (
    <main className="flex flex-1 justify-center px-5 pt-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8">
          <OnboardingStepper currentStep="ORGANIZATION_SETUP" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Dê um nome à sua clínica
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Defina o nome da sua clínica para continuar.
        </p>
        <ClinicForm />
      </div>
    </main>
  );
}
