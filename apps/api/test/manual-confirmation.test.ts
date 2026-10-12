import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type {
  AppointmentStatus,
  ConfirmationDecisionOrigin,
  ConfirmationDecisionStatus,
  MembershipRole,
  MembershipStatus,
  PrismaClient,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { appointmentsModule } from "../src/modules/appointments";
import type {
  ConfirmationDecisionResponse,
  PendingConfirmationsResponse,
} from "../src/modules/appointments/model";
import { signSessionToken } from "../src/services/session-token";

const secret = "manual-confirmation-test-secret-32chars!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";
const receptionistUserId = "33333333-3333-4333-8333-333333333333";
const professionalId = "44444444-4444-4444-8444-444444444444";
const otherProfessionalId = "55555555-5555-4555-8555-555555555555";
const patientOneId = "66666666-6666-4666-8666-666666666661";
const patientTwoId = "66666666-6666-4666-8666-666666666662";

const appointmentOneId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const appointmentTwoId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const appointmentThreeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const completedAppointmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const clinicBAppointmentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

const confirmationOneId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const confirmationTwoId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const clinicBConfirmationId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";

interface StoredAppointment {
  id: string;
  organizationId: string;
  patientId: string;
  professionalId: string;
  scheduledAt: Date;
  durationMinutes: number;
  status: AppointmentStatus;
}

interface StoredConfirmation {
  id: string;
  organizationId: string;
  appointmentId: string;
  status: ConfirmationDecisionStatus;
  origin: ConfirmationDecisionOrigin | null;
  originalMessage: string | null;
  originalMessageId: string | null;
  originalMessageAt: Date | null;
  note: string | null;
  decidedById: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredDecision {
  id: string;
  organizationId: string;
  appointmentId: string;
  confirmationId: string;
  decision: ConfirmationDecisionStatus;
  origin: ConfirmationDecisionOrigin;
  note: string | null;
  decidedById: string;
  decidedAt: Date;
  idempotencyKey: string | null;
  requestHash: string | null;
  createdAt: Date;
}

function createFixture() {
  let role: MembershipRole = "RECEPTIONIST";
  let membershipStatus: MembershipStatus = "ACTIVE";
  let membershipOrgSlug: string | null = "clinica-a";
  let sessionActive = true;
  const whatsappCalls = 0;

  const appointments = new Map<string, StoredAppointment>([
    [
      appointmentOneId,
      {
        id: appointmentOneId,
        organizationId: clinicAId,
        patientId: patientOneId,
        professionalId,
        scheduledAt: new Date("2026-10-15T12:00:00.000Z"),
        durationMinutes: 30,
        status: "RESERVED",
      },
    ],
    [
      appointmentTwoId,
      {
        id: appointmentTwoId,
        organizationId: clinicAId,
        patientId: patientTwoId,
        professionalId: otherProfessionalId,
        scheduledAt: new Date("2026-10-15T13:00:00.000Z"),
        durationMinutes: 30,
        status: "RESERVED",
      },
    ],
    [
      appointmentThreeId,
      {
        id: appointmentThreeId,
        organizationId: clinicAId,
        patientId: patientOneId,
        professionalId,
        scheduledAt: new Date("2026-10-16T14:00:00.000Z"),
        durationMinutes: 45,
        status: "RESERVED",
      },
    ],
    [
      completedAppointmentId,
      {
        id: completedAppointmentId,
        organizationId: clinicAId,
        patientId: patientOneId,
        professionalId,
        scheduledAt: new Date("2026-10-10T12:00:00.000Z"),
        durationMinutes: 30,
        status: "COMPLETED",
      },
    ],
    [
      clinicBAppointmentId,
      {
        id: clinicBAppointmentId,
        organizationId: clinicBId,
        patientId: patientTwoId,
        professionalId,
        scheduledAt: new Date("2026-10-15T15:00:00.000Z"),
        durationMinutes: 30,
        status: "RESERVED",
      },
    ],
  ]);

  const confirmations = new Map<string, StoredConfirmation>([
    [
      confirmationOneId,
      {
        id: confirmationOneId,
        organizationId: clinicAId,
        appointmentId: appointmentOneId,
        status: "PENDING",
        origin: null,
        originalMessage:
          "Oi, acho que vou atrasar uns 15 min, ainda posso ir ou melhor remarcar?",
        originalMessageId: "waha-msg-001",
        originalMessageAt: new Date("2026-10-14T11:30:00.000Z"),
        note: null,
        decidedById: null,
        decidedAt: null,
        createdAt: new Date("2026-10-14T11:30:00.000Z"),
        updatedAt: new Date("2026-10-14T11:30:00.000Z"),
      },
    ],
    [
      confirmationTwoId,
      {
        id: confirmationTwoId,
        organizationId: clinicAId,
        appointmentId: appointmentTwoId,
        status: "PENDING",
        origin: null,
        originalMessage: "Lembrete enviado sem resposta há 12h",
        originalMessageId: "waha-msg-002",
        originalMessageAt: new Date("2026-10-14T12:00:00.000Z"),
        note: null,
        decidedById: null,
        decidedAt: null,
        createdAt: new Date("2026-10-14T12:00:00.000Z"),
        updatedAt: new Date("2026-10-14T12:00:00.000Z"),
      },
    ],
    [
      clinicBConfirmationId,
      {
        id: clinicBConfirmationId,
        organizationId: clinicBId,
        appointmentId: clinicBAppointmentId,
        status: "PENDING",
        origin: null,
        originalMessage: "Mensagem confidencial da Clínica B",
        originalMessageId: "waha-msg-b1",
        originalMessageAt: new Date("2026-10-14T13:00:00.000Z"),
        note: null,
        decidedById: null,
        decidedAt: null,
        createdAt: new Date("2026-10-14T13:00:00.000Z"),
        updatedAt: new Date("2026-10-14T13:00:00.000Z"),
      },
    ],
  ]);

  const decisions: StoredDecision[] = [];
  const auditLogs: Array<Record<string, unknown>> = [];

  const appointmentApi = {
    findFirst: async ({
      where,
    }: {
      where: { id: string; organizationId: string };
    }) => {
      const found = appointments.get(where.id);
      if (!found || found.organizationId !== where.organizationId) return null;
      return { ...found };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: { status: AppointmentStatus };
    }) => {
      const existing = appointments.get(where.id);
      if (!existing) throw new Error("Appointment not found");
      const updated: StoredAppointment = {
        ...existing,
        status: data.status,
      };
      appointments.set(where.id, updated);
      return { ...updated };
    },
  };

  const confirmationApi = {
    findFirst: async ({
      where,
    }: {
      where: { id?: string; appointmentId?: string; organizationId: string };
    }) => {
      for (const item of confirmations.values()) {
        if (item.organizationId !== where.organizationId) continue;
        if (where.id && item.id !== where.id) continue;
        if (where.appointmentId && item.appointmentId !== where.appointmentId)
          continue;
        return { ...item };
      }
      return null;
    },
    findMany: async ({
      where,
      take,
      cursor,
      skip,
    }: {
      where: {
        organizationId: string;
        status: ConfirmationDecisionStatus;
        appointment?: { professionalId: string };
      };
      take: number;
      cursor?: { id: string };
      skip?: number;
    }) => {
      const filtered = [...confirmations.values()]
        .filter((item) => {
          if (item.organizationId !== where.organizationId) return false;
          if (item.status !== where.status) return false;
          const appt = appointments.get(item.appointmentId);
          if (!appt) return false;
          if (
            where.appointment?.professionalId &&
            appt.professionalId !== where.appointment.professionalId
          ) {
            return false;
          }
          return true;
        })
        .sort(
          (a, b) =>
            a.createdAt.getTime() - b.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        )
        .map((item) => ({
          ...item,
          appointment: { ...appointments.get(item.appointmentId)! },
        }));

      let startIndex = 0;
      if (cursor?.id) {
        const idx = filtered.findIndex((item) => item.id === cursor.id);
        startIndex = idx >= 0 ? idx + (skip ?? 0) : filtered.length;
      }
      return filtered.slice(startIndex, startIndex + take);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = `cccccccc-cccc-4ccc-8ccc-${String(confirmations.size + 10).padStart(12, "0")}`;
      const record: StoredConfirmation = {
        id,
        organizationId: data.organizationId as string,
        appointmentId: data.appointmentId as string,
        status: data.status as ConfirmationDecisionStatus,
        origin: (data.origin as ConfirmationDecisionOrigin | null) ?? null,
        originalMessage: (data.originalMessage as string | null) ?? null,
        originalMessageId: (data.originalMessageId as string | null) ?? null,
        originalMessageAt: (data.originalMessageAt as Date | null) ?? null,
        note: (data.note as string | null) ?? null,
        decidedById: (data.decidedById as string | null) ?? null,
        decidedAt: (data.decidedAt as Date | null) ?? null,
        createdAt: (data.decidedAt as Date) ?? new Date(),
        updatedAt: (data.decidedAt as Date) ?? new Date(),
      };
      confirmations.set(id, record);
      return { ...record };
    },
    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const existing = confirmations.get(where.id);
      if (!existing) throw new Error("Confirmation not found");
      const updated: StoredConfirmation = {
        ...existing,
        ...(data as Partial<StoredConfirmation>),
        updatedAt: (data.decidedAt as Date) ?? new Date(),
      };
      confirmations.set(where.id, updated);
      return { ...updated };
    },
  };

  const decisionApi = {
    findUnique: async ({
      where,
    }: {
      where: {
        organizationId_idempotencyKey: {
          organizationId: string;
          idempotencyKey: string;
        };
      };
    }) => {
      const { organizationId, idempotencyKey } =
        where.organizationId_idempotencyKey;
      const found = decisions.find(
        (d) =>
          d.organizationId === organizationId &&
          d.idempotencyKey === idempotencyKey,
      );
      if (!found) return null;
      return {
        ...found,
        confirmation: { ...confirmations.get(found.confirmationId)! },
        appointment: { ...appointments.get(found.appointmentId)! },
      };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const record: StoredDecision = {
        id: `decision-${decisions.length + 1}`,
        organizationId: data.organizationId as string,
        appointmentId: data.appointmentId as string,
        confirmationId: data.confirmationId as string,
        decision: data.decision as ConfirmationDecisionStatus,
        origin: data.origin as ConfirmationDecisionOrigin,
        note: (data.note as string | null) ?? null,
        decidedById: data.decidedById as string,
        decidedAt: data.decidedAt as Date,
        idempotencyKey: (data.idempotencyKey as string | null) ?? null,
        requestHash: (data.requestHash as string | null) ?? null,
        createdAt: data.decidedAt as Date,
      };
      decisions.push(record);
      return { ...record };
    },
  };

  const auditLogApi = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const entry = {
        id: `audit-${auditLogs.length + 1}`,
        ...data,
        createdAt: new Date(),
      };
      auditLogs.push(entry);
      return entry;
    },
  };

  const prisma = {
    organization: {
      findUniqueOrThrow: async () => ({ timezone: "America/Fortaleza" }),
    },
    session: {
      findFirst: async () =>
        sessionActive ? { id: "session-1", lastActiveAt: new Date() } : null,
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
    appointment: appointmentApi,
    appointmentConfirmation: confirmationApi,
    confirmationDecision: decisionApi,
    auditLog: auditLogApi,
    $transaction: async (callback: (tx: unknown) => unknown) =>
      callback({
        appointment: appointmentApi,
        appointmentConfirmation: confirmationApi,
        confirmationDecision: decisionApi,
        auditLog: auditLogApi,
      }),
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

  const token = signSessionToken(
    { sid: "session-1", sub: receptionistUserId },
    secret,
    3600,
  );

  const request = (
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
      authenticated?: boolean;
    } = {},
  ) => {
    const headers: Record<string, string> = {
      ...(options.authenticated !== false
        ? { authorization: `Bearer ${token}` }
        : {}),
      ...(options.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
      ...(options.headers ?? {}),
    };
    return app.handle(
      new Request(`http://localhost/api${path}`, {
        method: options.method ?? "GET",
        headers,
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
      }),
    );
  };

  return {
    request,
    appointments,
    confirmations,
    decisions,
    auditLogs,
    getWhatsappCalls: () => whatsappCalls,
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

describe("manual confirmation decisions (#241)", () => {
  test("lists pending confirmations for the active clinic and removes items once resolved as CONFIRMED or DECLINED", async () => {
    const f = createFixture();

    // 1. Initial pending list has 2 items from Clinic A (and never leaks Clinic B)
    const pendingRes = await f.request(
      "/organizations/clinica-a/confirmations/pending",
    );
    expect(pendingRes.status).toBe(200);
    const pendingBody =
      (await pendingRes.json()) as PendingConfirmationsResponse;
    expect(pendingBody.timeZone).toBe("America/Fortaleza");
    expect(pendingBody.data.map((item) => item.appointmentId)).toEqual([
      appointmentOneId,
      appointmentTwoId,
    ]);
    expect(pendingBody.data[0]).toMatchObject({
      id: confirmationOneId,
      appointmentId: appointmentOneId,
      organizationId: clinicAId,
      status: "PENDING",
      decision: "PENDING",
      origin: null,
      originalMessage:
        "Oi, acho que vou atrasar uns 15 min, ainda posso ir ou melhor remarcar?",
      localScheduledAt: "2026-10-15T09:00:00",
    });

    // Alias route /appointments/confirmations/pending returns identical data
    const aliasRes = await f.request(
      "/organizations/clinica-a/appointments/confirmations/pending",
    );
    expect(aliasRes.status).toBe(200);
    expect(await aliasRes.json()).toEqual(pendingBody);

    // 2. Resolve appointmentOne as CONFIRMED via phone call
    const confirmRes = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
      {
        method: "POST",
        body: {
          decision: "CONFIRMED",
          origin: "PHONE_CALL",
          note: "Paciente confirmou presença por ligação.",
        },
      },
    );
    expect(confirmRes.status).toBe(200);
    const confirmBody =
      (await confirmRes.json()) as ConfirmationDecisionResponse;
    expect(confirmBody.confirmation).toMatchObject({
      id: confirmationOneId,
      appointmentId: appointmentOneId,
      status: "CONFIRMED",
      decision: "CONFIRMED",
      origin: "PHONE_CALL",
      source: "PHONE_CALL",
      appointmentStatus: "CONFIRMED",
      decidedById: receptionistUserId,
      note: "Paciente confirmou presença por ligação.",
      originalMessage:
        "Oi, acho que vou atrasar uns 15 min, ainda posso ir ou melhor remarcar?",
    });
    expect(typeof confirmBody.confirmation.decidedAt).toBe("string");
    expect(f.appointments.get(appointmentOneId)?.status).toBe("CONFIRMED");

    // 3. AppointmentOne is no longer in the pending list
    const afterConfirmPending = await f.request(
      "/organizations/clinica-a/confirmations/pending",
    );
    expect(afterConfirmPending.status).toBe(200);
    const afterConfirmBody =
      (await afterConfirmPending.json()) as PendingConfirmationsResponse;
    expect(afterConfirmBody.data.map((item) => item.appointmentId)).toEqual([
      appointmentTwoId,
    ]);

    // 4. Resolve appointmentTwo as DECLINED via manual WhatsApp contact (using PATCH alias)
    const declineRes = await f.request(
      `/organizations/clinica-a/appointments/${appointmentTwoId}/confirmation`,
      {
        method: "PATCH",
        body: {
          decision: "DECLINED",
          source: "WHATSAPP_MANUAL",
          note: "Paciente pediu para cancelar nesta semana.",
        },
      },
    );
    expect(declineRes.status).toBe(200);
    const declineBody =
      (await declineRes.json()) as ConfirmationDecisionResponse;
    expect(declineBody.confirmation).toMatchObject({
      id: confirmationTwoId,
      appointmentId: appointmentTwoId,
      status: "DECLINED",
      decision: "DECLINED",
      origin: "WHATSAPP_MANUAL",
      source: "WHATSAPP_MANUAL",
      appointmentStatus: "CANCELLED",
      decidedById: receptionistUserId,
      originalMessage: "Lembrete enviado sem resposta há 12h",
    });
    expect(f.appointments.get(appointmentTwoId)?.status).toBe("CANCELLED");

    // 5. Pending list is now empty
    const emptyPendingRes = await f.request(
      "/organizations/clinica-a/confirmations/pending",
    );
    expect(emptyPendingRes.status).toBe(200);
    const emptyPendingBody =
      (await emptyPendingRes.json()) as PendingConfirmationsResponse;
    expect(emptyPendingBody.data).toEqual([]);

    // 6. Optional status filter can inspect resolved CONFIRMED and DECLINED history
    const confirmedHistoryRes = await f.request(
      "/organizations/clinica-a/confirmations/pending?status=CONFIRMED",
    );
    expect(confirmedHistoryRes.status).toBe(200);
    const confirmedHistory =
      (await confirmedHistoryRes.json()) as PendingConfirmationsResponse;
    expect(confirmedHistory.data.map((item) => item.appointmentId)).toEqual([
      appointmentOneId,
    ]);
  });

  test("records PENDING manual decision with origin, author, and timestamp while keeping item in pending queue", async () => {
    const f = createFixture();

    const pendingDecisionRes = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentThreeId}/decision`,
      {
        method: "POST",
        body: {
          decision: "PENDING",
          origin: "PHONE_CALL",
          note: "Chamada caiu na caixa postal; tentar novamente à tarde.",
        },
      },
    );
    expect(pendingDecisionRes.status).toBe(200);
    const body =
      (await pendingDecisionRes.json()) as ConfirmationDecisionResponse;
    expect(body.confirmation).toMatchObject({
      appointmentId: appointmentThreeId,
      status: "PENDING",
      decision: "PENDING",
      origin: "PHONE_CALL",
      decidedById: receptionistUserId,
      note: "Chamada caiu na caixa postal; tentar novamente à tarde.",
      appointmentStatus: "RESERVED",
    });
    expect(body.confirmation.decidedAt).not.toBeNull();

    const pendingListRes = await f.request(
      "/organizations/clinica-a/confirmations/pending",
    );
    const pendingList =
      (await pendingListRes.json()) as PendingConfirmationsResponse;
    expect(pendingList.data.map((item) => item.appointmentId)).toContain(
      appointmentThreeId,
    );
  });

  test("guarantees idempotency: repeating the decision or Idempotency-Key does not create another record, audit log, or message", async () => {
    const f = createFixture();

    const payload = {
      decision: "CONFIRMED" as const,
      origin: "PHONE_CALL" as const,
      note: "Confirmado com titular",
    };

    const firstRes = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
      {
        method: "POST",
        headers: { "idempotency-key": "confirm-key-0001" },
        body: payload,
      },
    );
    expect(firstRes.status).toBe(200);
    const firstBody = (await firstRes.json()) as ConfirmationDecisionResponse;
    expect(f.decisions).toHaveLength(1);
    expect(f.auditLogs).toHaveLength(1);
    expect(f.auditLogs[0]).toMatchObject({
      organizationId: clinicAId,
      actorUserId: receptionistUserId,
      action: "MANUAL_CONFIRMATION_DECIDED",
      targetType: "APPOINTMENT",
      targetId: appointmentOneId,
    });
    expect(f.getWhatsappCalls()).toBe(0);

    // 1. Replay with the same Idempotency-Key
    const keyReplayRes = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
      {
        method: "POST",
        headers: { "idempotency-key": "confirm-key-0001" },
        body: payload,
      },
    );
    expect(keyReplayRes.status).toBe(200);
    expect(await keyReplayRes.json()).toEqual(firstBody);
    expect(f.decisions).toHaveLength(1);
    expect(f.auditLogs).toHaveLength(1);
    expect(f.getWhatsappCalls()).toBe(0);

    // 2. Replay the exact same decision WITHOUT Idempotency-Key (or with a new key)
    const stateReplayRes = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
      {
        method: "POST",
        body: payload,
      },
    );
    expect(stateReplayRes.status).toBe(200);
    expect(await stateReplayRes.json()).toEqual(firstBody);
    expect(f.decisions).toHaveLength(1);
    expect(f.auditLogs).toHaveLength(1);
    expect(f.getWhatsappCalls()).toBe(0);

    // 3. Reusing the same Idempotency-Key with different decision payload -> 409 IDEMPOTENCY_CONFLICT
    const conflictRes = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
      {
        method: "POST",
        headers: { "idempotency-key": "confirm-key-0001" },
        body: {
          decision: "DECLINED",
          origin: "PHONE_CALL",
        },
      },
    );
    expect(conflictRes.status).toBe(409);
    expect(await conflictRes.json()).toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(f.decisions).toHaveLength(1);
    expect(f.auditLogs).toHaveLength(1);
  });

  test("preserves original message untouched and rejects attempts to overwrite message or author fields", async () => {
    const f = createFixture();

    const before = f.confirmations.get(confirmationOneId);
    expect(before?.originalMessage).toBe(
      "Oi, acho que vou atrasar uns 15 min, ainda posso ir ou melhor remarcar?",
    );
    expect(before?.originalMessageId).toBe("waha-msg-001");

    // Attempt to inject originalMessage or decidedById in body is rejected by strict schema
    const tamperedRes = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
      {
        method: "POST",
        body: {
          decision: "CONFIRMED",
          origin: "PHONE_CALL",
          originalMessage: "Texto adulterado",
        },
      },
    );
    expect(tamperedRes.status).toBe(400);
    expect(await tamperedRes.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    // Valid manual decision leaves originalMessage, originalMessageId, and originalMessageAt intact
    const validRes = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
      {
        method: "POST",
        body: {
          decision: "CONFIRMED",
          origin: "IN_PERSON",
          note: "Confirmado presencialmente no balcão",
        },
      },
    );
    expect(validRes.status).toBe(200);
    const body = (await validRes.json()) as ConfirmationDecisionResponse;
    expect(body.confirmation.originalMessage).toBe(
      "Oi, acho que vou atrasar uns 15 min, ainda posso ir ou melhor remarcar?",
    );
    expect(body.confirmation.originalMessageId).toBe("waha-msg-001");
    expect(body.confirmation.originalMessageAt).toBe(
      "2026-10-14T11:30:00.000Z",
    );

    const after = f.confirmations.get(confirmationOneId);
    expect(after?.originalMessage).toBe(before?.originalMessage);
    expect(after?.originalMessageId).toBe(before?.originalMessageId);
    expect(after?.originalMessageAt?.toISOString()).toBe(
      before?.originalMessageAt?.toISOString(),
    );
  });

  test("supports cursor pagination, professional filtering, and validates business rules", async () => {
    const f = createFixture();

    // Filter by professionalId
    const byProfRes = await f.request(
      `/organizations/clinica-a/confirmations/pending?professionalId=${professionalId}`,
    );
    expect(byProfRes.status).toBe(200);
    const byProfBody = (await byProfRes.json()) as PendingConfirmationsResponse;
    expect(byProfBody.data.map((item) => item.appointmentId)).toEqual([
      appointmentOneId,
    ]);

    // Cursor pagination
    const page1Res = await f.request(
      "/organizations/clinica-a/confirmations/pending?limit=1",
    );
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as PendingConfirmationsResponse;
    expect(page1.data).toHaveLength(1);
    expect(page1.pageInfo).toEqual({
      nextCursor: confirmationOneId,
      hasNextPage: true,
    });

    const page2Res = await f.request(
      `/organizations/clinica-a/confirmations/pending?limit=1&cursor=${confirmationOneId}`,
    );
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as PendingConfirmationsResponse;
    expect(page2.data).toHaveLength(1);
    expect(page2.data[0]?.id).toBe(confirmationTwoId);
    expect(page2.pageInfo).toEqual({
      nextCursor: null,
      hasNextPage: false,
    });

    // Foreign clinic cursor is rejected with 400 VALIDATION_ERROR
    const foreignCursorRes = await f.request(
      `/organizations/clinica-a/confirmations/pending?cursor=${clinicBConfirmationId}`,
    );
    expect(foreignCursorRes.status).toBe(400);
    expect(await foreignCursorRes.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    // Missing origin/source -> 400 VALIDATION_ERROR
    const missingOriginRes = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
      {
        method: "POST",
        body: { decision: "CONFIRMED" },
      },
    );
    expect(missingOriginRes.status).toBe(400);
    expect(await missingOriginRes.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", details: { field: "origin" } },
    });

    // Completed appointment -> 422 BUSINESS_RULE_VIOLATION
    const completedRes = await f.request(
      `/organizations/clinica-a/confirmations/${completedAppointmentId}/decision`,
      {
        method: "POST",
        body: { decision: "CONFIRMED", origin: "PHONE_CALL" },
      },
    );
    expect(completedRes.status).toBe(422);
    expect(await completedRes.json()).toMatchObject({
      error: { code: "BUSINESS_RULE_VIOLATION" },
    });
  });

  test("enforces cross-clinic isolation and RBAC permissions", async () => {
    const f = createFixture();

    // 1. Unauthenticated -> 401 UNAUTHENTICATED
    const unauthList = await f.request(
      "/organizations/clinica-a/confirmations/pending",
      { authenticated: false },
    );
    expect(unauthList.status).toBe(401);

    const unauthDecide = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
      {
        method: "POST",
        authenticated: false,
        body: { decision: "CONFIRMED", origin: "PHONE_CALL" },
      },
    );
    expect(unauthDecide.status).toBe(401);

    // 2. Non-member clinic slug -> 404 NOT_FOUND
    const foreignClinicRes = await f.request(
      "/organizations/clinica-b/confirmations/pending",
    );
    expect(foreignClinicRes.status).toBe(404);
    expect(await foreignClinicRes.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });

    // 3. Appointment belonging to another clinic -> 404 NOT_FOUND
    const crossTenantDecision = await f.request(
      `/organizations/clinica-a/confirmations/${clinicBAppointmentId}/decision`,
      {
        method: "POST",
        body: { decision: "CONFIRMED", origin: "PHONE_CALL" },
      },
    );
    expect(crossTenantDecision.status).toBe(404);
    expect(await crossTenantDecision.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(f.appointments.get(clinicBAppointmentId)?.status).toBe("RESERVED");
    expect(f.confirmations.get(clinicBConfirmationId)?.status).toBe("PENDING");

    // 4. Suspended membership -> 403 MEMBERSHIP_INACTIVE
    f.setMembershipStatus("SUSPENDED");
    const suspendedRes = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
      {
        method: "POST",
        body: { decision: "CONFIRMED", origin: "PHONE_CALL" },
      },
    );
    expect(suspendedRes.status).toBe(403);
    expect(await suspendedRes.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });
    f.setMembershipStatus("ACTIVE");

    // 5. PROFESSIONAL role can read pending queue (reception:read) but cannot record manual decisions (reception:write)
    f.setRole("PROFESSIONAL");
    const profReadRes = await f.request(
      "/organizations/clinica-a/confirmations/pending",
    );
    expect(profReadRes.status).toBe(200);

    const profWriteRes = await f.request(
      `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
      {
        method: "POST",
        body: { decision: "CONFIRMED", origin: "PHONE_CALL" },
      },
    );
    expect(profWriteRes.status).toBe(403);
    expect(await profWriteRes.json()).toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        details: { requiredPermission: "reception:write" },
      },
    });

    // 6. RECEPTIONIST, ADMIN, and ADMIN_PROFESSIONAL can record decisions
    for (const allowedRole of [
      "RECEPTIONIST",
      "ADMIN",
      "ADMIN_PROFESSIONAL",
    ] as const) {
      f.setRole(allowedRole);
      const res = await f.request(
        `/organizations/clinica-a/confirmations/${appointmentOneId}/decision`,
        {
          method: "POST",
          body: { decision: "CONFIRMED", origin: "PHONE_CALL" },
        },
      );
      expect(res.status).toBe(200);
    }
  });
});
