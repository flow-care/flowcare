import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type {
  AppointmentStatus,
  MembershipRole,
  MembershipStatus,
  PrismaClient,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { appointmentsModule } from "../src/modules/appointments";
import { AppointmentsService } from "../src/modules/appointments/service";
import { signSessionToken } from "../src/services/session-token";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const professionalId = "33333333-3333-4333-8333-333333333333";
const patientId = "44444444-4444-4444-8444-444444444444";
const secret = "appointments-test-secret";

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
            patientId,
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

type StoredAppointment = {
  id: string;
  organizationId: string;
  patientId: string;
  professionalId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  version: number;
  notes: string | null;
  createdAt: Date;
};

function bookingFixture(timezone = "America/Fortaleza") {
  const appointments: StoredAppointment[] = [];
  const requests = new Map<
    string,
    {
      organizationId: string;
      idempotencyKey: string;
      requestHash: string;
      appointmentId: string;
    }
  >();
  const patients = [
    { id: patientId, organizationId },
    {
      id: "55555555-5555-4555-8555-555555555555",
      organizationId: otherOrganizationId,
    },
  ];
  const memberships: Array<{
    id: string;
    userId: string;
    organizationId: string;
    orgSlug: string;
    role: MembershipRole;
    status: MembershipStatus;
  }> = [
    {
      id: "mem-receptionist",
      userId: "user-receptionist",
      organizationId,
      orgSlug: "clinic-a",
      role: "RECEPTIONIST",
      status: "ACTIVE",
    },
    {
      id: "mem-suspended",
      userId: "user-suspended",
      organizationId,
      orgSlug: "clinic-a",
      role: "RECEPTIONIST",
      status: "SUSPENDED",
    },
    {
      id: "mem-professional",
      userId: professionalId,
      organizationId,
      orgSlug: "clinic-a",
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-other-clinic-prof",
      userId: "66666666-6666-4666-8666-666666666666",
      organizationId: otherOrganizationId,
      orgSlug: "clinic-b",
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-non-clinical",
      userId: "77777777-7777-4777-8777-777777777777",
      organizationId,
      orgSlug: "clinic-a",
      role: "RECEPTIONIST",
      status: "ACTIVE",
    },
  ];
  const pauses = [
    {
      organizationId,
      professionalId,
      startsAt: new Date("2026-10-12T12:30:00.000Z"),
      endsAt: new Date("2026-10-12T13:00:00.000Z"),
    },
  ];

  const txClient = {
    $executeRaw: async () => 1,
    organization: {
      findUniqueOrThrow: async () => ({ timezone }),
    },
    patient: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) =>
        patients.find(
          (p) => p.id === where.id && p.organizationId === where.organizationId,
        ) ?? null,
    },
    membership: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        if (where.organization) {
          const slug = (where.organization as { slug: string }).slug;
          return (
            memberships.find(
              (m) => m.userId === where.userId && m.orgSlug === slug,
            ) ?? null
          );
        }
        const allowedRoles = (where.role as { in?: MembershipRole[] })?.in;
        return (
          memberships.find(
            (m) =>
              m.organizationId === where.organizationId &&
              m.userId === where.userId &&
              m.status === where.status &&
              (!allowedRoles || allowedRoles.includes(m.role)),
          ) ?? null
        );
      },
    },
    weeklyScheduleRule: {
      findMany: async ({
        where,
      }: {
        where: { organizationId: string; dayOfWeek: string };
      }) =>
        where.organizationId === organizationId && where.dayOfWeek === "MONDAY"
          ? [
              {
                startTime: "08:00",
                endTime: "12:00",
                slotDurationMinutes: 30,
              },
            ]
          : [],
    },
    professionalSchedulePause: {
      findMany: async ({
        where,
      }: {
        where: {
          organizationId: string;
          professionalId: string;
          startsAt: { lt: Date };
          endsAt: { gt: Date };
        };
      }) =>
        pauses.filter(
          (p) =>
            p.organizationId === where.organizationId &&
            p.professionalId === where.professionalId &&
            p.startsAt < where.startsAt.lt &&
            p.endsAt > where.endsAt.gt,
        ),
    },
    appointment: {
      findMany: async ({
        where,
      }: {
        where: {
          organizationId: string;
          professionalId: string;
          status: { in: AppointmentStatus[] };
          scheduledAt: { gte: Date; lt: Date };
        };
      }) => {
        await Promise.resolve();
        return appointments.filter(
          (a) =>
            a.organizationId === where.organizationId &&
            a.professionalId === where.professionalId &&
            where.status.in.includes(a.status) &&
            a.scheduledAt >= where.scheduledAt.gte &&
            a.scheduledAt < where.scheduledAt.lt,
        );
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        await Promise.resolve();
        const created: StoredAppointment = {
          id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(appointments.length + 1).padStart(12, "0")}`,
          organizationId: data.organizationId as string,
          patientId: data.patientId as string,
          professionalId: data.professionalId as string,
          scheduledAt: data.scheduledAt as Date,
          durationMinutes: data.durationMinutes as number,
          status: (data.status as AppointmentStatus) ?? "RESERVED",
          version: 0,
          notes: (data.notes as string | null) ?? null,
          createdAt: new Date("2026-10-12T10:00:00.000Z"),
        };
        appointments.push(created);
        return created;
      },
    },
    appointmentCreationRequest: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        const key = where.organizationId_idempotencyKey as {
          organizationId: string;
          idempotencyKey: string;
        };
        const record = requests.get(
          `${key.organizationId}:${key.idempotencyKey}`,
        );
        if (!record) return null;
        const appointment = appointments.find(
          (a) => a.id === record.appointmentId,
        );
        if (!appointment) return null;
        return {
          requestHash: record.requestHash,
          appointment,
        };
      },
      create: async ({
        data,
      }: {
        data: {
          organizationId: string;
          idempotencyKey: string;
          requestHash: string;
          appointmentId: string;
        };
      }) => {
        const mapKey = `${data.organizationId}:${data.idempotencyKey}`;
        if (requests.has(mapKey)) {
          const err = new Error("Unique constraint failed") as Error & {
            code: string;
          };
          err.code = "P2002";
          throw err;
        }
        requests.set(mapKey, data);
        return data;
      },
    },
    session: {
      findFirst: async () => ({
        id: "session-1",
        lastActiveAt: new Date(),
      }),
    },
  };

  const prisma = {
    ...txClient,
    $transaction: async <T>(callback: (tx: typeof txClient) => Promise<T>) =>
      callback(txClient),
  } as unknown as PrismaClient;

  return {
    prisma,
    service: new AppointmentsService(prisma),
    appointments,
    requests,
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

describe("appointment booking (#237)", () => {
  test("creates a valid appointment within clinic weekly schedule rules", async () => {
    const f = bookingFixture();
    const result = await f.service.create(organizationId, "booking-key-0001", {
      patientId,
      professionalId,
      scheduledAt: "2026-10-12T11:00:00.000Z",
      durationMinutes: 30,
      notes: "  Primeira consulta  ",
    });

    expect(result).toEqual({
      timeZone: "America/Fortaleza",
      appointment: {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
        patientId,
        professionalId,
        scheduledAt: "2026-10-12T11:00:00.000Z",
        endsAt: "2026-10-12T11:30:00.000Z",
        localScheduledAt: "2026-10-12T08:00:00",
        localEndsAt: "2026-10-12T08:30:00",
        durationMinutes: 30,
        status: "RESERVED",
        version: 0,
        notes: "Primeira consulta",
        createdAt: "2026-10-12T10:00:00.000Z",
      },
    });
    expect(f.appointments).toHaveLength(1);
  });

  test("allows only one success when two concurrent bookings overlap for the same professional", async () => {
    const f = bookingFixture();
    const outcomes = await Promise.allSettled([
      f.service.create(organizationId, "concurrent-key-1", {
        patientId,
        professionalId,
        scheduledAt: "2026-10-12T11:00:00.000Z",
        durationMinutes: 30,
      }),
      f.service.create(organizationId, "concurrent-key-2", {
        patientId,
        professionalId,
        scheduledAt: "2026-10-12T11:15:00.000Z",
        durationMinutes: 30,
      }),
    ]);

    const fulfilled = outcomes.filter(
      (
        o,
      ): o is PromiseFulfilledResult<
        Awaited<ReturnType<typeof f.service.create>>
      > => o.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (o): o is PromiseRejectedResult => o.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(f.appointments).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: "SLOT_CONFLICT",
      httpStatus: 409,
      details: {
        reason: "APPOINTMENT_OVERLAP",
        professionalId,
        requestedStartsAt: "2026-10-12T11:15:00.000Z",
        requestedEndsAt: "2026-10-12T11:45:00.000Z",
        conflictingAppointmentId: fulfilled[0]?.value.appointment.id,
        conflictingStartsAt: "2026-10-12T11:00:00.000Z",
        conflictingEndsAt: "2026-10-12T11:30:00.000Z",
      },
    });
  });

  test("replays idempotent requests without duplication and rejects key reuse with a different payload", async () => {
    const f = bookingFixture();
    const payload = {
      patientId,
      professionalId,
      scheduledAt: "2026-10-12T11:00:00.000Z",
      durationMinutes: 30,
      notes: "Retorno",
    };

    const [first, second] = await Promise.all([
      f.service.create(organizationId, "same-idempotency-key", payload),
      f.service.create(organizationId, "same-idempotency-key", payload),
    ]);
    expect(second).toEqual(first);
    expect(f.appointments).toHaveLength(1);

    await expect(
      f.service.create(organizationId, "same-idempotency-key", {
        ...payload,
        scheduledAt: "2026-10-12T11:30:00.000Z",
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      httpStatus: 409,
    } satisfies Partial<ApiError>);
    expect(f.appointments).toHaveLength(1);
  });

  test("rejects patient or professional from another clinic, non-clinical member, pause overlap, and outside working hours", async () => {
    const f = bookingFixture();

    // Patient from another clinic
    await expect(
      f.service.create(organizationId, "key-other-patient", {
        patientId: "55555555-5555-4555-8555-555555555555",
        professionalId,
        scheduledAt: "2026-10-12T11:00:00.000Z",
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    } satisfies Partial<ApiError>);

    // Professional from another clinic
    await expect(
      f.service.create(organizationId, "key-other-prof", {
        patientId,
        professionalId: "66666666-6666-4666-8666-666666666666",
        scheduledAt: "2026-10-12T11:00:00.000Z",
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    } satisfies Partial<ApiError>);

    // Non-clinical member (receptionist) passed as professionalId
    await expect(
      f.service.create(organizationId, "key-non-clinical", {
        patientId,
        professionalId: "77777777-7777-4777-8777-777777777777",
        scheduledAt: "2026-10-12T11:00:00.000Z",
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    } satisfies Partial<ApiError>);

    // Pause overlap (12:30Z - 13:00Z)
    await expect(
      f.service.create(organizationId, "key-pause-overlap", {
        patientId,
        professionalId,
        scheduledAt: "2026-10-12T12:15:00.000Z",
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({
      code: "SLOT_CONFLICT",
      httpStatus: 409,
      details: {
        reason: "SCHEDULE_PAUSE",
        professionalId,
        conflictingStartsAt: "2026-10-12T12:30:00.000Z",
        conflictingEndsAt: "2026-10-12T13:00:00.000Z",
      },
    });

    // Outside working hours (local 08:00-12:00 is 11:00Z-15:00Z; 14:45Z + 30m ends at 15:15Z)
    await expect(
      f.service.create(organizationId, "key-outside-hours", {
        patientId,
        professionalId,
        scheduledAt: "2026-10-12T14:45:00.000Z",
        durationMinutes: 30,
      }),
    ).rejects.toMatchObject({
      code: "SLOT_CONFLICT",
      httpStatus: 409,
      details: {
        reason: "OUTSIDE_WORKING_HOURS",
        professionalId,
        dayOfWeek: "MONDAY",
        timeZone: "America/Fortaleza",
      },
    });
  });

  test("enforces HTTP schema validation, idempotency header, and organization access on POST /organizations/:orgSlug/appointments", async () => {
    const f = bookingFixture();
    const app = new Elysia()
      .onError(({ code, error, status }) => {
        if (error instanceof ApiError)
          return status(error.httpStatus, {
            error: {
              code: error.code,
              message: error.message,
              ...(error.details ? { details: error.details } : {}),
            },
          });
        if (code === "VALIDATION")
          return status(400, { error: { code: "VALIDATION_ERROR" } });
        return status(500, { error: { code: "INTERNAL" } });
      })
      .use(appointmentsModule({ prisma: f.prisma, jwtSecret: secret }));

    const activeToken = signSessionToken(
      { sid: "session-1", sub: "user-receptionist" },
      secret,
      60,
    );
    const suspendedToken = signSessionToken(
      { sid: "session-1", sub: "user-suspended" },
      secret,
      60,
    );

    const postAppointment = (
      slug: string,
      body: unknown,
      options: { token?: string; idempotencyKey?: string } = {},
    ) =>
      app.handle(
        new Request(`http://localhost/organizations/${slug}/appointments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.token
              ? { authorization: `Bearer ${options.token}` }
              : {}),
            ...(options.idempotencyKey
              ? { "idempotency-key": options.idempotencyKey }
              : {}),
          },
          body: JSON.stringify(body),
        }),
      );

    const validPayload = {
      patientId,
      professionalId,
      scheduledAt: "2026-10-12T11:00:00.000Z",
      durationMinutes: 30,
      notes: "Consulta de rotina",
    };

    // Unauthenticated -> 401
    expect(
      (
        await postAppointment("clinic-a", validPayload, {
          idempotencyKey: "http-key-1",
        })
      ).status,
    ).toBe(401);

    // Suspended membership -> 403
    expect(
      (
        await postAppointment("clinic-a", validPayload, {
          token: suspendedToken,
          idempotencyKey: "http-key-1",
        })
      ).status,
    ).toBe(403);

    // Unknown or other clinic -> 404
    expect(
      (
        await postAppointment("clinic-b", validPayload, {
          token: activeToken,
          idempotencyKey: "http-key-1",
        })
      ).status,
    ).toBe(404);

    // Missing Idempotency-Key header -> 400
    expect(
      (
        await postAppointment("clinic-a", validPayload, {
          token: activeToken,
        })
      ).status,
    ).toBe(400);

    //Concurrent HTTP requests for the same slot -> one 201 and one 409
    const [res1, res2] = await Promise.all([
      postAppointment("clinic-a", validPayload, {
        token: activeToken,
        idempotencyKey: "http-concurrent-1",
      }),
      postAppointment("clinic-a", validPayload, {
        token: activeToken,
        idempotencyKey: "http-concurrent-2",
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const conflictRes = res1.status === 409 ? res1 : res2;
    const conflictBody = (await conflictRes.json()) as {
      error: { code: string; details: Record<string, string> };
    };
    expect(conflictBody.error.code).toBe("SLOT_CONFLICT");
    expect(conflictBody.error.details.reason).toBe("APPOINTMENT_OVERLAP");
  });
});
