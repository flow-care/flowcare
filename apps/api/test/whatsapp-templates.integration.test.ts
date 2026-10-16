import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import type { WhatsAppTemplateType } from "../src/modules/communications/model";
import { CommunicationsService } from "../src/modules/communications/service";
import { createPrismaClient } from "../src/services/db";
import type { Mailer } from "../src/services/mailer";
import { signSessionToken } from "../src/services/session-token";
import type { WhatsAppProvider } from "../src/services/waha-client";

const TEST_DATABASE_HOST = "localhost";
const TEST_DATABASE_PORT = "5432";
const TEST_DATABASE_NAME = "flowcare_test_298";
const JWT_SECRET = "whatsapp-template-298-integration-secret";

function requireSafeTestDatabaseUrl(value: string): string {
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const validProtocol =
    url.protocol === "postgresql:" || url.protocol === "postgres:";

  if (
    !validProtocol ||
    url.hostname !== TEST_DATABASE_HOST ||
    url.port !== TEST_DATABASE_PORT ||
    databaseName !== TEST_DATABASE_NAME ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "Integration tests refused the connection: TEST_DATABASE_URL must target exactly localhost:5432/flowcare_test_298 without URL overrides.",
    );
  }

  return url.toString();
}

const configuredDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseUrl = configuredDatabaseUrl
  ? requireSafeTestDatabaseUrl(configuredDatabaseUrl)
  : null;
const integrationEnabled = databaseUrl !== null;

let prisma!: PrismaClient;
let app!: ReturnType<typeof createApp>;

const mailer: Mailer = { send: async () => {} };
const whatsappProvider: WhatsAppProvider = {
  getSession: async () => null,
  createSession: async () => ({ status: "STOPPED", me: null }),
  restartSession: async () => {},
  getQr: async () => null,
};

if (databaseUrl) {
  prisma = createPrismaClient(databaseUrl);
  const result = await prisma.$queryRaw<Array<{ databaseName: string }>>`
    SELECT current_database() AS "databaseName"
  `;
  if (result[0]?.databaseName !== TEST_DATABASE_NAME) {
    await prisma.$disconnect();
    throw new Error("Integration tests refused an unexpected database.");
  }

  const env: Env = {
    port: 0,
    nodeEnv: "test",
    version: "integration-test",
    jwtSecret: JWT_SECRET,
    databaseUrl,
    corsOrigin: "http://localhost:3000",
    trustProxy: false,
    wahaBaseUrl: "http://127.0.0.1:1",
    wahaApiKey: null,
    webAppUrl: "http://localhost:3000",
    mailProvider: "disabled",
    sesRegion: null,
    mailFrom: null,
  };

  app = createApp(env, {
    prisma,
    mailer,
    profilePhotoStore: null,
    attachmentStore: null,
    consultationAudioStore: null,
    transcriptionProvider: null,
    whatsappProvider,
    documentPdfService: null,
  });
}

const runId = crypto.randomUUID();
const compactRunId = runId.replaceAll("-", "");
const ids = {
  adminA: crypto.randomUUID(),
  receptionistA: crypto.randomUUID(),
  adminB: crypto.randomUUID(),
  organizationA: crypto.randomUUID(),
  organizationB: crypto.randomUUID(),
  sessionAdminA: crypto.randomUUID(),
  sessionReceptionistA: crypto.randomUUID(),
  sessionAdminB: crypto.randomUUID(),
};
const slugs = {
  organizationA: `whatsapp-298-a-${compactRunId}`,
  organizationB: `whatsapp-298-b-${compactRunId}`,
};
const organizationIds = [ids.organizationA, ids.organizationB];
const userIds = [ids.adminA, ids.receptionistA, ids.adminB];
const tokens = {
  adminA: signSessionToken(
    { sub: ids.adminA, sid: ids.sessionAdminA },
    JWT_SECRET,
    3_600,
  ),
  receptionistA: signSessionToken(
    { sub: ids.receptionistA, sid: ids.sessionReceptionistA },
    JWT_SECRET,
    3_600,
  ),
  adminB: signSessionToken(
    { sub: ids.adminB, sid: ids.sessionAdminB },
    JWT_SECRET,
    3_600,
  ),
};

type Actor = keyof typeof tokens;

function request(
  actor: Actor | null,
  path: string,
  method = "GET",
  body?: unknown,
) {
  return app.handle(
    new Request(`http://localhost/api${path}`, {
      method,
      headers: {
        ...(actor ? { authorization: `Bearer ${tokens[actor]}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

function templatesPath(slug: string) {
  return `/organizations/${slug}/communications/whatsapp/templates`;
}

async function saveTemplate(
  actor: Actor,
  slug: string,
  type: WhatsAppTemplateType,
  content: string,
  version: number,
) {
  return request(actor, `${templatesPath(slug)}/${type}`, "PUT", {
    content,
    version,
  });
}

describe.skipIf(!integrationEnabled)(
  "#298 WhatsApp templates integration (local PostgreSQL)",
  () => {
    beforeAll(async () => {
      await prisma.user.createMany({
        data: [
          {
            id: ids.adminA,
            email: `admin-a-${runId}@example.test`,
            fullName: "Administradora Exemplo A",
            passwordHash: "integration-test-only",
            emailVerified: true,
          },
          {
            id: ids.receptionistA,
            email: `receptionist-a-${runId}@example.test`,
            fullName: "Recepcionista Exemplo A",
            passwordHash: "integration-test-only",
            emailVerified: true,
          },
          {
            id: ids.adminB,
            email: `admin-b-${runId}@example.test`,
            fullName: "Administrador Exemplo B",
            passwordHash: "integration-test-only",
            emailVerified: true,
          },
        ],
      });

      await prisma.organization.createMany({
        data: [
          {
            id: ids.organizationA,
            name: "Clinica Ficticia A",
            slug: slugs.organizationA,
            ownerId: ids.adminA,
          },
          {
            id: ids.organizationB,
            name: "Clinica Ficticia B",
            slug: slugs.organizationB,
            ownerId: ids.adminB,
          },
        ],
      });

      await prisma.membership.createMany({
        data: [
          {
            userId: ids.adminA,
            organizationId: ids.organizationA,
            role: "ADMIN",
          },
          {
            userId: ids.receptionistA,
            organizationId: ids.organizationA,
            role: "RECEPTIONIST",
          },
          {
            userId: ids.adminB,
            organizationId: ids.organizationB,
            role: "ADMIN",
          },
        ],
      });

      await prisma.session.createMany({
        data: [
          {
            id: ids.sessionAdminA,
            userId: ids.adminA,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
          {
            id: ids.sessionReceptionistA,
            userId: ids.receptionistA,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
          {
            id: ids.sessionAdminB,
            userId: ids.adminB,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        ],
      });
    });

    beforeEach(async () => {
      await prisma.whatsAppTemplate.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.auditLog.deleteMany({
        where: {
          organizationId: { in: organizationIds },
          targetType: "WHATSAPP_TEMPLATE",
        },
      });
    });

    afterAll(async () => {
      try {
        await prisma.organization.deleteMany({
          where: { id: { in: organizationIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      } finally {
        await prisma.$disconnect();
      }
    });

    test("persists all MVP types and keeps immutable versions", async () => {
      const confirmationV1 =
        "Ola, {paciente_nome}. Consulta em {data} as {hora} com {medico_nome} na {clinica_nome}.";
      const confirmationV2 =
        "Confirmacao ficticia: {paciente_nome}, esperamos voce em {data} as {hora}.";
      const cases: Array<[WhatsAppTemplateType, string]> = [
        ["APPOINTMENT_CONFIRMATION", confirmationV1],
        [
          "APPOINTMENT_CANCELLATION",
          "Ola, {paciente_nome}. Sua consulta de {data} as {hora} na {clinica_nome} foi cancelada.",
        ],
        [
          "APPOINTMENT_REMINDER_24H",
          "Lembrete ficticio para {paciente_nome}: consulta em {data} as {hora} com {medico_nome} na {clinica_nome}.",
        ],
      ];

      for (const [type, content] of cases) {
        const response = await saveTemplate(
          "adminA",
          slugs.organizationA,
          type,
          content,
          0,
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ type, version: 1 });
      }

      const updated = await saveTemplate(
        "adminA",
        slugs.organizationA,
        "APPOINTMENT_CONFIRMATION",
        confirmationV2,
        1,
      );
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ version: 2 });

      const persisted = await prisma.whatsAppTemplate.findMany({
        where: { organizationId: ids.organizationA },
        include: { versions: { orderBy: { version: "asc" } } },
      });
      expect(persisted).toHaveLength(3);
      const confirmation = persisted.find(
        (item) => item.type === "APPOINTMENT_CONFIRMATION",
      );
      expect(confirmation).toMatchObject({
        content: confirmationV2,
        version: 2,
        approvedById: ids.adminA,
      });
      expect(
        confirmation?.versions.map((item) => ({
          content: item.content,
          version: item.version,
        })),
      ).toEqual([
        { content: confirmationV1, version: 1 },
        { content: confirmationV2, version: 2 },
      ]);

      const history = await request(
        "adminA",
        `${templatesPath(slugs.organizationA)}/APPOINTMENT_CONFIRMATION/versions`,
      );
      expect(history.status).toBe(200);
      expect(
        (
          (await history.json()) as {
            data: Array<{ version: number }>;
          }
        ).data.map((item) => item.version),
      ).toEqual([1, 2]);

      const original = await request(
        "adminA",
        `${templatesPath(slugs.organizationA)}/APPOINTMENT_CONFIRMATION/versions/1`,
      );
      expect(original.status).toBe(200);
      expect(await original.json()).toMatchObject({
        content: confirmationV1,
        version: 1,
      });
    });

    test("isolates current templates and history between organizations", async () => {
      const type: WhatsAppTemplateType = "APPOINTMENT_CONFIRMATION";
      const clinicAContent =
        "Clinica Ficticia A: consulta em {data} as {hora}.";
      const clinicBContent =
        "Clinica Ficticia B: consulta em {data} as {hora}.";

      expect(
        (
          await saveTemplate(
            "adminA",
            slugs.organizationA,
            type,
            clinicAContent,
            0,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await saveTemplate(
            "adminB",
            slugs.organizationB,
            type,
            clinicBContent,
            0,
          )
        ).status,
      ).toBe(200);

      const clinicBList = await request(
        "adminB",
        templatesPath(slugs.organizationB),
      );
      expect(clinicBList.status).toBe(200);
      expect(await clinicBList.json()).toMatchObject({
        data: [{ type, content: clinicBContent, version: 1 }],
      });

      const persisted = await prisma.whatsAppTemplate.findMany({
        where: { type },
        select: { organizationId: true, content: true },
        orderBy: { organizationId: "asc" },
      });
      expect(persisted).toHaveLength(2);
      expect(
        new Map(persisted.map((item) => [item.organizationId, item.content])),
      ).toEqual(
        new Map([
          [ids.organizationA, clinicAContent],
          [ids.organizationB, clinicBContent],
        ]),
      );

      const crossOrganization = await request(
        "adminA",
        templatesPath(slugs.organizationB),
      );
      expect(crossOrganization.status).toBe(404);

      const clinicBHistory = await request(
        "adminB",
        `${templatesPath(slugs.organizationB)}/${type}/versions`,
      );
      expect(clinicBHistory.status).toBe(200);
      expect(await clinicBHistory.json()).toMatchObject({
        data: [{ content: clinicBContent, version: 1 }],
      });
    });

    test("allows only one of two concurrent updates from the same version", async () => {
      const type: WhatsAppTemplateType = "APPOINTMENT_CONFIRMATION";
      const original = "Consulta ficticia em {data} as {hora}.";
      const firstCandidate =
        "Primeira atualizacao ficticia em {data} as {hora}.";
      const secondCandidate =
        "Segunda atualizacao ficticia em {data} as {hora}.";

      expect(
        (await saveTemplate("adminA", slugs.organizationA, type, original, 0))
          .status,
      ).toBe(200);

      const responses = await Promise.all([
        saveTemplate("adminA", slugs.organizationA, type, firstCandidate, 1),
        saveTemplate("adminA", slugs.organizationA, type, secondCandidate, 1),
      ]);
      expect(
        responses.map(({ status }) => status).sort((a, b) => a - b),
      ).toEqual([200, 409]);

      const current = await prisma.whatsAppTemplate.findUniqueOrThrow({
        where: {
          organizationId_type: {
            organizationId: ids.organizationA,
            type,
          },
        },
        include: { versions: { orderBy: { version: "asc" } } },
      });
      expect(current.version).toBe(2);
      expect([firstCandidate, secondCandidate]).toContain(current.content);
      expect(
        current.versions.map(({ content, version }) => ({ content, version })),
      ).toEqual([
        { content: original, version: 1 },
        { content: current.content, version: 2 },
      ]);
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId: ids.organizationA,
            targetType: "WHATSAPP_TEMPLATE",
          },
        }),
      ).toBe(2);
    });

    test("enforces administrative permissions before reading or writing", async () => {
      const basePath = templatesPath(slugs.organizationA);
      const deniedRead = await request("receptionistA", basePath);
      expect(deniedRead.status).toBe(403);
      expect(await deniedRead.json()).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });

      const deniedWrite = await saveTemplate(
        "receptionistA",
        slugs.organizationA,
        "APPOINTMENT_CONFIRMATION",
        "Consulta ficticia em {data} as {hora}.",
        0,
      );
      expect(deniedWrite.status).toBe(403);

      const deniedHistory = await request(
        "receptionistA",
        `${basePath}/APPOINTMENT_CONFIRMATION/versions`,
      );
      expect(deniedHistory.status).toBe(403);

      const deniedHistoricalVersion = await request(
        "receptionistA",
        `${basePath}/APPOINTMENT_CONFIRMATION/versions/1`,
      );
      expect(deniedHistoricalVersion.status).toBe(403);

      const deniedPreview = await request(
        "receptionistA",
        `${basePath}/APPOINTMENT_CONFIRMATION/preview`,
        "POST",
        { content: "Consulta ficticia em {data} as {hora}." },
      );
      expect(deniedPreview.status).toBe(403);

      const unauthenticated = await request(null, basePath);
      expect(unauthenticated.status).toBe(401);
      expect(
        await prisma.whatsAppTemplate.count({
          where: { organizationId: ids.organizationA },
        }),
      ).toBe(0);
    });

    test("records sanitized audit events in the owning organization", async () => {
      const original =
        "Mensagem ficticia para {paciente_nome} em {data} as {hora}.";
      const changed =
        "Mensagem ficticia revisada para {paciente_nome} em {data}.";

      expect(
        (
          await saveTemplate(
            "adminA",
            slugs.organizationA,
            "APPOINTMENT_CONFIRMATION",
            original,
            0,
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await saveTemplate(
            "adminA",
            slugs.organizationA,
            "APPOINTMENT_CONFIRMATION",
            changed,
            1,
          )
        ).status,
      ).toBe(200);

      const auditEvents = await prisma.auditLog.findMany({
        where: {
          organizationId: ids.organizationA,
          targetType: "WHATSAPP_TEMPLATE",
        },
        orderBy: { createdAt: "asc" },
      });
      expect(auditEvents.map((event) => event.action)).toEqual([
        "WHATSAPP_TEMPLATE_CREATED",
        "WHATSAPP_TEMPLATE_UPDATED",
      ]);
      expect(
        auditEvents.every(
          (event) =>
            event.actorUserId === ids.adminA &&
            !JSON.stringify(event.metadata).includes(original) &&
            !JSON.stringify(event.metadata).includes(changed) &&
            !("content" in (event.metadata as Record<string, unknown>)),
        ),
      ).toBe(true);
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId: ids.organizationB,
            targetType: "WHATSAPP_TEMPLATE",
          },
        }),
      ).toBe(0);
    });

    test("rolls back the current template and history when auditing fails", async () => {
      const type: WhatsAppTemplateType = "APPOINTMENT_CONFIRMATION";
      const original = "Consulta ficticia em {data} as {hora}.";
      const changed = "Consulta ficticia revisada em {data} as {hora}.";

      expect(
        (await saveTemplate("adminA", slugs.organizationA, type, original, 0))
          .status,
      ).toBe(200);

      const auditFailingPrisma = {
        $transaction: <T>(
          callback: (transaction: Prisma.TransactionClient) => Promise<T>,
        ) =>
          prisma.$transaction((transaction) => {
            const auditFailingTransaction = new Proxy(transaction, {
              get(target, property) {
                if (property === "auditLog") {
                  return {
                    create: async () => {
                      throw new Error("forced audit failure");
                    },
                  };
                }
                return Reflect.get(target, property, target);
              },
            }) as Prisma.TransactionClient;
            return callback(auditFailingTransaction);
          }),
      } as unknown as PrismaClient;
      const service = new CommunicationsService({
        prisma: auditFailingPrisma,
        provider: whatsappProvider,
      });

      await expect(
        service.saveTemplate(ids.organizationA, ids.adminA, type, {
          content: changed,
          version: 1,
        }),
      ).rejects.toThrow("forced audit failure");

      const persisted = await prisma.whatsAppTemplate.findUniqueOrThrow({
        where: {
          organizationId_type: {
            organizationId: ids.organizationA,
            type,
          },
        },
        include: { versions: { orderBy: { version: "asc" } } },
      });
      expect(persisted).toMatchObject({ content: original, version: 1 });
      expect(
        persisted.versions.map(({ content, version }) => ({
          content,
          version,
        })),
      ).toEqual([{ content: original, version: 1 }]);
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId: ids.organizationA,
            targetType: "WHATSAPP_TEMPLATE",
          },
        }),
      ).toBe(1);
    });

    test("previews fictional data and rejects invalid content without writes", async () => {
      const basePath = templatesPath(slugs.organizationA);
      const preview = await request(
        "adminA",
        `${basePath}/APPOINTMENT_REMINDER_24H/preview`,
        "POST",
        {
          content:
            "Ola, {paciente_nome}. Consulta em {data} as {hora} com {medico_nome} na {clinica_nome}.",
        },
      );
      expect(preview.status).toBe(200);
      expect(await preview.json()).toMatchObject({
        isExample: true,
        type: "APPOINTMENT_REMINDER_24H",
        variables: {
          paciente_nome: "Maria da Silva",
          data: "20/10/2026",
          hora: "14:30",
          medico_nome: "Dra. Ana Oliveira",
          clinica_nome: "Clínica Exemplo",
        },
      });

      const invalid = await saveTemplate(
        "adminA",
        slugs.organizationA,
        "APPOINTMENT_CANCELLATION",
        "Conteudo ficticio com {medico_nome}.",
        0,
      );
      expect(invalid.status).toBe(422);
      expect(await invalid.json()).toMatchObject({
        error: {
          code: "INVALID_TEMPLATE_VARIABLE",
          details: { invalidVariables: ["medico_nome"] },
        },
      });

      const empty = await saveTemplate(
        "adminA",
        slugs.organizationA,
        "APPOINTMENT_CONFIRMATION",
        "",
        0,
      );
      expect(empty.status).toBe(400);
      expect(await empty.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });

      const oversized = await saveTemplate(
        "adminA",
        slugs.organizationA,
        "APPOINTMENT_CONFIRMATION",
        "a".repeat(4_097),
        0,
      );
      expect(oversized.status).toBe(400);
      expect(await oversized.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });

      const [templates, versions, auditEvents] = await Promise.all([
        prisma.whatsAppTemplate.count({
          where: { organizationId: ids.organizationA },
        }),
        prisma.whatsAppTemplateVersion.count({
          where: { organizationId: ids.organizationA },
        }),
        prisma.auditLog.count({
          where: {
            organizationId: ids.organizationA,
            targetType: "WHATSAPP_TEMPLATE",
          },
        }),
      ]);
      expect({ templates, versions, auditEvents }).toEqual({
        templates: 0,
        versions: 0,
        auditEvents: 0,
      });
    });
  },
);
