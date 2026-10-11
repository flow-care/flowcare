import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConfigureHoursForm } from "@/components/flowcare/onboarding/configure-hours-form";
import { OnboardingLoadError } from "@/components/flowcare/onboarding/onboarding-load-error";
import { OnboardingStepper } from "@/components/flowcare/onboarding/onboarding-stepper";
import { onboardingStepPath } from "@/lib/onboarding-steps";
import { getOnboardingProgress } from "@/server/onboarding";
import { getOnboardingHours } from "@/server/onboarding-hours";
import { getAvailableOrganizations } from "@/server/organizations";

export const metadata: Metadata = { title: "Horários da clínica | Flowcare" };

export default async function ConfigureHoursPage() {
  const progress = await getOnboardingProgress();
  if (!progress) redirect("/login");
  if (progress.completed) redirect("/app");
  if (progress.currentStep !== "WEEKLY_SCHEDULE")
    redirect(onboardingStepPath(progress.currentStep));
  const organizations = await getAvailableOrganizations();
  const organizationId = progress.draftData.organizationId;
  const clinic = organizations?.find(
    (org) =>
      org.role === "ADMIN" &&
      (typeof organizationId !== "string" || org.id === organizationId),
  );
  if (!clinic) redirect("/onboarding/pending");
  let schedule = null;
  try {
    schedule = await getOnboardingHours();
  } catch {
    /* Display retry guidance below. */
  }
  return (
    <main className="flex flex-1 justify-center px-5 pt-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8">
          <OnboardingStepper currentStep="WEEKLY_SCHEDULE" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Horários de atendimento
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Defina os dias e horários padrão de atendimento da clínica.
        </p>
        {schedule ? (
          <ConfigureHoursForm initial={schedule} />
        ) : (
          <OnboardingLoadError message="Não foi possível carregar os horários da clínica. Recarregue a página." />
        )}
      </div>
    </main>
  );
}
