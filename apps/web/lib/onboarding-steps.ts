export const onboardingSteps = [
  { id: "PROFILE_SETUP", title: "Perfil", path: "/onboarding/profile" },
  { id: "ORGANIZATION_SETUP", title: "Clínica", path: "/onboarding/clinic" },
  {
    id: "CLINIC_DETAILS",
    title: "Dados e contato",
    path: "/onboarding/configure-clinic",
  },
  {
    id: "CLINIC_ADDRESS",
    title: "Endereço",
    path: "/onboarding/configure-clinic/address",
  },
  {
    id: "WEEKLY_SCHEDULE",
    title: "Horários",
    path: "/onboarding/configure-hours",
  },
  { id: "TEAM_INVITES", title: "Equipe", path: "/onboarding/invite-team" },
] as const;

export function onboardingStepPath(currentStep: string): string {
  return (
    onboardingSteps.find((step) => step.id === currentStep)?.path ??
    "/onboarding/pending"
  );
}
