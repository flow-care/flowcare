import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { ApiError } from "../src/lib/api-error";
import { AppointmentsService } from "../src/modules/appointments/service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const professionalId = "33333333-3333-4333-8333-333333333333";

function fixture(timezone = "America/Fortaleza") {
  const appointmentQueries: Array<Record<string, unknown>> = [];
  let cursorOrganizationId = organizationId;
  let professionalOrganizationId = organizationId;
  const prisma = {
    organization: {
      findUniqueOrThrow: async () => ({ timezone }),
    },
    membership: {
      findFirst: async (query: { where: { organizationId: string } }) =>
        query.where.organizationId === professionalOrganizationId
          ? { id: "membership" }
          : null,
    },
    weeklyScheduleRule: {
      findMany: async () => [
        {
          startTime: "08:00",
          endTime: "10:00",
          slotDurationMinutes: 30,
        },
      ],
    },
    appointment: {
      findFirst: async (query: { where: { organizationId: string } }) =>
        query.where.organizationId === cursorOrganizationId
          ? { id: "cursor" }
          : null,
      findMany: async (query: Record<string, unknown>) => {
        appointmentQueries.push(query);
        if (!(query.select as Record<string, unknown>).id)
          return [
            {
              scheduledAt: new Date("2026-10-12T11:30:00.000Z"),
              durationMinutes: 30,
            },
          ];
        return [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            patientId: "44444444-4444-4444-8444-444444444444",
            professionalId,
            scheduledAt: new Date("2026-10-12T11:00:00.000Z"),
            durationMinutes: 30,
            status: "CONFIRMED",
          },
        ];
      },
    },
    professionalSchedulePause: {
      findMany: async () => [
        {
          startsAt: new Date("2026-10-12T12:30:00.000Z"),
          endsAt: new Date("2026-10-12T13:00:00.000Z"),
        },
      ],
    },
  } as unknown as PrismaClient;

  return {
    service: new AppointmentsService(prisma),
    appointmentQueries,
    setCursorOrganization: (value: string) => {
      cursorOrganizationId = value;
    },
    setProfessionalOrganization: (value: string) => {
      professionalOrganizationId = value;
    },
  };
}

describe("appointment queries (#236)", () => {
  test("uses inclusive clinic-local dates and stable pagination", async () => {
    const f = fixture();
    const result = await f.service.list(organizationId, {
      startDate: "2026-10-12",
      endDate: "2026-10-12",
      professionalId,
      status: "CONFIRMED",
      limit: 1,
    });

    expect(result).toEqual({
      timeZone: "America/Fortaleza",
      appointments: [
        expect.objectContaining({
          scheduledAt: "2026-10-12T11:00:00.000Z",
          localScheduledAt: "2026-10-12T08:00:00",
        }),
      ],
      nextCursor: null,
    });
    expect(f.appointmentQueries[0]).toMatchObject({
      where: {
        organizationId,
        professionalId,
        status: "CONFIRMED",
        scheduledAt: {
          gte: new Date("2026-10-12T03:00:00.000Z"),
          lt: new Date("2026-10-13T03:00:00.000Z"),
        },
      },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      take: 2,
    });
  });

  test("rejects invalid ranges and cursors from another organization", async () => {
    const f = fixture();
    await expect(
      f.service.list(organizationId, {
        startDate: "2026-10-01",
        endDate: "2026-11-01",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    } satisfies Partial<ApiError>);

    f.setCursorOrganization(otherOrganizationId);
    await expect(
      f.service.list(organizationId, {
        startDate: "2026-10-12",
        endDate: "2026-10-12",
        cursor: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    } satisfies Partial<ApiError>);
  });

  test("uses each day's real UTC boundary across daylight saving changes", async () => {
    const f = fixture("America/New_York");
    await f.service.list(organizationId, {
      startDate: "2026-11-01",
      endDate: "2026-11-01",
    });
    expect(f.appointmentQueries[0]).toMatchObject({
      where: {
        scheduledAt: {
          gte: new Date("2026-11-01T04:00:00.000Z"),
          lt: new Date("2026-11-02T05:00:00.000Z"),
        },
      },
    });
  });

  test("returns only schedule slots that do not overlap appointments or pauses", async () => {
    const f = fixture();
    const result = await f.service.availability(organizationId, {
      date: "2026-10-12",
      professionalId,
    });

    expect(result.slots.map((slot) => slot.localStartsAt)).toEqual([
      "2026-10-12T08:00:00",
      "2026-10-12T09:00:00",
    ]);
    expect(f.appointmentQueries[0]).toMatchObject({
      where: {
        organizationId,
        professionalId,
        status: { in: ["RESERVED", "CONFIRMED"] },
      },
    });
  });

  test("does not accept a professional belonging only to another clinic", async () => {
    const f = fixture();
    f.setProfessionalOrganization(otherOrganizationId);
    await expect(
      f.service.availability(organizationId, {
        date: "2026-10-12",
        professionalId,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    } satisfies Partial<ApiError>);
  });
});
