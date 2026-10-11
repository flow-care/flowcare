import { expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { OnboardingService } from "../src/modules/onboarding/service";
import {
  onboardingSteps,
  resolveOnboardingState,
} from "../src/modules/onboarding/steps";

const steps = ["PROFILE_SETUP", "ORGANIZATION_SETUP", "SCHEDULE_SETUP"];

test("existing clinics resume at contact, address, then optional team invitations", () => {
  const input = { profileCompleted: true, hasOrganization: true };
  expect(
    resolveOnboardingState(
      {
        ...input,
        savedProgress: { currentStep: "ORGANIZATION_SETUP", completed: true },
      },
      onboardingSteps,
    ),
  ).toEqual({ currentStep: "CLINIC_DETAILS", completed: false });
  expect(
    resolveOnboardingState(
      {
        ...input,
        savedProgress: { currentStep: "CLINIC_DETAILS", completed: true },
      },
      onboardingSteps,
    ),
  ).toEqual({ currentStep: "CLINIC_ADDRESS", completed: false });
  expect(
    resolveOnboardingState(
      {
        ...input,
        savedProgress: { currentStep: "CLINIC_ADDRESS", completed: true },
      },
      onboardingSteps,
    ),
  ).toEqual({ currentStep: "WEEKLY_SCHEDULE", completed: false });
  expect(
    resolveOnboardingState(
      {
        ...input,
        savedProgress: { currentStep: "WEEKLY_SCHEDULE", completed: true },
      },
      onboardingSteps,
    ),
  ).toEqual({ currentStep: "TEAM_INVITES", completed: false });
  expect(
    resolveOnboardingState(
      {
        ...input,
        savedProgress: { currentStep: "TEAM_INVITES", completed: true },
      },
      onboardingSteps,
    ),
  ).toEqual({ currentStep: "TEAM_INVITES", completed: true });
});

test("routes a new account to the profile", () => {
  expect(
    resolveOnboardingState(
      { profileCompleted: false, hasOrganization: false, savedProgress: null },
      steps,
    ),
  ).toEqual({ currentStep: "PROFILE_SETUP", completed: false });
});

test("routes a completed profile to clinic creation", () => {
  expect(
    resolveOnboardingState(
      { profileCompleted: true, hasOrganization: false, savedProgress: null },
      steps,
    ),
  ).toEqual({ currentStep: "ORGANIZATION_SETUP", completed: false });
});

test("does not send invited members without owner onboarding progress back to setup", () => {
  expect(
    resolveOnboardingState({
      profileCompleted: false,
      hasOrganization: true,
      savedProgress: null,
    }),
  ).toEqual({ currentStep: "ORGANIZATION_SETUP", completed: true });
});

test("reopens onboarding for a newly registered step after clinic creation", () => {
  expect(
    resolveOnboardingState(
      {
        profileCompleted: true,
        hasOrganization: true,
        savedProgress: { currentStep: "ORGANIZATION_SETUP", completed: true },
      },
      steps,
    ),
  ).toEqual({ currentStep: "SCHEDULE_SETUP", completed: false });
});

test("keeps the next unfinished step and completes after the last one", () => {
  const input = { profileCompleted: true, hasOrganization: true };
  expect(
    resolveOnboardingState(
      {
        ...input,
        savedProgress: { currentStep: "SCHEDULE_SETUP", completed: false },
      },
      steps,
    ),
  ).toEqual({ currentStep: "SCHEDULE_SETUP", completed: false });
  expect(
    resolveOnboardingState(
      {
        ...input,
        savedProgress: { currentStep: "SCHEDULE_SETUP", completed: true },
      },
      steps,
    ),
  ).toEqual({ currentStep: "SCHEDULE_SETUP", completed: true });
});

test("does not bypass an unrecognized pending stage", () => {
  expect(
    resolveOnboardingState({
      profileCompleted: true,
      hasOrganization: true,
      savedProgress: { currentStep: "NEW_SETUP", completed: false },
    }),
  ).toEqual({ currentStep: "NEW_SETUP", completed: false });
});

test("profile completion advances to clinic creation", async () => {
  let savedStep: string | undefined;
  let profileCompleted = false;
  const prisma = {
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        user: {
          updateMany: async () => {
            profileCompleted = true;
            return { count: 1 };
          },
        },
        onboardingProgress: {
          findUnique: async () => ({ currentStep: "PROFILE_SETUP" }),
          upsert: async ({ update }: { update: { currentStep: string } }) => {
            savedStep = update.currentStep;
          },
        },
      }),
    user: {
      findUnique: async () => ({
        fullName: "Ana Silva",
        phone: "85999999999",
        professionalRole: "MANAGEMENT",
        professionalTitle: null,
        registrationNumber: null,
        profileCompletedAt: profileCompleted ? new Date() : null,
        onboarding: { draftData: {} },
      }),
    },
  } as unknown as PrismaClient;

  await new OnboardingService({ prisma }).saveProfile("user-1", {
    fullName: "Ana Silva",
    phone: "85999999999",
    professionalRole: "MANAGEMENT",
  });

  expect(savedStep).toBe("ORGANIZATION_SETUP");
});

test("completed profile cannot be edited through save or draft endpoints", async () => {
  const prisma = {
    user: { findUnique: async () => ({ profileCompletedAt: new Date() }) },
    onboardingProgress: {
      upsert: async () => {
        throw new Error("Unexpected write");
      },
    },
    $transaction: async () => {
      throw new Error("Unexpected transaction");
    },
  } as unknown as PrismaClient;
  const service = new OnboardingService({ prisma });
  await expect(
    service.saveProfile("user-1", {
      fullName: "Ana Silva",
      phone: "85999999999",
      professionalRole: "MANAGEMENT",
    }),
  ).rejects.toMatchObject({ code: "STEP_ALREADY_COMPLETED", httpStatus: 409 });
  await expect(
    service.saveProfileDraft("user-1", {
      fullName: "Ana Silva",
      phone: "85999999999",
      professionalRole: "MANAGEMENT",
      professionalTitle: "",
      registrationNumber: "",
    }),
  ).rejects.toMatchObject({ code: "STEP_ALREADY_COMPLETED", httpStatus: 409 });
});

test("simultaneous profile completion cannot overwrite the first save", async () => {
  const prisma = {
    user: { findUnique: async () => ({ profileCompletedAt: null }) },
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        user: { updateMany: async () => ({ count: 0 }) },
        onboardingProgress: {
          upsert: async () => {
            throw new Error("Unexpected progress write");
          },
        },
      }),
  } as unknown as PrismaClient;
  await expect(
    new OnboardingService({ prisma }).saveProfile("user-1", {
      fullName: "Ana Silva",
      phone: "85999999999",
      professionalRole: "MANAGEMENT",
    }),
  ).rejects.toMatchObject({ code: "STEP_ALREADY_COMPLETED", httpStatus: 409 });
});
