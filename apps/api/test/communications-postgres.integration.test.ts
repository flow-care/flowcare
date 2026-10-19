import { describe, expect, test } from "bun:test";
import { createHmac, randomUUID } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  CommunicationsMessageService,
  hashProviderMessageId,
  lockWhatsAppProviderMessage,
} from "../src/modules/communications/messages-service";
import { WhatsAppQueueWorker } from "../src/modules/communications/worker";
import { createPrismaClient } from "../src/services/db";
import type { WhatsAppProvider } from "../src/services/waha-client";

const secret = "postgres-integration-webhook-secret";
const configuredDatabaseUrl = process.env.WHATSAPP_TEST_DATABASE_URL;

function safeTestDatabaseUrl(): string | null {
  if (!configuredDatabaseUrl) return null;
  const url = new URL(configuredDatabaseUrl);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.includes("medicalflow_pr484")
  )
    throw new Error(
      "WHATSAPP_TEST_DATABASE_URL must target a local disposable PR 484 database.",
    );
  return configuredDatabaseUrl;
}

const databaseUrl = safeTestDatabaseUrl();
const postgresTest = databaseUrl ? test : test.skip;

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function createFixture(prisma: PrismaClient) {
  const id = randomUUID();
  const userId = randomUUID();
  const organizationId = randomUUID();
  const patientId = randomUUID();
  const appointmentId = randomUUID();
  const templateId = randomUUID();
  const templateVersionId = randomUUID();
  const messageId = randomUUID();
  const sessionName = `pr484-${id}`;

  await prisma.user.create({
    data: {
      id: userId,
      email: `${id}@example.test`,
      fullName: "PostgreSQL Test User",
      passwordHash: "not-a-real-password-hash",
    },
  });
  await prisma.organization.create({
    data: {
      id: organizationId,
      name: "PostgreSQL Test Clinic",
      slug: `pr484-${id}`,
      ownerId: userId,
    },
  });
  await prisma.patient.create({
    data: {
      id: patientId,
      organizationId,
      fullName: "PostgreSQL Test Patient",
      normalizedName: "postgresql test patient",
      cpf: id.replaceAll("-", "").slice(0, 11),
      birthDate: new Date("1990-01-01T00:00:00Z"),
      phone: "11987654321",
    },
  });
  await prisma.appointment.create({
    data: {
      id: appointmentId,
      organizationId,
      patientId,
      professionalId: userId,
      scheduledAt: new Date(Date.now() + 86_400_000),
      durationMinutes: 30,
      status: "RESERVED",
    },
  });
  await prisma.whatsAppSession.create({
    data: { organizationId, providerSessionName: sessionName },
  });
  await prisma.whatsAppPreference.create({
    data: {
      organizationId,
      patientId,
      optedIn: true,
      source: "postgres-integration-test",
      recordedById: userId,
    },
  });
  await prisma.whatsAppTemplate.create({
    data: {
      id: templateId,
      organizationId,
      type: "APPOINTMENT_CONFIRMATION",
      content: "Consulta de {paciente_nome} em {data} às {hora}.",
      version: 1,
      approvedById: userId,
      approvedAt: new Date(),
    },
  });
  await prisma.whatsAppTemplateVersion.create({
    data: {
      id: templateVersionId,
      templateId,
      organizationId,
      type: "APPOINTMENT_CONFIRMATION",
      content: "Consulta de {paciente_nome} em {data} às {hora}.",
      version: 1,
      approvedById: userId,
      approvedAt: new Date(),
    },
  });
  await prisma.whatsAppMessage.create({
    data: {
      id: messageId,
      organizationId,
      patientId,
      appointmentId,
      templateVersionId,
      eventId: `${appointmentId}:0`,
      type: "APPOINTMENT_CREATED",
      nextAttemptAt: new Date(Date.now() - 1_000),
    },
  });

  return {
    userId,
    organizationId,
    patientId,
    messageId,
    sessionName,
  };
}

async function removeFixture(
  prisma: PrismaClient,
  fixture: Awaited<ReturnType<typeof createFixture>>,
) {
  await prisma.organization.delete({ where: { id: fixture.organizationId } });
  await prisma.user.delete({ where: { id: fixture.userId } });
}

function acknowledgement(
  session: string,
  providerMessageId: string,
  ackName: "ERROR" | "READ" = "READ",
  ack: -1 | 3 = 3,
) {
  const raw = JSON.stringify({
    id: `evt_${randomUUID()}`,
    timestamp: Date.now(),
    event: "message.ack",
    session,
    payload: { id: providerMessageId, ack, ackName },
  });
  return {
    raw,
    signature: createHmac("sha512", secret).update(raw).digest("hex"),
  };
}

function provider(
  providerMessageId: string,
  onSend?: () => void,
): WhatsAppProvider {
  return {
    getSession: async () => ({ status: "WORKING" }),
    createSession: async () => ({ status: "WORKING" }),
    restartSession: async () => {},
    getQr: async () => null,
    sendText: async () => {
      onSend?.();
      return providerMessageId;
    },
  };
}

async function waitForAdvisoryLock(prisma: PrismaClient) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM pg_locks
      WHERE locktype = 'advisory' AND granted
    `;
    if (Number(row?.count ?? 0n) > 0) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for the worker advisory lock.");
}

function namedDatabaseUrl(applicationName: string) {
  const url = new URL(databaseUrl as string);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

async function withTimeout<T>(
  promise: Promise<T>,
  description: string,
  timeoutMs = 5_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${description}.`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForBlockedApplication(
  prisma: PrismaClient,
  applicationName: string,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE application_name = ${applicationName}
          AND cardinality(pg_blocking_pids(pid)) > 0
      ) AS blocked
    `;
    if (row?.blocked) return;
    await Bun.sleep(10);
  }
  throw new Error(
    `Timed out waiting for blocked application ${applicationName}.`,
  );
}

async function waitForCompletionOrBlock(
  prisma: PrismaClient,
  applicationName: string,
  completed: () => boolean,
) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (completed()) return;
    const [row] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE application_name = ${applicationName}
          AND cardinality(pg_blocking_pids(pid)) > 0
      ) AS blocked
    `;
    if (row?.blocked) return;
    await Bun.sleep(10);
  }
  throw new Error(
    `Timed out waiting for application ${applicationName} to complete or block.`,
  );
}

describe("WhatsApp PostgreSQL integration", () => {
  postgresTest(
    "serializes the same organization and provider hash",
    async () => {
      const first = createPrismaClient(databaseUrl as string);
      const second = createPrismaClient(databaseUrl as string);
      const organizationId = randomUUID();
      const otherOrganizationId = randomUUID();
      const providerMessageHash = hashProviderMessageId(randomUUID());
      try {
        const locked = gate();
        const release = gate();
        let secondAcquired = false;
        const holder = first.$transaction(async (tx) => {
          await lockWhatsAppProviderMessage(
            tx,
            organizationId,
            providerMessageHash,
          );
          locked.open();
          await release.promise;
        });
        await locked.promise;
        const started = performance.now();
        const waiter = second.$transaction(async (tx) => {
          await lockWhatsAppProviderMessage(
            tx,
            organizationId,
            providerMessageHash,
          );
          secondAcquired = true;
        });
        await Bun.sleep(300);
        expect(secondAcquired).toBe(false);
        release.open();
        await Promise.all([holder, waiter]);
        expect(performance.now() - started).toBeGreaterThanOrEqual(250);

        const otherLocked = gate();
        const otherRelease = gate();
        const otherHolder = first.$transaction(async (tx) => {
          await lockWhatsAppProviderMessage(
            tx,
            organizationId,
            providerMessageHash,
          );
          otherLocked.open();
          await otherRelease.promise;
        });
        await otherLocked.promise;
        const otherStarted = performance.now();
        await second.$transaction((tx) =>
          lockWhatsAppProviderMessage(
            tx,
            otherOrganizationId,
            providerMessageHash,
          ),
        );
        expect(performance.now() - otherStarted).toBeLessThan(250);
        otherRelease.open();
        await otherHolder;
      } finally {
        await Promise.all([first.$disconnect(), second.$disconnect()]);
      }
    },
  );

  postgresTest(
    "reconciles an acknowledgement received before the provider hash",
    async () => {
      const prisma = createPrismaClient(databaseUrl as string);
      const fixture = await createFixture(prisma);
      const providerMessageId = `provider-${randomUUID()}`;
      const ack = acknowledgement(fixture.sessionName, providerMessageId);
      try {
        const service = new CommunicationsMessageService(prisma);
        await service.webhook(
          ack.raw,
          ack.signature,
          randomUUID(),
          String(Date.now()),
          secret,
        );
        const early = await prisma.whatsAppWebhookEvent.findFirstOrThrow({
          where: { organizationId: fixture.organizationId },
        });
        expect(early.messageId).toBeNull();

        await new WhatsAppQueueWorker(
          prisma,
          provider(providerMessageId),
        ).processBatch(1);

        const message = await prisma.whatsAppMessage.findUniqueOrThrow({
          where: { id: fixture.messageId },
        });
        const correlated = await prisma.whatsAppWebhookEvent.findUniqueOrThrow({
          where: { id: early.id },
        });
        expect(message.status).toBe("READ");
        expect(correlated.messageId).toBe(fixture.messageId);
      } finally {
        await removeFixture(prisma, fixture);
        await prisma.$disconnect();
      }
    },
  );

  postgresTest(
    "cancels a claimed manual resend when an old ERROR arrives before its dispatch fence",
    async () => {
      const workerPrisma = createPrismaClient(databaseUrl as string);
      const webhookPrisma = createPrismaClient(databaseUrl as string);
      const fixture = await createFixture(workerPrisma);
      const oldProviderMessageId = `old-provider-${randomUUID()}`;
      const oldProviderMessageHash =
        hashProviderMessageId(oldProviderMessageId);
      const workerReachedProviderCheck = gate();
      const resumeWorker = gate();
      let workerRun: Promise<number> | null = null;
      let sends = 0;
      try {
        const oldAttemptTime = new Date(Date.now() - 120_000);
        await workerPrisma.whatsAppMessageAttempt.create({
          data: {
            organizationId: fixture.organizationId,
            messageId: fixture.messageId,
            number: 1,
            origin: "AUTOMATIC",
            startedAt: oldAttemptTime,
            dispatchedAt: oldAttemptTime,
            completedAt: new Date(oldAttemptTime.getTime() + 1_000),
            providerMessageHash: oldProviderMessageHash,
          },
        });
        await workerPrisma.whatsAppMessage.update({
          where: { id: fixture.messageId },
          data: {
            status: "FAILED",
            providerMessageHash: oldProviderMessageHash,
            attemptCount: 1,
            errorCode: "PREVIOUS_FAILURE",
            errorReason: "Falha anterior preparada pelo teste.",
          },
        });

        const service = new CommunicationsMessageService(webhookPrisma);
        await service.authorizeManualResend(
          fixture.organizationId,
          fixture.messageId,
          fixture.userId,
          "postgres-original-resend-key",
        );

        const blockedProvider: WhatsAppProvider = {
          getSession: async () => {
            workerReachedProviderCheck.open();
            await resumeWorker.promise;
            return { status: "WORKING" };
          },
          createSession: async () => ({ status: "WORKING" }),
          restartSession: async () => {},
          getQr: async () => null,
          sendText: async () => {
            sends += 1;
            return `unexpected-provider-${randomUUID()}`;
          },
        };
        workerRun = new WhatsAppQueueWorker(
          workerPrisma,
          blockedProvider,
        ).processBatch(1);
        await workerReachedProviderCheck.promise;
        expect(
          (
            await workerPrisma.whatsAppMessage.findUniqueOrThrow({
              where: { id: fixture.messageId },
            })
          ).leaseUntil,
        ).toBeInstanceOf(Date);

        const ack = acknowledgement(
          fixture.sessionName,
          oldProviderMessageId,
          "ERROR",
          -1,
        );
        await service.webhook(
          ack.raw,
          ack.signature,
          randomUUID(),
          String(Date.now()),
          secret,
        );
        resumeWorker.open();
        expect(await workerRun).toBe(1);

        const cancelledMessage =
          await workerPrisma.whatsAppMessage.findUniqueOrThrow({
            where: { id: fixture.messageId },
          });
        const cancelledAttempt =
          await workerPrisma.whatsAppMessageAttempt.findFirstOrThrow({
            where: {
              organizationId: fixture.organizationId,
              idempotencyKey: "postgres-original-resend-key",
            },
          });
        expect(cancelledMessage).toMatchObject({
          status: "FAILED",
          attemptCount: 2,
          leaseUntil: null,
          errorCode: "WAHA_ACK_ERROR",
        });
        expect(cancelledAttempt).toMatchObject({
          dispatchedAt: null,
          providerMessageHash: null,
          errorCode: "MANUAL_RESEND_CANCELLED",
        });
        expect(cancelledAttempt.completedAt).toBeInstanceOf(Date);
        expect(sends).toBe(0);

        await service.authorizeManualResend(
          fixture.organizationId,
          fixture.messageId,
          fixture.userId,
          "postgres-new-resend-key",
        );
        expect(
          await workerPrisma.whatsAppMessageAttempt.count({
            where: { messageId: fixture.messageId },
          }),
        ).toBe(3);
        await service.authorizeManualResend(
          fixture.organizationId,
          fixture.messageId,
          fixture.userId,
          "postgres-original-resend-key",
        );
        expect(
          await workerPrisma.whatsAppMessageAttempt.count({
            where: { messageId: fixture.messageId },
          }),
        ).toBe(3);
      } finally {
        resumeWorker.open();
        if (workerRun) await workerRun.catch(() => {});
        await removeFixture(workerPrisma, fixture);
        await Promise.all([
          workerPrisma.$disconnect(),
          webhookPrisma.$disconnect(),
        ]);
      }
    },
  );

  postgresTest(
    "waits when an acknowledgement arrives during the worker transaction",
    async () => {
      const prisma = createPrismaClient(databaseUrl as string);
      const observer = createPrismaClient(databaseUrl as string);
      const fixture = await createFixture(prisma);
      const providerMessageId = `provider-${randomUUID()}`;
      const sent = gate();
      const ack = acknowledgement(fixture.sessionName, providerMessageId);
      await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION pr484_hold_worker_transaction()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM pg_sleep(1.2);
        RETURN NEW;
      END;
      $$
    `);
      await prisma.$executeRawUnsafe(`
      CREATE TRIGGER pr484_hold_worker_transaction
      BEFORE UPDATE ON "WhatsAppMessageAttempt"
      FOR EACH ROW
      WHEN (NEW."providerMessageHash" IS NOT NULL)
      EXECUTE FUNCTION pr484_hold_worker_transaction()
    `);
      try {
        const worker = new WhatsAppQueueWorker(
          prisma,
          provider(providerMessageId, sent.open),
        );
        const workerRun = worker.processBatch(1);
        await sent.promise;
        await waitForAdvisoryLock(observer);

        const service = new CommunicationsMessageService(observer);
        const started = performance.now();
        const webhookRun = service.webhook(
          ack.raw,
          ack.signature,
          randomUUID(),
          String(Date.now()),
          secret,
        );
        await Promise.all([workerRun, webhookRun]);
        expect(performance.now() - started).toBeGreaterThan(500);

        await service.webhook(
          ack.raw,
          ack.signature,
          randomUUID(),
          String(Date.now()),
          secret,
        );
        const message = await prisma.whatsAppMessage.findUniqueOrThrow({
          where: { id: fixture.messageId },
        });
        const events = await prisma.whatsAppWebhookEvent.findMany({
          where: { organizationId: fixture.organizationId },
        });
        expect(message.status).toBe("READ");
        expect(events).toHaveLength(1);
        expect(events[0]?.messageId).toBe(fixture.messageId);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS pr484_hold_worker_transaction ON "WhatsAppMessageAttempt"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS pr484_hold_worker_transaction()",
        );
        await removeFixture(prisma, fixture);
        await Promise.all([prisma.$disconnect(), observer.$disconnect()]);
      }
    },
  );

  postgresTest(
    "keeps an accepted send uncertain after local persistence failure and never retries it",
    async () => {
      const prisma = createPrismaClient(databaseUrl as string);
      const fixture = await createFixture(prisma);
      const providerMessageId = `provider-${randomUUID()}`;
      const ack = acknowledgement(fixture.sessionName, providerMessageId);
      let sends = 0;
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION pr484_fail_sent_persistence()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW."providerMessageHash" IS NOT NULL AND NEW."errorCode" IS NULL THEN
            RAISE EXCEPTION 'forced SENT persistence failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER pr484_fail_sent_persistence
        BEFORE UPDATE ON "WhatsAppMessageAttempt"
        FOR EACH ROW
        EXECUTE FUNCTION pr484_fail_sent_persistence()
      `);
      try {
        const worker = new WhatsAppQueueWorker(
          prisma,
          provider(providerMessageId, () => {
            sends += 1;
          }),
        );
        expect(await worker.processBatch(1)).toBe(1);
        const uncertain = await prisma.whatsAppMessage.findUniqueOrThrow({
          where: { id: fixture.messageId },
        });
        expect(uncertain.status).toBe("UNCERTAIN");
        expect(uncertain.providerMessageHash).toBe(
          hashProviderMessageId(providerMessageId),
        );
        expect(sends).toBe(1);
        expect(await worker.processBatch(1)).toBe(0);
        expect(sends).toBe(1);

        await prisma.$executeRawUnsafe(
          'DROP TRIGGER pr484_fail_sent_persistence ON "WhatsAppMessageAttempt"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION pr484_fail_sent_persistence()",
        );
        await new CommunicationsMessageService(prisma).webhook(
          ack.raw,
          ack.signature,
          randomUUID(),
          String(Date.now()),
          secret,
        );
        expect(
          (
            await prisma.whatsAppMessage.findUniqueOrThrow({
              where: { id: fixture.messageId },
            })
          ).status,
        ).toBe("READ");
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS pr484_fail_sent_persistence ON "WhatsAppMessageAttempt"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS pr484_fail_sent_persistence()",
        );
        await removeFixture(prisma, fixture);
        await prisma.$disconnect();
      }
    },
  );

  postgresTest(
    "rolls back the event when reconciliation persistence fails",
    async () => {
      const prisma = createPrismaClient(databaseUrl as string);
      const fixture = await createFixture(prisma);
      const providerMessageId = `provider-${randomUUID()}`;
      const providerMessageHash = hashProviderMessageId(providerMessageId);
      const ack = acknowledgement(fixture.sessionName, providerMessageId);
      await prisma.whatsAppMessage.update({
        where: { id: fixture.messageId },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageHash,
        },
      });
      await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION pr484_fail_read_reconciliation()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."status"::text = 'READ' THEN
          RAISE EXCEPTION 'forced reconciliation failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
      await prisma.$executeRawUnsafe(`
      CREATE TRIGGER pr484_fail_read_reconciliation
      BEFORE UPDATE ON "WhatsAppMessage"
      FOR EACH ROW
      EXECUTE FUNCTION pr484_fail_read_reconciliation()
    `);
      const service = new CommunicationsMessageService(prisma);
      try {
        await expect(
          service.webhook(
            ack.raw,
            ack.signature,
            randomUUID(),
            String(Date.now()),
            secret,
          ),
        ).rejects.toThrow();
        expect(
          await prisma.whatsAppWebhookEvent.count({
            where: { organizationId: fixture.organizationId },
          }),
        ).toBe(0);
        expect(
          (
            await prisma.whatsAppMessage.findUniqueOrThrow({
              where: { id: fixture.messageId },
            })
          ).status,
        ).toBe("SENT");

        await prisma.$executeRawUnsafe(
          'DROP TRIGGER pr484_fail_read_reconciliation ON "WhatsAppMessage"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION pr484_fail_read_reconciliation()",
        );
        await service.webhook(
          ack.raw,
          ack.signature,
          randomUUID(),
          String(Date.now()),
          secret,
        );
        expect(
          (
            await prisma.whatsAppMessage.findUniqueOrThrow({
              where: { id: fixture.messageId },
            })
          ).status,
        ).toBe("READ");
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS pr484_fail_read_reconciliation ON "WhatsAppMessage"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION IF EXISTS pr484_fail_read_reconciliation()",
        );
        await removeFixture(prisma, fixture);
        await prisma.$disconnect();
      }
    },
  );

  postgresTest(
    "cancels an authorized manual resend when opt-out waits behind eligibility locks",
    async () => {
      const suffix = randomUUID().slice(0, 8);
      const setup = createPrismaClient(databaseUrl as string);
      const holder = createPrismaClient(
        namedDatabaseUrl(`pr484-holder-${suffix}`),
      );
      const authorizationPrisma = createPrismaClient(
        namedDatabaseUrl(`pr484-auth-${suffix}`),
      );
      const preferencePrisma = createPrismaClient(
        namedDatabaseUrl(`pr484-pref-${suffix}`),
      );
      const observer = createPrismaClient(databaseUrl as string);
      const fixture = await createFixture(setup);
      const messageLocked = gate();
      const releaseMessage = gate();
      let holderRun: Promise<void> | null = null;
      let authorizationRun: Promise<{ status: "QUEUED" }> | null = null;
      let preferenceRun: Promise<unknown> | null = null;
      try {
        await setup.whatsAppMessage.update({
          where: { id: fixture.messageId },
          data: {
            status: "FAILED",
            errorCode: "PREVIOUS_FAILURE",
            errorReason: "Falha anterior preparada pelo teste.",
          },
        });
        holderRun = holder.$transaction(
          async (tx) => {
            await tx.$queryRaw`
              SELECT "id"
              FROM "WhatsAppMessage"
              WHERE "id" = ${fixture.messageId}::uuid
                AND "organizationId" = ${fixture.organizationId}::uuid
              FOR UPDATE
            `;
            messageLocked.open();
            await releaseMessage.promise;
          },
          { timeout: 15_000 },
        );
        await withTimeout(messageLocked.promise, "the message lock");

        authorizationRun = new CommunicationsMessageService(
          authorizationPrisma,
        ).authorizeManualResend(
          fixture.organizationId,
          fixture.messageId,
          fixture.userId,
          `opt-out-wins-${suffix}`,
        );
        await waitForBlockedApplication(observer, `pr484-auth-${suffix}`);

        let preferenceCompleted = false;
        preferenceRun = new CommunicationsMessageService(preferencePrisma)
          .preference(
            fixture.organizationId,
            fixture.patientId,
            fixture.userId,
            { whatsappOptIn: false, source: "POSTGRES_CONCURRENCY_TEST" },
          )
          .then((result) => {
            preferenceCompleted = true;
            return result;
          });

        await waitForCompletionOrBlock(
          observer,
          `pr484-pref-${suffix}`,
          () => preferenceCompleted,
        );
        expect(preferenceCompleted).toBe(false);

        releaseMessage.open();
        await withTimeout(holderRun, "message lock holder to finish");
        await withTimeout(authorizationRun, "manual authorization");
        await withTimeout(preferenceRun, "opt-out to commit");

        const manualAttempts = await setup.whatsAppMessageAttempt.findMany({
          where: { messageId: fixture.messageId, origin: "MANUAL" },
        });
        expect(manualAttempts).toHaveLength(1);
        expect(manualAttempts[0]?.completedAt).toBeInstanceOf(Date);
        expect(
          await setup.whatsAppMessage.findUniqueOrThrow({
            where: { id: fixture.messageId },
            select: { status: true, leaseUntil: true },
          }),
        ).toEqual({ status: "FAILED", leaseUntil: null });
      } finally {
        releaseMessage.open();
        const pending: Promise<unknown>[] = [];
        if (holderRun) pending.push(holderRun);
        if (authorizationRun) pending.push(authorizationRun);
        if (preferenceRun) pending.push(preferenceRun);
        await Promise.allSettled(pending);
        await removeFixture(setup, fixture);
        await Promise.all([
          setup.$disconnect(),
          holder.$disconnect(),
          authorizationPrisma.$disconnect(),
          preferencePrisma.$disconnect(),
          observer.$disconnect(),
        ]);
      }
    },
    20_000,
  );

  postgresTest(
    "cancels the reserved resend when opt-out starts after eligibility is locked",
    async () => {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
      const triggerName = `pr484_manual_gate_${suffix}`;
      const functionName = `pr484_manual_gate_fn_${suffix}`;
      const advisoryKey = 297_003;
      const setup = createPrismaClient(databaseUrl as string);
      const blocker = createPrismaClient(
        namedDatabaseUrl(`pr484-blocker-${suffix}`),
      );
      const authorizationPrisma = createPrismaClient(
        namedDatabaseUrl(`pr484-auth-${suffix}`),
      );
      const preferencePrisma = createPrismaClient(
        namedDatabaseUrl(`pr484-pref-${suffix}`),
      );
      const observer = createPrismaClient(databaseUrl as string);
      const fixture = await createFixture(setup);
      const advisoryLocked = gate();
      const releaseAdvisory = gate();
      let blockerRun: Promise<void> | null = null;
      let authorizationRun: Promise<{ status: "QUEUED" }> | null = null;
      let preferenceRun: Promise<unknown> | null = null;
      let preferenceSettled = false;
      try {
        await setup.whatsAppMessage.update({
          where: { id: fixture.messageId },
          data: {
            status: "FAILED",
            errorCode: "PREVIOUS_FAILURE",
            errorReason: "Falha anterior preparada pelo teste.",
          },
        });
        await setup.$executeRawUnsafe(`
          CREATE FUNCTION "${functionName}"()
          RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW."origin"::text = 'MANUAL' THEN
              PERFORM pg_advisory_xact_lock(${advisoryKey});
            END IF;
            RETURN NEW;
          END;
          $$
        `);
        await setup.$executeRawUnsafe(`
          CREATE TRIGGER "${triggerName}"
          BEFORE INSERT ON "WhatsAppMessageAttempt"
          FOR EACH ROW
          EXECUTE FUNCTION "${functionName}"()
        `);

        blockerRun = blocker.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryKey})`;
            advisoryLocked.open();
            await releaseAdvisory.promise;
          },
          { timeout: 15_000 },
        );
        await withTimeout(advisoryLocked.promise, "the advisory test gate");

        authorizationRun = new CommunicationsMessageService(
          authorizationPrisma,
        ).authorizeManualResend(
          fixture.organizationId,
          fixture.messageId,
          fixture.userId,
          `authorization-wins-${suffix}`,
        );
        await waitForBlockedApplication(observer, `pr484-auth-${suffix}`);

        preferenceRun = new CommunicationsMessageService(preferencePrisma)
          .preference(
            fixture.organizationId,
            fixture.patientId,
            fixture.userId,
            { whatsappOptIn: false, source: "POSTGRES_CONCURRENCY_TEST" },
          )
          .finally(() => {
            preferenceSettled = true;
          });
        await waitForCompletionOrBlock(
          observer,
          `pr484-pref-${suffix}`,
          () => preferenceSettled,
        );
        releaseAdvisory.open();
        expect(
          await withTimeout(authorizationRun, "manual authorization to finish"),
        ).toEqual({ status: "QUEUED" });
        await withTimeout(preferenceRun, "opt-out to finish");
        await withTimeout(blockerRun, "advisory lock holder to finish");

        const [message, preference, attempts] = await Promise.all([
          setup.whatsAppMessage.findUniqueOrThrow({
            where: { id: fixture.messageId },
          }),
          setup.whatsAppPreference.findUniqueOrThrow({
            where: { patientId: fixture.patientId },
          }),
          setup.whatsAppMessageAttempt.findMany({
            where: { messageId: fixture.messageId, origin: "MANUAL" },
          }),
        ]);
        expect(preference.optedIn).toBe(false);
        expect(message).toMatchObject({
          status: "FAILED",
          leaseUntil: null,
          errorCode: "OPTED_OUT",
        });
        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toMatchObject({
          dispatchedAt: null,
          providerMessageHash: null,
          errorCode: "MANUAL_RESEND_CANCELLED",
        });
        expect(attempts[0]?.completedAt).toBeInstanceOf(Date);
      } finally {
        releaseAdvisory.open();
        const pending: Promise<unknown>[] = [];
        if (blockerRun) pending.push(blockerRun);
        if (authorizationRun) pending.push(authorizationRun);
        if (preferenceRun) pending.push(preferenceRun);
        await Promise.allSettled(pending);
        await setup.$executeRawUnsafe(
          `DROP TRIGGER IF EXISTS "${triggerName}" ON "WhatsAppMessageAttempt"`,
        );
        await setup.$executeRawUnsafe(
          `DROP FUNCTION IF EXISTS "${functionName}"()`,
        );
        await removeFixture(setup, fixture);
        await Promise.all([
          setup.$disconnect(),
          blocker.$disconnect(),
          authorizationPrisma.$disconnect(),
          preferencePrisma.$disconnect(),
          observer.$disconnect(),
        ]);
      }
    },
    20_000,
  );
});
