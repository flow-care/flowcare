import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { PrismaClient } from "../src/generated/prisma/client";
import { OnboardingService } from "../src/modules/onboarding/service";
import { finalOnboardingStep } from "../src/modules/onboarding/steps";
import { signSessionToken } from "../src/services/session-token";

const testEnv: Env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "onboarding-test-secret",
  databaseUrl: "postgresql://unused",
  corsOrigin: "http://localhost:3000",
  trustProxy: false,
  wahaBaseUrl: "http://127.0.0.1:1",
  wahaApiKey: null,
  webAppUrl: "http://localhost:3000",
  sesRegion: null,
  mailProvider: "disabled",
  mailFrom: null,
};

function fixture(
  options: {
    verified?: boolean;
    organizationId?: string | null;
    activeAdmin?: boolean;
  } = {},
) {
  let savedRules: unknown[] = [];
  let completed = false;
  let currentStep: string = "ORGANIZATION_SETUP";
  let version = 1;
  let writes = 0;
  const db = {
    session: {
      findFirst: async () => ({
        id: "sess-1",
        lastActiveAt: new Date(),
      }),
      updateMany: async () => ({ count: 1 }),
    },
    user: {
      findUnique: async () => ({ emailVerified: options.verified ?? true }),
    },
    onboardingProgress: {
      findUnique: async () => ({
        draftData:
          options.organizationId === null
            ? {}
            : { organizationId: options.organizationId ?? "org-1" },
      }),
      updateMany: async () => {
        if (!completed || currentStep !== finalOnboardingStep) {
          completed = true;
          currentStep = finalOnboardingStep;
          version += 1;
          writes += 1;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
    membership: {
      findFirst: async () =>
        options.activeAdmin === false
          ? null
          : { organization: { slug: "clinica-alfa" } },
    },
    weeklyScheduleRule: {
      deleteMany: async () => {
        savedRules = [];
      },
      createMany: async ({ data }: { data: unknown[] }) => {
        savedRules = data;
      },
    },
  };
  const prisma = {
    ...db,
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
  } as unknown as PrismaClient;
  const app = createApp(testEnv, {
    prisma,
    mailer: { send: async () => {} },
  });
  const token = signSessionToken(
    { sid: "sess-1", sub: "user-1" },
    testEnv.jwtSecret,
    3600,
  );
  return {
    service: new OnboardingService({ prisma }),
    app,
    token,
    rules: () => savedRules,
    writes: () => writes,
    version: () => version,
  };
}

describe("onboarding schedule and completion (#218)", () => {
  test("saves non-overlapping intervals and allows an empty schedule", async () => {
    const state = fixture();
    const monday = {
      dayOfWeek: "MONDAY" as const,
      startTime: "08:00",
      endTime: "12:00",
      slotDurationMinutes: 30,
    };
    const afternoon = { ...monday, startTime: "12:00", endTime: "18:00" };
    await state.service.saveScheduleRules("user-1", {
      weeklySchedule: [monday, afternoon],
    });
    expect(state.rules()).toHaveLength(2);
    await state.service.saveScheduleRules("user-1", { weeklySchedule: [] });
    expect(state.rules()).toHaveLength(0);
  });

  test("rejects overlaps, reversed intervals and oversized slots before writing", async () => {
    const state = fixture();
    const base = {
      dayOfWeek: "MONDAY" as const,
      startTime: "08:00",
      endTime: "12:00",
      slotDurationMinutes: 30,
    };
    for (const weeklySchedule of [
      [base, { ...base, startTime: "11:00", endTime: "13:00" }],
      [{ ...base, startTime: "18:00", endTime: "08:00" }],
      [{ ...base, slotDurationMinutes: 300 }],
    ]) {
      await expect(
        state.service.saveScheduleRules("user-1", { weeklySchedule }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR", httpStatus: 400 });
    }
    expect(state.rules()).toHaveLength(0);
  });

  test("enforces declarative TypeBox schemas at HTTP boundary for schedule, profile and organization", async () => {
    const state = fixture();
    const postJson = (path: string, body: unknown) =>
      state.app.handle(
        new Request(`http://localhost/api${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${state.token}`,
          },
          body: JSON.stringify(body),
        }),
      );

    for (const invalidRule of [
      {
        dayOfWeek: "MONDAY",
        startTime: "24:00",
        endTime: "12:00",
        slotDurationMinutes: 30,
      },
      {
        dayOfWeek: "MONDAY",
        startTime: "8:00",
        endTime: "12:00",
        slotDurationMinutes: 30,
      },
      {
        dayOfWeek: "MONDAY",
        startTime: "08:00",
        endTime: "12:60",
        slotDurationMinutes: 30,
      },
      {
        dayOfWeek: "MONDAY",
        startTime: "08:00",
        endTime: "12:00",
        slotDurationMinutes: 0,
      },
    ]) {
      const res = await postJson("/onboarding/schedule-rules", {
        weeklySchedule: [invalidRule],
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }

    for (const invalidProfile of [
      {
        fullName: "   ",
        phone: "85999990000",
        professionalRole: "MANAGEMENT",
      },
      {
        fullName: "Dra. Maria",
        phone: "abcdefghij",
        professionalRole: "MANAGEMENT",
      },
      {
        fullName: "Dra. Maria",
        phone: "12345678901234",
        professionalRole: "MANAGEMENT",
      },
    ]) {
      const res = await postJson("/onboarding/profile", invalidProfile);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }

    const invalidOrg = await postJson("/onboarding/organization", {
      name: "---",
    });
    expect(invalidOrg.status).toBe(400);
    expect(await invalidOrg.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    const validSchedule = await postJson("/onboarding/schedule-rules", {
      weeklySchedule: [
        {
          dayOfWeek: "MONDAY",
          startTime: "08:00",
          endTime: "12:00",
          slotDurationMinutes: 30,
        },
      ],
    });
    expect(validSchedule.status).toBe(200);

    const completed = await postJson("/onboarding/complete", {});
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual({
      redirectUrl: "/app/clinica-alfa/dashboard",
    });
  });

  test("completion is idempotent without schedule or invitations", async () => {
    const state = fixture();
    expect(await state.service.complete("user-1")).toEqual({
      redirectUrl: "/app/clinica-alfa/dashboard",
    });
    expect(await state.service.complete("user-1")).toEqual({
      redirectUrl: "/app/clinica-alfa/dashboard",
    });
    expect(state.writes()).toBe(1);
    expect(state.version()).toBe(2);
  });

  test("requires verified email, created clinic and active ADMIN membership", async () => {
    for (const options of [
      { verified: false },
      { organizationId: null },
      { activeAdmin: false },
    ]) {
      const state = fixture(options);
      await expect(state.service.complete("user-1")).rejects.toMatchObject({
        code:
          options.verified === false
            ? "ACCOUNT_NOT_VERIFIED"
            : "ONBOARDING_INCOMPLETE",
      });
      expect(state.writes()).toBe(0);
    }
  });
});
