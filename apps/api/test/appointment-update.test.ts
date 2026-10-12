import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { AppointmentsService } from "../src/modules/appointments/service";

const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const professionalId = "33333333-3333-4333-8333-333333333333";
const patientId = "44444444-4444-4444-8444-444444444444";
const actorId = "55555555-5555-4555-8555-555555555555";

function fixture() {
  const row = {
    id,
    organizationId: org,
    patientId,
    professionalId,
    scheduledAt: new Date("2026-10-12T11:00:00.000Z"),
    durationMinutes: 30,
    status: "RESERVED",
    notes: null as string | null,
    version: 0,
  };
  const audits: Array<Record<string, unknown>> = [];
  let overlapping = false;
  let pause = false;
  let casMiss = false;
  const tx = {
    $executeRaw: async () => 1,
    appointment: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) =>
        where.id === id && where.organizationId === org ? { ...row } : null,
      findMany: async () =>
        overlapping
          ? [
              {
                id: "other",
                scheduledAt: new Date("2026-10-12T11:30:00.000Z"),
                durationMinutes: 30,
              },
            ]
          : [],
      updateMany: async ({
        where,
        data,
      }: {
        where: { version: number };
        data: Record<string, unknown>;
      }) => {
        if (casMiss || row.version !== where.version) return { count: 0 };
        Object.assign(row, data, { version: row.version + 1 });
        return { count: 1 };
      },
    },
    patient: { findFirst: async () => ({ id: patientId }) },
    membership: { findFirst: async () => ({ id: "membership" }) },
    weeklyScheduleRule: {
      findMany: async () => [{ startTime: "08:00", endTime: "12:00" }],
    },
    professionalSchedulePause: {
      findMany: async () =>
        pause
          ? [
              {
                startsAt: new Date("2026-10-12T11:30:00.000Z"),
                endsAt: new Date("2026-10-12T12:00:00.000Z"),
              },
            ]
          : [],
    },
    scheduleException: { findFirst: async () => null },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
      },
    },
  };
  const prisma = {
    organization: {
      findUniqueOrThrow: async () => ({ timezone: "America/Fortaleza" }),
    },
    $transaction: async (
      fn: (client: Record<string, unknown>) => Promise<unknown>,
    ) => fn(tx),
  } as unknown as PrismaClient;
  return {
    row,
    audits,
    service: new AppointmentsService(prisma),
    setOverlapping: () => {
      overlapping = true;
    },
    setPause: () => {
      pause = true;
    },
    setCasMiss: () => {
      casMiss = true;
    },
  };
}

async function errorCode(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).code;
  }
  throw new Error("Expected ApiError");
}

describe("appointment update", () => {
  test("increments version and audits changed values", async () => {
    const f = fixture();
    const result = await f.service.update(org, actorId, id, {
      version: 0,
      notes: "Retorno",
    });
    expect(result.appointment.version).toBe(1);
    expect(f.row.notes).toBe("Retorno");
    expect(f.audits).toHaveLength(1);
    expect(f.audits[0]?.actorUserId).toBe(actorId);
    expect(f.audits[0]?.metadata).toMatchObject({
      changed: {
        notes: { before: null, after: "Retorno" },
      },
    });
    expect(
      await errorCode(() =>
        f.service.update(org, actorId, id, { version: 0, notes: "Outra" }),
      ),
    ).toBe("VERSION_CONFLICT");
  });

  test("rejects a concurrent compare-and-swap miss", async () => {
    const f = fixture();
    f.setCasMiss();
    expect(
      await errorCode(() =>
        f.service.update(org, actorId, id, { version: 0, notes: "Retorno" }),
      ),
    ).toBe("VERSION_CONFLICT");
    expect(f.audits).toHaveLength(0);
  });

  test("validates schedule, pause and occupied slot", async () => {
    const outside = fixture();
    expect(
      await errorCode(() =>
        outside.service.update(org, actorId, id, {
          version: 0,
          scheduledAt: "2026-10-12T20:00:00.000Z",
        }),
      ),
    ).toBe("SLOT_CONFLICT");
    const paused = fixture();
    paused.setPause();
    expect(
      await errorCode(() =>
        paused.service.update(org, actorId, id, {
          version: 0,
          scheduledAt: "2026-10-12T11:30:00.000Z",
        }),
      ),
    ).toBe("SLOT_CONFLICT");
    const occupied = fixture();
    occupied.setOverlapping();
    expect(
      await errorCode(() =>
        occupied.service.update(org, actorId, id, {
          version: 0,
          scheduledAt: "2026-10-12T11:30:00.000Z",
        }),
      ),
    ).toBe("SLOT_CONFLICT");
  });

  test("rejects terminal and cross-clinic appointments", async () => {
    const f = fixture();
    f.row.status = "CANCELLED";
    expect(
      await errorCode(() =>
        f.service.update(org, actorId, id, { version: 0, notes: "Retorno" }),
      ),
    ).toBe("INVALID_STATE_TRANSITION");
    expect(
      await errorCode(() =>
        f.service.update(otherOrg, actorId, id, {
          version: 0,
          notes: "Retorno",
        }),
      ),
    ).toBe("NOT_FOUND");
  });
});
