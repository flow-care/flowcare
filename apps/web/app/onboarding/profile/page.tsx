import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OnboardingLoadError } from "@/components/flowcare/onboarding/onboarding-load-error";
import { OnboardingStepper } from "@/components/flowcare/onboarding/onboarding-stepper";
import { ProfileForm } from "@/components/flowcare/onboarding/profile-form";
import type { Profile } from "@/lib/onboarding-profile";
import { onboardingStepPath } from "@/lib/onboarding-steps";
import { getOnboardingProgress } from "@/server/onboarding";
import {
  ProfileApiError,
  profileApiRequest,
} from "@/server/onboarding-profile";

export const metadata: Metadata = { title: "Complete seu perfil | Flowcare" };

export default async function OnboardingProfilePage() {
  let profile: Profile | null = null;
  let loadError = false;
  let unauthenticated = false;
  try {
    profile = await profileApiRequest("GET", null);
  } catch (error) {
    unauthenticated =
      error instanceof ProfileApiError && error.code === "UNAUTHENTICATED";
    loadError = true;
  }

  if (unauthenticated) redirect("/login");
  const progress = await getOnboardingProgress();
  if (progress?.pendingInviteId) {
    redirect(`/accept-invite/${encodeURIComponent(progress.pendingInviteId)}`);
  }
  if (profile?.completed) {
    if (progress?.completed) redirect("/app");
    redirect(onboardingStepPath(progress?.currentStep ?? "ORGANIZATION_SETUP"));
  }

  return (
    <main className="flex flex-1 justify-center px-5 pt-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8">
          <OnboardingStepper currentStep="PROFILE_SETUP" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Complete seu perfil
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Confira seus dados pessoais antes de configurar a clínica.
        </p>
        {loadError ? (
          <OnboardingLoadError message="Não foi possível carregar seu perfil. Recarregue a página para tentar novamente." />
        ) : profile ? (
          <ProfileForm initialProfile={profile} />
        ) : null}
      </div>
    </main>
  );
}
