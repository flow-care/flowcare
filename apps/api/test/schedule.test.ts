import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { ScheduleService } from "../src/modules/schedule/service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const professionalId = "22222222-2222-4222-8222-222222222222";

function fixture() {
  let timezone = "America/Fortaleza";
  const rules: Array<{
    organizationId: string;
    dayOfWeek: string;
    startTime: string;
    endTime: string;
    slotDurationMinutes: number;
  }> = [];
  const exceptions: Array<{
    id: string;
    organizationId: string;
    professionalId: string | null;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    reason: string | null;
  }> = [];
  const db = {
    organization: {
      findUniqueOrThrow: async () => ({ timezone }),
      update: async ({ data }: { data: { timezone: string } }) => {
        timezone = data.timezone;
      },
    },
    weeklyScheduleRule: {
      findMany: async () => rules,
      deleteMany: async () => {
        rules.length = 0;
      },
      createMany: async ({ data }: { data: typeof rules }) => {
        rules.push(...data);
      },
    },
    auditLog: { create: async () => ({}) },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: { organizationId: string; userId: string };
      }) =>
        where.organizationId === organizationId &&
        where.userId === professionalId
          ? { id: "member" }
          : null,
    },
    scheduleException: {
      findMany: async ({ where }: { where: { organizationId: string } }) =>
        exceptions.filter(
          (item) => item.organizationId === where.organizationId,
        ),
      findFirst: async ({
        where,
      }: {
        where: {
          organizationId: string;
          professionalId: string | null;
          startsAt: { lt: Date };
          endsAt: { gt: Date };
        };
      }) =>
        exceptions.find(
          (item) =>
            item.organizationId === where.organizationId &&
            item.professionalId === where.professionalId &&
            item.startsAt < where.startsAt.lt &&
            item.endsAt > where.endsAt.gt,
        ) ?? null,
      create: async ({
        data,
      }: {
        data: Omit<(typeof exceptions)[number], "id">;
      }) => {
        const item = { ...data, id: "33333333-3333-4333-8333-333333333333" };
        exceptions.push(item);
        return item;
      },
      deleteMany: async ({
        where,
      }: {
        where: { organizationId: string; id: string };
      }) => {
        const at = exceptions.findIndex(
          (item) =>
            item.organizationId === where.organizationId &&
            item.id === where.id,
        );
        if (at < 0) return { count: 0 };
        exceptions.splice(at, 1);
        return { count: 1 };
      },
    },
    $transaction: async (action: (tx: unknown) => Promise<unknown>) =>
      action(db),
  };
  return {
    service: new ScheduleService(db as unknown as PrismaClient),
    rules,
    exceptions,
  };
}

describe("schedule rules and exceptions (#304)", () => {
  test("rejects invalid and overlapping weekly intervals before changing existing rules", async () => {
    const { service, rules } = fixture();
    const monday = {
      dayOfWeek: "MONDAY" as const,
      startTime: "08:00",
      endTime: "12:00",
      slotDurationMinutes: 30,
    };
    await service.replaceWeekly(organizationId, "actor", {
      timezone: "America/Fortaleza",
      rules: [monday],
    });
    expect(rules).toHaveLength(1);
    await expect(
      service.replaceWeekly(organizationId, "actor", {
        timezone: "America/Fortaleza",
        rules: [monday, { ...monday, startTime: "11:00", endTime: "13:00" }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.replaceWeekly(organizationId, "actor", {
        timezone: "America/Fortaleza",
        rules: [{ ...monday, startTime: "12:00", endTime: "11:00" }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(rules).toHaveLength(1);
  });

  test("stores timezone, rejects overlap and foreign professional, and preserves weekly rules", async () => {
    const { service, rules } = fixture();
    await service.replaceWeekly(organizationId, "actor", {
      timezone: "America/Fortaleza",
      rules: [
        {
          dayOfWeek: "MONDAY",
          startTime: "08:00",
          endTime: "12:00",
          slotDurationMinutes: 30,
        },
      ],
    });
    const body = {
      startsAt: "2026-12-25T11:00:00.000Z",
      endsAt: "2026-12-25T12:00:00.000Z",
      reason: "Holiday",
    };
    const created = await service.addException(organizationId, "actor", body);
    expect(created.exception.timezone).toBe("America/Fortaleza");
    expect(rules).toHaveLength(1);
    await expect(
      service.addException(organizationId, "actor", body),
    ).rejects.toMatchObject({ code: "SCHEDULE_CONFLICT" });
    await expect(
      service.addException(organizationId, "actor", {
        ...body,
        professionalId: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.deleteException(
        "other-organization",
        "actor",
        created.exception.id,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await service.deleteException(
        organizationId,
        "actor",
        created.exception.id,
      ),
    ).toEqual({ deleted: true });
  });
});
