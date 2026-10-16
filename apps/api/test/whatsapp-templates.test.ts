import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import type {
  MembershipRole,
  PrismaClient,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { communicationsModule } from "../src/modules/communications";
import type { WhatsAppTemplateType } from "../src/modules/communications/model";
import { signSessionToken } from "../src/services/session-token";
import type { WhatsAppProvider } from "../src/services/waha-client";

const secret = "whatsapp-template-test-secret";

type TemplateRow = {
  id: string;
  organizationId: string;
  type: WhatsAppTemplateType;
  content: string;
  version: number;
  approvedById: string;
  approvedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type VersionRow = {
  id: string;
  templateId: string;
  organizationId: string;
  type: WhatsAppTemplateType;
  content: string;
  version: number;
  approvedById: string;
  approvedAt: Date;
  createdAt: Date;
};

type AuditRow = {
  id: string;
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

const provider: WhatsAppProvider = {
  getSession: async () => null,
  createSession: async () => ({ status: "STOPPED", me: null }),
  restartSession: async () => {},
  getQr: async () => null,
};

function setup() {
  const templates: TemplateRow[] = [];
  const versions: VersionRow[] = [];
  const audits: AuditRow[] = [];
  let templateSequence = 0;
  let versionSequence = 0;

  const membershipByUserAndSlug = new Map<
    string,
    {
      organizationId: string;
      role: MembershipRole;
      status?: "ACTIVE" | "SUSPENDED";
    }
  >([
    ["admin-a:clinic-a", { organizationId: "org-a", role: "ADMIN" }],
    [
      "admin-prof-a:clinic-a",
      { organizationId: "org-a", role: "ADMIN_PROFESSIONAL" },
    ],
    ["reception-a:clinic-a", { organizationId: "org-a", role: "RECEPTIONIST" }],
    [
      "suspended-reception-a:clinic-a",
      {
        organizationId: "org-a",
        role: "RECEPTIONIST",
        status: "SUSPENDED",
      },
    ],
    [
      "professional-a:clinic-a",
      { organizationId: "org-a", role: "PROFESSIONAL" },
    ],
    ["admin-b:clinic-b", { organizationId: "org-b", role: "ADMIN" }],
  ]);

  const prisma = {
    session: {
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        lastActiveAt: new Date(),
      }),
    },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; organization: { slug: string } };
      }) => {
        const membership = membershipByUserAndSlug.get(
          `${where.userId}:${where.organization.slug}`,
        );
        return membership
          ? {
              id: `membership-${where.userId}`,
              ...membership,
              status: membership.status ?? ("ACTIVE" as const),
            }
          : null;
      },
    },
    whatsAppTemplate: {
      findMany: async ({ where }: { where: { organizationId: string } }) =>
        templates
          .filter((row) => row.organizationId === where.organizationId)
          .sort((left, right) => left.type.localeCompare(right.type)),
      findUnique: async ({
        where,
        select,
      }: {
        where: {
          organizationId_type: {
            organizationId: string;
            type: WhatsAppTemplateType;
          };
        };
        select?: { id: boolean };
      }) => {
        const row = templates.find(
          (item) =>
            item.organizationId === where.organizationId_type.organizationId &&
            item.type === where.organizationId_type.type,
        );
        if (!row) return null;
        return select ? { id: row.id } : row;
      },
      create: async ({
        data,
      }: {
        data: Omit<TemplateRow, "id" | "createdAt" | "updatedAt">;
      }) => {
        const createdAt = new Date();
        const row: TemplateRow = {
          id: `template-${++templateSequence}`,
          ...data,
          createdAt,
          updatedAt: createdAt,
        };
        templates.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id: string;
          organizationId: string;
          type: WhatsAppTemplateType;
          version: number;
        };
        data: Partial<TemplateRow>;
      }) => {
        const row = templates.find(
          (item) =>
            item.id === where.id &&
            item.organizationId === where.organizationId &&
            item.type === where.type &&
            item.version === where.version,
        );
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    whatsAppTemplateVersion: {
      create: async ({
        data,
      }: {
        data: Omit<VersionRow, "id" | "createdAt">;
      }) => {
        const row: VersionRow = {
          id: `template-version-${++versionSequence}`,
          ...data,
          createdAt: data.approvedAt,
        };
        versions.push(row);
        return row;
      },
      findMany: async ({
        where,
      }: {
        where: { organizationId: string; templateId: string };
      }) =>
        versions
          .filter(
            (row) =>
              row.organizationId === where.organizationId &&
              row.templateId === where.templateId,
          )
          .sort((left, right) => left.version - right.version),
      findFirst: async ({
        where,
      }: {
        where: {
          organizationId: string;
          templateId: string;
          version: number;
        };
      }) =>
        versions.find(
          (row) =>
            row.organizationId === where.organizationId &&
            row.templateId === where.templateId &&
            row.version === where.version,
        ) ?? null,
    },
    auditLog: {
      create: async ({
        data,
      }: {
        data: Omit<AuditRow, "id" | "createdAt">;
      }) => {
        const row: AuditRow = {
          id: `audit-${audits.length + 1}`,
          ...data,
          createdAt: new Date(),
        };
        audits.push(row);
        return row;
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(prisma),
  } as unknown as PrismaClient;

  const app = new Elysia()
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
      if (code === "VALIDATION" || code === "PARSE") {
        return status(400, {
          error: { code: "VALIDATION_ERROR", message: "Dados inválidos." },
        });
      }
      return status(500, {
        error: { code: "INTERNAL", message: "Erro interno." },
      });
    })
    .use(communicationsModule({ prisma, jwtSecret: secret, provider }));

  const request = (
    userId: string | null,
    path: string,
    method = "GET",
    body?: unknown,
  ) =>
    app.handle(
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          ...(userId
            ? {
                authorization: `Bearer ${signSessionToken(
                  { sub: userId, sid: `session-${userId}` },
                  secret,
                  3_600,
                )}`,
              }
            : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );

  return { audits, request, templates, versions };
}

const basePath = "/organizations/clinic-a/communications/whatsapp/templates";

describe("organization WhatsApp templates", () => {
  test("persists all three supported types for the active organization", async () => {
    const { request } = setup();
    const cases: Array<[WhatsAppTemplateType, string]> = [
      [
        "APPOINTMENT_CONFIRMATION",
        "Olá, {paciente_nome}. Consulta em {data} às {hora} com {medico_nome} na {clinica_nome}.",
      ],
      [
        "APPOINTMENT_CANCELLATION",
        "Olá, {paciente_nome}. A consulta de {data} às {hora} na {clinica_nome} foi cancelada.",
      ],
      [
        "APPOINTMENT_REMINDER_24H",
        "Lembrete para {paciente_nome}: consulta em {data} às {hora} com {medico_nome} na {clinica_nome}.",
      ],
    ];

    for (const [type, content] of cases) {
      const response = await request("admin-a", `${basePath}/${type}`, "PUT", {
        content,
        version: 0,
      });
      expect(response.status).toBe(200);
      expect(
        (await response.json()) as { type: string; version: number },
      ).toMatchObject({
        type,
        version: 1,
      });
    }

    const response = await request("admin-a", basePath);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ type: string }> };
    expect(body.data.map((item) => item.type).sort()).toEqual(
      cases.map(([type]) => type).sort(),
    );
  });

  test("keeps immutable versions and audits changes without copying content", async () => {
    const { audits, request } = setup();
    const original =
      "Olá, {paciente_nome}. Consulta em {data} às {hora} na {clinica_nome}.";
    const updated =
      "{paciente_nome}, confirmamos sua consulta em {data} às {hora}.";

    const created = await request(
      "admin-a",
      `${basePath}/APPOINTMENT_CONFIRMATION`,
      "PUT",
      { content: original, version: 0 },
    );
    expect(created.status).toBe(200);

    const changed = await request(
      "admin-a",
      `${basePath}/APPOINTMENT_CONFIRMATION`,
      "PUT",
      { content: updated, version: 1 },
    );
    expect(changed.status).toBe(200);
    expect((await changed.json()) as { version: number }).toMatchObject({
      version: 2,
    });

    const history = await request(
      "admin-a",
      `${basePath}/APPOINTMENT_CONFIRMATION/versions`,
    );
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as {
      data: Array<{ content: string; version: number }>;
    };
    expect(historyBody.data.map((item) => item.version)).toEqual([1, 2]);
    expect(historyBody.data[0]?.content).toBe(original);
    expect(historyBody.data[1]?.content).toBe(updated);

    const firstVersion = await request(
      "admin-a",
      `${basePath}/APPOINTMENT_CONFIRMATION/versions/1`,
    );
    expect(firstVersion.status).toBe(200);
    expect((await firstVersion.json()) as { content: string }).toMatchObject({
      content: original,
    });

    expect(audits.map((event) => event.action)).toEqual([
      "WHATSAPP_TEMPLATE_CREATED",
      "WHATSAPP_TEMPLATE_UPDATED",
    ]);
    expect(audits.every((event) => event.organizationId === "org-a")).toBe(
      true,
    );
    expect(
      audits.every(
        (event) =>
          !("content" in event.metadata) &&
          !JSON.stringify(event.metadata).includes(original) &&
          !JSON.stringify(event.metadata).includes(updated),
      ),
    ).toBe(true);
  });

  test("renders previews only with fixed fictional values and does not persist", async () => {
    const { audits, request, templates, versions } = setup();
    const response = await request(
      "admin-a",
      `${basePath}/APPOINTMENT_REMINDER_24H/preview`,
      "POST",
      {
        content:
          "Olá, {paciente_nome}. Consulta em {data} às {hora} com {medico_nome} na {clinica_nome}.",
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      isExample: true,
      type: "APPOINTMENT_REMINDER_24H",
      content:
        "Olá, Maria da Silva. Consulta em 20/10/2026 às 14:30 com Dra. Ana Oliveira na Clínica Exemplo.",
      variables: {
        paciente_nome: "Maria da Silva",
        data: "20/10/2026",
        hora: "14:30",
        medico_nome: "Dra. Ana Oliveira",
        clinica_nome: "Clínica Exemplo",
      },
      maxLength: 4096,
    });
    expect(templates).toHaveLength(0);
    expect(versions).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  test("rejects structurally or semantically invalid content without writes", async () => {
    const { audits, request, templates, versions } = setup();

    const empty = await request(
      "admin-a",
      `${basePath}/APPOINTMENT_CONFIRMATION`,
      "PUT",
      { content: "", version: 0 },
    );
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    const unknown = await request(
      "admin-a",
      `${basePath}/APPOINTMENT_CONFIRMATION`,
      "PUT",
      { content: "Use {medicamento}.", version: 0 },
    );
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toMatchObject({
      error: {
        code: "INVALID_TEMPLATE_VARIABLE",
        details: { invalidVariables: ["medicamento"] },
      },
    });

    const incompatible = await request(
      "admin-a",
      `${basePath}/APPOINTMENT_CANCELLATION`,
      "PUT",
      { content: "Cancelada com {medico_nome}.", version: 0 },
    );
    expect(incompatible.status).toBe(422);
    expect(await incompatible.json()).toMatchObject({
      error: {
        code: "INVALID_TEMPLATE_VARIABLE",
        details: { invalidVariables: ["medico_nome"] },
      },
    });

    const malformed = await request(
      "admin-a",
      `${basePath}/APPOINTMENT_CONFIRMATION`,
      "PUT",
      { content: "Olá, {paciente_nome.", version: 0 },
    );
    expect(malformed.status).toBe(422);
    expect(await malformed.json()).toMatchObject({
      error: { code: "INVALID_TEMPLATE_STRUCTURE" },
    });

    const oversized = await request(
      "admin-a",
      `${basePath}/APPOINTMENT_CONFIRMATION`,
      "PUT",
      { content: "a".repeat(4_097), version: 0 },
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    expect(templates).toHaveLength(0);
    expect(versions).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  test("rejects invalid historical versions through the HTTP handler", async () => {
    const { request } = setup();

    for (const version of ["1.5", "0", "-1", "abc", "2147483648"]) {
      const response = await request(
        "admin-a",
        `${basePath}/APPOINTMENT_CONFIRMATION/versions/${version}`,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }

    const maximumInt = await request(
      "admin-a",
      `${basePath}/APPOINTMENT_CONFIRMATION/versions/2147483647`,
    );
    expect(maximumInt.status).toBe(404);
  });

  test("allows communications operators and rejects unauthorized access", async () => {
    const { audits, request } = setup();
    const original = "Consulta fictícia em {data} às {hora}.";
    const updated = "Consulta fictícia atualizada em {data} às {hora}.";

    const created = await request(
      "reception-a",
      `${basePath}/APPOINTMENT_CONFIRMATION`,
      "PUT",
      { content: original, version: 0 },
    );
    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({
      content: original,
      version: 1,
      approvedById: "reception-a",
      approvedAt: expect.any(String),
    });

    const changed = await request(
      "reception-a",
      `${basePath}/APPOINTMENT_CONFIRMATION`,
      "PUT",
      { content: updated, version: 1 },
    );
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({
      content: updated,
      version: 2,
      approvedById: "reception-a",
    });

    const read = await request("reception-a", basePath);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      data: [{ content: updated, version: 2 }],
    });

    const history = await request(
      "reception-a",
      `${basePath}/APPOINTMENT_CONFIRMATION/versions`,
    );
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({
      data: [
        { content: original, version: 1, approvedById: "reception-a" },
        { content: updated, version: 2, approvedById: "reception-a" },
      ],
    });

    const historicalVersion = await request(
      "reception-a",
      `${basePath}/APPOINTMENT_CONFIRMATION/versions/1`,
    );
    expect(historicalVersion.status).toBe(200);
    expect(await historicalVersion.json()).toMatchObject({
      content: original,
      version: 1,
      approvedById: "reception-a",
    });

    const preview = await request(
      "reception-a",
      `${basePath}/APPOINTMENT_CONFIRMATION/preview`,
      "POST",
      { content: "Olá, {paciente_nome}. Consulta em {data} às {hora}." },
    );
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      isExample: true,
      content: "Olá, Maria da Silva. Consulta em 20/10/2026 às 14:30.",
    });

    expect(audits).toHaveLength(2);
    expect(
      audits.every(
        (event) =>
          event.actorUserId === "reception-a" &&
          event.organizationId === "org-a" &&
          event.metadata.approvalMethod === "SAVE_AND_ACTIVATE" &&
          typeof event.metadata.approvedAt === "string",
      ),
    ).toBe(true);

    for (const userId of ["professional-a"]) {
      const read = await request(userId, basePath);
      expect(read.status).toBe(403);
      expect(await read.json()).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });

      const write = await request(
        userId,
        `${basePath}/APPOINTMENT_CONFIRMATION`,
        "PUT",
        { content: "Consulta em {data} às {hora}.", version: 0 },
      );
      expect(write.status).toBe(403);

      const history = await request(
        userId,
        `${basePath}/APPOINTMENT_CONFIRMATION/versions`,
      );
      expect(history.status).toBe(403);

      const historicalVersion = await request(
        userId,
        `${basePath}/APPOINTMENT_CONFIRMATION/versions/1`,
      );
      expect(historicalVersion.status).toBe(403);

      const preview = await request(
        userId,
        `${basePath}/APPOINTMENT_CONFIRMATION/preview`,
        "POST",
        { content: "Consulta em {data} às {hora}." },
      );
      expect(preview.status).toBe(403);
    }

    const receptionistReconnect = await request(
      "reception-a",
      "/organizations/clinic-a/communications/whatsapp/reconnect",
      "POST",
    );
    expect(receptionistReconnect.status).toBe(403);

    const suspended = await request("suspended-reception-a", basePath);
    expect(suspended.status).toBe(403);
    expect(await suspended.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });

    const foreignOrganization = await request(
      "reception-a",
      "/organizations/clinic-b/communications/whatsapp/templates",
    );
    expect(foreignOrganization.status).toBe(404);

    const admin = await request("admin-a", basePath);
    expect(admin.status).toBe(200);
    const adminProfessional = await request("admin-prof-a", basePath);
    expect(adminProfessional.status).toBe(200);
    const adminProfessionalWrite = await request(
      "admin-prof-a",
      `${basePath}/APPOINTMENT_CANCELLATION`,
      "PUT",
      {
        content: "Cancelamento fictício em {data} às {hora}.",
        version: 0,
      },
    );
    expect(adminProfessionalWrite.status).toBe(200);

    const unauthenticated = await request(null, basePath);
    expect(unauthenticated.status).toBe(401);
  });

  test("isolates organizations and enforces optimistic version checks", async () => {
    const { request } = setup();
    const type = "APPOINTMENT_CONFIRMATION";
    const first = await request("admin-a", `${basePath}/${type}`, "PUT", {
      content: "Clínica A: consulta em {data} às {hora}.",
      version: 0,
    });
    expect(first.status).toBe(200);

    const foreignList = await request(
      "admin-b",
      "/organizations/clinic-b/communications/whatsapp/templates",
    );
    expect(await foreignList.json()).toEqual({ data: [] });

    const foreignHistory = await request(
      "admin-b",
      `/organizations/clinic-b/communications/whatsapp/templates/${type}/versions`,
    );
    expect(foreignHistory.status).toBe(404);

    const wrongClinic = await request(
      "admin-a",
      "/organizations/clinic-b/communications/whatsapp/templates",
    );
    expect(wrongClinic.status).toBe(404);

    const stale = await request("admin-a", `${basePath}/${type}`, "PUT", {
      content: "Tentativa concorrente em {data} às {hora}.",
      version: 0,
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: {
        code: "VERSION_CONFLICT",
        details: { expectedVersion: 0, currentVersion: 1 },
      },
    });

    const clinicBSave = await request(
      "admin-b",
      `/organizations/clinic-b/communications/whatsapp/templates/${type}`,
      "PUT",
      {
        content: "Clínica B: consulta em {data} às {hora}.",
        version: 0,
      },
    );
    expect(clinicBSave.status).toBe(200);

    const clinicAList = await request("admin-a", basePath);
    const clinicBList = await request(
      "admin-b",
      "/organizations/clinic-b/communications/whatsapp/templates",
    );
    expect(await clinicAList.json()).toMatchObject({
      data: [{ content: "Clínica A: consulta em {data} às {hora}." }],
    });
    expect(await clinicBList.json()).toMatchObject({
      data: [{ content: "Clínica B: consulta em {data} às {hora}." }],
    });
  });
});
