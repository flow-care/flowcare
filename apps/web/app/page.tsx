import { redirect } from "next/navigation";
import { onboardingStepPath } from "@/lib/onboarding-steps";
import { getOnboardingProgress } from "@/server/onboarding";
import { getSessionToken } from "@/server/session";

export default async function Home() {
  const token = await getSessionToken();
  if (!token) {
    redirect("/login");
  }

  const progress = await getOnboardingProgress();
  if (!progress) {
    redirect("/login");
  }

  if (progress.pendingInviteId) {
    redirect(`/accept-invite/${encodeURIComponent(progress.pendingInviteId)}`);
  }

  if (!progress.completed) {
    redirect(onboardingStepPath(progress.currentStep));
  }

  redirect("/app");
}
