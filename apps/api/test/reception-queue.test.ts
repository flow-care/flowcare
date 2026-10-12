import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type {
  AppointmentStatus,
  MembershipRole,
  MembershipStatus,
  PrismaClient,
  ReceptionQueueStatus,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { appointmentsModule } from "../src/modules/appointments";
import type {
  ReceptionQueueItem,
  ReceptionQueueResponse,
} from "../src/modules/appointments/model";
import { AppointmentsService } from "../src/modules/appointments/service";
import { signSessionToken } from "../src/services/session-token";

const secret = "reception-queue-test-secret-32chars!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";
const professionalId = "33333333-3333-4333-8333-333333333333";
const patientOneId = "44444444-4444-4444-8444-444444444441";
const patientTwoId = "44444444-4444-4444-8444-444444444442";
const receptionistOneId = "55555555-5555-4555-8555-555555555551";
const receptionistTwoId = "55555555-5555-4555-8555-555555555552";

const appointmentOneId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const appointmentTwoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const cancelledAppointmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const clinicBAppointmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

interface StoredAppointment {
  id: string;
  organizationId: string;
  patientId: string;
  professionalId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  queueStatus: ReceptionQueueStatus;
  arrivedAt: Date | null;
  queueUpdatedAt: Date | null;
  queueUpdatedById: string | null;
  version: number;
}

interface StoredAuditLog {
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

function createFixture(timezone = "America/Fortaleza") {
  let role: MembershipRole = "RECEPTIONIST";
  let membershipStatus: MembershipStatus = "ACTIVE";
  let membershipOrgSlug: string | null = "clinica-a";
  let sessionActive = true;

  const appointments = new Map<string, StoredAppointment>([
    [
      appointmentOneId,
      {
        id: appointmentOneId,
        organizationId: clinicAId,
        patientId: patientOneId,
        professionalId,
        scheduledAt: new Date("2026-10-12T11:00:00.000Z"),
        durationMinutes: 30,
        status: "CONFIRMED",
        queueStatus: "WAITING",
        arrivedAt: null,
        queueUpdatedAt: null,
        queueUpdatedById: null,
        version: 0,
      },
    ],
    [
      appointmentTwoId,
      {
        id: appointmentTwoId,
        organizationId: clinicAId,
        patientId: patientTwoId,
        professionalId,
        scheduledAt: new Date("2026-10-12T11:30:00.000Z"),
        durationMinutes: 30,
        status: "RESERVED",
        queueStatus: "WAITING",
        arrivedAt: null,
        queueUpdatedAt: null,
        queueUpdatedById: null,
        version: 0,
      },
    ],
    [
      cancelledAppointmentId,
      {
        id: cancelledAppointmentId,
        organizationId: clinicAId,
        patientId: patientTwoId,
        professionalId,
        scheduledAt: new Date("2026-10-12T12:00:00.000Z"),
        durationMinutes: 30,
        status: "CANCELLED",
        queueStatus: "WAITING",
        arrivedAt: null,
        queueUpdatedAt: null,
        queueUpdatedById: null,
        version: 0,
      },
    ],
    [
      clinicBAppointmentId,
      {
        id: clinicBAppointmentId,
        organizationId: clinicBId,
        patientId: patientOneId,
        professionalId,
        scheduledAt: new Date("2026-10-12T11:00:00.000Z"),
        durationMinutes: 30,
        status: "CONFIRMED",
        queueStatus: "WAITING",
        arrivedAt: null,
        queueUpdatedAt: null,
        queueUpdatedById: null,
        version: 0,
      },
    ],
  ]);

  const auditLogs: StoredAuditLog[] = [];

  const dbOps = {
    organization: {
      findUniqueOrThrow: async () => ({ timezone }),
    },
    session: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        sessionActive ? { id: where.id, lastActiveAt: new Date() } : null,
    },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; organization: { slug: string } };
      }) => {
        if (!membershipOrgSlug || where.organization.slug !== membershipOrgSlug)
          return null;
        return {
          id: "membership-1",
          organizationId:
            where.organization.slug === "clinica-b" ? clinicBId : clinicAId,
          role,
          status: membershipStatus,
        };
      },
    },
    appointment: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) => {
        const found = appointments.get(where.id);
        if (!found || found.organizationId !== where.organizationId)
          return null;
        return { ...found };
      },
      findMany: async ({
        where,
      }: {
        where: {
          organizationId: string;
          scheduledAt?: { gte: Date; lt: Date };
          status?: { not?: AppointmentStatus };
          professionalId?: string;
          queueStatus?: ReceptionQueueStatus;
        };
      }) => {
        return [...appointments.values()]
          .filter((item) => {
            if (item.organizationId !== where.organizationId) return false;
            if (
              where.scheduledAt &&
              (item.scheduledAt < where.scheduledAt.gte ||
                item.scheduledAt >= where.scheduledAt.lt)
            ) {
              return false;
            }
            if (where.status?.not && item.status === where.status.not) {
              return false;
            }
            if (
              where.professionalId &&
              item.professionalId !== where.professionalId
            ) {
              return false;
            }
            if (where.queueStatus && item.queueStatus !== where.queueStatus) {
              return false;
            }
            return true;
          })
          .sort(
            (a, b) =>
              a.scheduledAt.getTime() - b.scheduledAt.getTime() ||
              a.id.localeCompare(b.id),
          )
          .map((item) => ({ ...item }));
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id: string;
          organizationId: string;
          version: number;
          status: AppointmentStatus;
          queueStatus: ReceptionQueueStatus;
        };
        data: {
          status: AppointmentStatus;
          queueStatus: ReceptionQueueStatus;
          arrivedAt: Date | null;
          queueUpdatedAt: Date;
          queueUpdatedById: string;
          version: { increment: number };
        };
      }) => {
        const current = appointments.get(where.id);
        if (
          !current ||
          current.organizationId !== where.organizationId ||
          current.version !== where.version ||
          current.status !== where.status ||
          current.queueStatus !== where.queueStatus
        ) {
          return { count: 0 };
        }
        appointments.set(where.id, {
          ...current,
          status: data.status,
          queueStatus: data.queueStatus,
          arrivedAt: data.arrivedAt,
          queueUpdatedAt: data.queueUpdatedAt,
          queueUpdatedById: data.queueUpdatedById,
          version: current.version + data.version.increment,
        });
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }: { data: StoredAuditLog }) => {
        auditLogs.push(data);
        return { id: `audit-${auditLogs.length}`, ...data };
      },
    },
  };

  const prisma = {
    ...dbOps,
    $transaction: async <T>(fn: (tx: typeof dbOps) => Promise<T>) => fn(dbOps),
  } as unknown as PrismaClient;

  const app = new Elysia({ prefix: "/api" })
    .onError(({ code, error, status }) => {
      if (error instanceof ApiError) {
        return status(error.httpStatus, {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details ? { details: error.details } : {}),
          },
        });
      }
      if (code === "VALIDATION") {
        return status(400, {
          error: { code: "VALIDATION_ERROR", message: "Dados inválidos." },
        });
      }
      return status(500, {
        error: { code: "INTERNAL", message: "Erro interno." },
      });
    })
    .use(appointmentsModule({ prisma, jwtSecret: secret }));
  const tokenOne = signSessionToken(
    { sid: "session-1", sub: receptionistOneId },
    secret,
    3600,
  );
  const tokenTwo = signSessionToken(
    { sid: "session-2", sub: receptionistTwoId },
    secret,
    3600,
  );

  const request = (
    method: string,
    path: string,
    options: {
      body?: Record<string, unknown>;
      token?: string | null;
    } = {},
  ) => {
    const activeToken = options.token === undefined ? tokenOne : options.token;
    const headers: Record<string, string> = {};
    if (activeToken) headers.authorization = `Bearer ${activeToken}`;
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    return app.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers,
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      }),
    );
  };

  return {
    prisma,
    request,
    tokenOne,
    tokenTwo,
    appointments,
    auditLogs,
    setRole: (value: MembershipRole) => {
      role = value;
    },
    setMembershipStatus: (value: MembershipStatus) => {
      membershipStatus = value;
    },
    setMembershipOrgSlug: (value: string | null) => {
      membershipOrgSlug = value;
    },
    setSessionActive: (value: boolean) => {
      sessionActive = value;
    },
  };
}

describe("reception queue arrival & state transitions (#240)", () => {
  test("lists active clinic reception queue for the requested date and applies valid transitions with author, timestamp, version, and AuditLog", async () => {
    const f = createFixture();

    // 1. Initial reception queue listing excludes CANCELLED and Clinic B appointments
    const initialQueueRes = await f.request(
      "GET",
      "/organizations/clinica-a/reception/queue?date=2026-10-12",
    );
    expect(initialQueueRes.status).toBe(200);
    const initialQueue =
      (await initialQueueRes.json()) as ReceptionQueueResponse;
    expect(initialQueue).toEqual({
      date: "2026-10-12",
      timeZone: "America/Fortaleza",
      queue: [
        {
          id: appointmentOneId,
          appointmentId: appointmentOneId,
          patientId: patientOneId,
          professionalId,
          scheduledAt: "2026-10-12T11:00:00.000Z",
          localScheduledAt: "2026-10-12T08:00:00",
          durationMinutes: 30,
          status: "CONFIRMED",
          queueStatus: "WAITING",
          arrivedAt: null,
          queueUpdatedAt: null,
          queueUpdatedById: null,
          version: 0,
        },
        {
          id: appointmentTwoId,
          appointmentId: appointmentTwoId,
          patientId: patientTwoId,
          professionalId,
          scheduledAt: "2026-10-12T11:30:00.000Z",
          localScheduledAt: "2026-10-12T08:30:00",
          durationMinutes: 30,
          status: "RESERVED",
          queueStatus: "WAITING",
          arrivedAt: null,
          queueUpdatedAt: null,
          queueUpdatedById: null,
          version: 0,
        },
      ],
    });

    // 2. WAITING -> ARRIVED by receptionist 1
    const arriveRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      {
        body: { status: "ARRIVED", version: 0 },
        token: f.tokenOne,
      },
    );
    expect(arriveRes.status).toBe(200);
    const arrivedItem = (await arriveRes.json()) as ReceptionQueueItem;
    expect(arrivedItem).toMatchObject({
      id: appointmentOneId,
      appointmentId: appointmentOneId,
      status: "CONFIRMED",
      queueStatus: "ARRIVED",
      queueUpdatedById: receptionistOneId,
      version: 1,
    });
    expect(typeof arrivedItem.arrivedAt).toBe("string");
    expect(arrivedItem.queueUpdatedAt).toBe(arrivedItem.arrivedAt);
    const recordedArrivedAt = arrivedItem.arrivedAt;

    // 3. ARRIVED -> CALLED by receptionist 2 via /appointments/:id/queue alias
    const callRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/appointments/${appointmentOneId}/queue`,
      {
        body: { queueStatus: "CALLED", version: 1 },
        token: f.tokenTwo,
      },
    );
    expect(callRes.status).toBe(200);
    const calledItem = (await callRes.json()) as ReceptionQueueItem;
    expect(calledItem).toMatchObject({
      id: appointmentOneId,
      status: "CONFIRMED",
      queueStatus: "CALLED",
      arrivedAt: recordedArrivedAt,
      queueUpdatedById: receptionistTwoId,
      version: 2,
    });

    // 4. CALLED -> IN_SERVICE via /appointments/:id/reception-status POST alias
    const inServiceRes = await f.request(
      "POST",
      `/organizations/clinica-a/appointments/${appointmentOneId}/reception-status`,
      {
        body: { status: "IN_SERVICE", version: 2 },
        token: f.tokenOne,
      },
    );
    expect(inServiceRes.status).toBe(200);
    const inServiceItem = (await inServiceRes.json()) as ReceptionQueueItem;
    expect(inServiceItem).toMatchObject({
      id: appointmentOneId,
      status: "CONFIRMED",
      queueStatus: "IN_SERVICE",
      arrivedAt: recordedArrivedAt,
      queueUpdatedById: receptionistOneId,
      version: 3,
    });

    // 5. IN_SERVICE -> COMPLETED synchronizes Appointment.status = COMPLETED
    const completeRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      {
        body: { status: "COMPLETED", version: 3 },
        token: f.tokenTwo,
      },
    );
    expect(completeRes.status).toBe(200);
    const completedItem = (await completeRes.json()) as ReceptionQueueItem;
    expect(completedItem).toMatchObject({
      id: appointmentOneId,
      status: "COMPLETED",
      queueStatus: "COMPLETED",
      arrivedAt: recordedArrivedAt,
      queueUpdatedById: receptionistTwoId,
      version: 4,
    });

    // 6. Second appointment WAITING -> NO_SHOW synchronizes Appointment.status = NO_SHOW
    const noShowRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/appointments/${appointmentTwoId}/arrival`,
      {
        body: { status: "NO_SHOW", version: 0 },
        token: f.tokenOne,
      },
    );
    expect(noShowRes.status).toBe(200);
    const noShowItem = (await noShowRes.json()) as ReceptionQueueItem;
    expect(noShowItem).toMatchObject({
      id: appointmentTwoId,
      status: "NO_SHOW",
      queueStatus: "NO_SHOW",
      arrivedAt: null,
      queueUpdatedById: receptionistOneId,
      version: 1,
    });

    // 7. Verify updated queue listing & filtering by queueStatus
    const completedQueueRes = await f.request(
      "GET",
      "/organizations/clinica-a/appointments/queue?date=2026-10-12&queueStatus=COMPLETED",
    );
    expect(completedQueueRes.status).toBe(200);
    const completedQueue =
      (await completedQueueRes.json()) as ReceptionQueueResponse;
    expect(completedQueue.queue).toHaveLength(1);
    expect(completedQueue.queue[0]).toMatchObject({
      id: appointmentOneId,
      status: "COMPLETED",
      queueStatus: "COMPLETED",
      arrivedAt: recordedArrivedAt,
      queueUpdatedById: receptionistTwoId,
      version: 4,
    });

    // 8. Verify all 5 AuditLog events were recorded with actor, target, fromStatus, toStatus, and version
    expect(f.auditLogs).toHaveLength(5);
    expect(
      f.auditLogs.map((log) => ({
        actorUserId: log.actorUserId,
        action: log.action,
        targetId: log.targetId,
        fromStatus: log.metadata.fromStatus,
        toStatus: log.metadata.toStatus,
        version: log.metadata.version,
      })),
    ).toEqual([
      {
        actorUserId: receptionistOneId,
        action: "RECEPTION_QUEUE_UPDATED",
        targetId: appointmentOneId,
        fromStatus: "WAITING",
        toStatus: "ARRIVED",
        version: 1,
      },
      {
        actorUserId: receptionistTwoId,
        action: "RECEPTION_QUEUE_UPDATED",
        targetId: appointmentOneId,
        fromStatus: "ARRIVED",
        toStatus: "CALLED",
        version: 2,
      },
      {
        actorUserId: receptionistOneId,
        action: "RECEPTION_QUEUE_UPDATED",
        targetId: appointmentOneId,
        fromStatus: "CALLED",
        toStatus: "IN_SERVICE",
        version: 3,
      },
      {
        actorUserId: receptionistTwoId,
        action: "RECEPTION_QUEUE_UPDATED",
        targetId: appointmentOneId,
        fromStatus: "IN_SERVICE",
        toStatus: "COMPLETED",
        version: 4,
      },
      {
        actorUserId: receptionistOneId,
        action: "RECEPTION_QUEUE_UPDATED",
        targetId: appointmentTwoId,
        fromStatus: "WAITING",
        toStatus: "NO_SHOW",
        version: 1,
      },
    ]);
  });

  test("rejects transitions outside the state machine with 409 INVALID_STATE_TRANSITION without mutating state or creating audit logs", async () => {
    const f = createFixture();

    // WAITING -> IN_SERVICE (skipping ARRIVED) is rejected
    const skipArrivalRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      { body: { status: "IN_SERVICE", version: 0 } },
    );
    expect(skipArrivalRes.status).toBe(409);
    expect(await skipArrivalRes.json()).toEqual({
      error: {
        code: "INVALID_STATE_TRANSITION",
        message: "Transição inválida de WAITING para IN_SERVICE.",
        details: {
          from: "WAITING",
          to: "IN_SERVICE",
          allowedTransitions: ["ARRIVED", "NO_SHOW"],
        },
      },
    });
    expect(f.appointments.get(appointmentOneId)?.queueStatus).toBe("WAITING");
    expect(f.appointments.get(appointmentOneId)?.version).toBe(0);
    expect(f.auditLogs).toHaveLength(0);

    // WAITING -> COMPLETED is rejected
    const skipToCompleteRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      { body: { status: "COMPLETED", version: 0 } },
    );
    expect(skipToCompleteRes.status).toBe(409);
    expect(f.auditLogs).toHaveLength(0);

    // Transition to ARRIVED (valid), then try ARRIVED -> COMPLETED (invalid, skipping IN_SERVICE)
    await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      { body: { status: "ARRIVED", version: 0 } },
    );
    expect(f.auditLogs).toHaveLength(1);

    const arrivedToCompletedRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      { body: { status: "COMPLETED", version: 1 } },
    );
    expect(arrivedToCompletedRes.status).toBe(409);
    expect(await arrivedToCompletedRes.json()).toEqual({
      error: {
        code: "INVALID_STATE_TRANSITION",
        message: "Transição inválida de ARRIVED para COMPLETED.",
        details: {
          from: "ARRIVED",
          to: "COMPLETED",
          allowedTransitions: ["CALLED", "IN_SERVICE", "NO_SHOW"],
        },
      },
    });
    expect(f.appointments.get(appointmentOneId)?.queueStatus).toBe("ARRIVED");
    expect(f.appointments.get(appointmentOneId)?.version).toBe(1);
    expect(f.auditLogs).toHaveLength(1);

    // Cancelled appointment cannot transition in the reception queue
    const cancelledRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${cancelledAppointmentId}`,
      { body: { status: "ARRIVED", version: 0 } },
    );
    expect(cancelledRes.status).toBe(409);
    expect(await cancelledRes.json()).toEqual({
      error: {
        code: "INVALID_STATE_TRANSITION",
        message: "Transição inválida de CANCELLED para ARRIVED.",
        details: {
          from: "CANCELLED",
          to: "ARRIVED",
          allowedTransitions: [],
        },
      },
    });
    expect(f.auditLogs).toHaveLength(1);
  });

  test("prevents two concurrent updates from overwriting each other with 409 VERSION_CONFLICT", async () => {
    const f = createFixture();

    // Session 1 and Session 2 both read version 0 and submit updates
    const firstUpdate = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      {
        body: { status: "ARRIVED", version: 0 },
        token: f.tokenOne,
      },
    );
    expect(firstUpdate.status).toBe(200);

    // Session 2 tries to transition the same appointment using stale version 0
    const staleConcurrentUpdate = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      {
        body: { status: "NO_SHOW", version: 0 },
        token: f.tokenTwo,
      },
    );
    expect(staleConcurrentUpdate.status).toBe(409);
    expect(await staleConcurrentUpdate.json()).toMatchObject({
      error: {
        code: "VERSION_CONFLICT",
      },
    });

    // State from Session 1 (ARRIVED, version 1, receptionistOneId) is intact
    expect(f.appointments.get(appointmentOneId)).toMatchObject({
      status: "CONFIRMED",
      queueStatus: "ARRIVED",
      queueUpdatedById: receptionistOneId,
      version: 1,
    });
    expect(f.auditLogs).toHaveLength(1);

    // Also test a race condition between findFirst and updateMany inside the transaction
    let simulatedInterleavingDone = false;
    const racingPrisma = {
      organization: {
        findUniqueOrThrow: async () => ({ timezone: "America/Fortaleza" }),
      },
      appointment: {
        findFirst: async () => ({
          id: appointmentTwoId,
          organizationId: clinicAId,
          patientId: patientTwoId,
          professionalId,
          scheduledAt: new Date("2026-10-12T11:30:00.000Z"),
          durationMinutes: 30,
          status: "RESERVED" as AppointmentStatus,
          queueStatus: "WAITING" as ReceptionQueueStatus,
          arrivedAt: null,
          queueUpdatedAt: null,
          queueUpdatedById: null,
          version: 0,
        }),
        updateMany: async () => {
          if (!simulatedInterleavingDone) {
            simulatedInterleavingDone = true;
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
      auditLog: {
        create: async () => ({ id: "audit-race" }),
      },
      $transaction: async <T>(fn: (tx: unknown) => Promise<T>) =>
        fn(racingPrisma),
    } as unknown as PrismaClient;

    const racingService = new AppointmentsService(racingPrisma);
    const [winner, loser] = await Promise.allSettled([
      racingService.transitionReceptionQueue(
        clinicAId,
        receptionistOneId,
        appointmentTwoId,
        { status: "ARRIVED", version: 0 },
      ),
      racingService.transitionReceptionQueue(
        clinicAId,
        receptionistTwoId,
        appointmentTwoId,
        { status: "NO_SHOW", version: 0 },
      ),
    ]);

    expect(winner.status).toBe("fulfilled");
    expect(loser.status).toBe("rejected");
    if (loser.status === "rejected") {
      expect(loser.reason).toMatchObject({
        code: "VERSION_CONFLICT",
        httpStatus: 409,
      });
    }
  });

  test("enforces RBAC capabilities and multi-tenant isolation across clinics", async () => {
    const f = createFixture();

    // Unauthenticated -> 401 UNAUTHENTICATED
    const unauthRes = await f.request(
      "GET",
      "/organizations/clinica-a/reception/queue",
      { token: null },
    );
    expect(unauthRes.status).toBe(401);
    expect(await unauthRes.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });

    // Non-member clinic -> 404 NOT_FOUND
    const foreignOrgRes = await f.request(
      "GET",
      "/organizations/clinica-b/reception/queue",
    );
    expect(foreignOrgRes.status).toBe(404);
    expect(await foreignOrgRes.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });

    // Suspended membership -> 403 MEMBERSHIP_INACTIVE
    f.setMembershipStatus("SUSPENDED");
    const suspendedRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      { body: { status: "ARRIVED", version: 0 } },
    );
    expect(suspendedRes.status).toBe(403);
    expect(await suspendedRes.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });
    f.setMembershipStatus("ACTIVE");

    // PROFESSIONAL has reception:read (200) but NOT reception:write (403 PERMISSION_DENIED)
    f.setRole("PROFESSIONAL");
    const profReadRes = await f.request(
      "GET",
      "/organizations/clinica-a/reception/queue?date=2026-10-12",
    );
    expect(profReadRes.status).toBe(200);

    const profWriteRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      { body: { status: "ARRIVED", version: 0 } },
    );
    expect(profWriteRes.status).toBe(403);
    expect(await profWriteRes.json()).toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        details: { requiredPermission: "reception:write" },
      },
    });

    // ADMIN and ADMIN_PROFESSIONAL have reception:write
    f.setRole("ADMIN");
    const adminWriteRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      { body: { status: "ARRIVED", version: 0 } },
    );
    expect(adminWriteRes.status).toBe(200);

    f.setRole("ADMIN_PROFESSIONAL");
    const adminProfWriteRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${appointmentOneId}`,
      { body: { status: "IN_SERVICE", version: 1 } },
    );
    expect(adminProfWriteRes.status).toBe(200);

    // Cross-clinic appointment ID returns 404 NOT_FOUND and never mutates Clinic B
    f.setRole("RECEPTIONIST");
    const crossClinicUpdate = await f.request(
      "PATCH",
      `/organizations/clinica-a/reception/queue/${clinicBAppointmentId}`,
      { body: { status: "ARRIVED", version: 0 } },
    );
    expect(crossClinicUpdate.status).toBe(404);
    expect(await crossClinicUpdate.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(f.appointments.get(clinicBAppointmentId)?.queueStatus).toBe(
      "WAITING",
    );
    expect(f.appointments.get(clinicBAppointmentId)?.version).toBe(0);
  });
});
