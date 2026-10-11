export const onboardingSteps = [
  "PROFILE_SETUP",
  "ORGANIZATION_SETUP",
  "CLINIC_DETAILS",
  "CLINIC_ADDRESS",
] as const;

export const finalOnboardingStep: (typeof onboardingSteps)[number] =
  "CLINIC_ADDRESS";

type SavedProgress = {
  currentStep: string;
  completed: boolean;
} | null;

export function resolveOnboardingState(
  input: {
    profileCompleted: boolean;
    hasOrganization: boolean;
    savedProgress: SavedProgress;
  },
  steps: readonly string[] = onboardingSteps,
) {
  // Membros convidados já têm acesso à clínica sem passar pelo cadastro do dono.
  if (input.hasOrganization && !input.savedProgress) {
    return { currentStep: "ORGANIZATION_SETUP", completed: true };
  }
  if (!input.profileCompleted) {
    return { currentStep: "PROFILE_SETUP", completed: false };
  }
  if (!input.hasOrganization) {
    return { currentStep: "ORGANIZATION_SETUP", completed: false };
  }

  const savedStep = input.savedProgress?.currentStep ?? "ORGANIZATION_SETUP";
  const savedIndex = steps.indexOf(savedStep);
  const organizationIndex = steps.indexOf("ORGANIZATION_SETUP");
  const currentIndex = Math.max(savedIndex, organizationIndex);

  if (input.savedProgress && !input.savedProgress.completed) {
    if (savedIndex < 0) {
      return { currentStep: savedStep, completed: false };
    }
    if (savedIndex <= organizationIndex) {
      const nextStep = steps[organizationIndex + 1];
      return nextStep
        ? { currentStep: nextStep, completed: false }
        : { currentStep: "ORGANIZATION_SETUP", completed: true };
    }
    return {
      currentStep: savedStep,
      completed: false,
    };
  }

  const nextStep = steps[currentIndex + 1];
  return nextStep
    ? { currentStep: nextStep, completed: false }
    : {
        currentStep: steps[currentIndex] ?? "ORGANIZATION_SETUP",
        completed: true,
      };
}
