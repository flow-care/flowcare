import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type {
  DocumentType,
  MembershipRole,
  MembershipStatus,
  PrismaClient,
  TemplateStatus,
} from "../src/generated/prisma/client";
import type {
  ListTemplatesResponse,
  TemplateDetailResponse,
  TemplateVariablesResponse,
  TemplateVersionsResponse,
} from "../src/modules/templates/model";
import { APPROVED_TEMPLATE_VARIABLES } from "../src/modules/templates/service";
import { signSessionToken } from "../src/services/session-token";

const secret = "templates-test-secret-key-32-chars!!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const globalTemplateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const clinicAActiveTemplateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const clinicAArchivedTemplateId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const clinicBTemplateId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

interface StoredTemplate {
  id: string;
  organizationId: string | null;
  title: string;
  type: DocumentType;
  bodyTemplate: string;
  status: TemplateStatus;
  version: number;
  archivedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredTemplateVersion {
  id: string;
  templateId: string;
  organizationId: string | null;
  version: number;
  title: string;
  type: DocumentType;
  bodyTemplate: string;
  createdById: string | null;
  createdAt: Date;
}

interface StoredAuditLog {
  id: string;
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

function createFixture() {
  let role: MembershipRole = "PROFESSIONAL";
  let membershipStatus: MembershipStatus = "ACTIVE";
  let membershipOrgSlug: string | null = "clinica-a";
  let sessionActive = true;
  let uuidSequence = 10;

  const nextUuid = () => {
    uuidSequence += 1;
    const suffix = uuidSequence.toString(16).padStart(12, "0");
    return `cccccccc-cccc-4ccc-8ccc-${suffix}`;
  };

  const seedTemplates: StoredTemplate[] = [
    {
      id: globalTemplateId,
      organizationId: null,
      title: "Receita Simples Padrão (Global)",
      type: "PRESCRIPTION",
      bodyTemplate:
        "Paciente: {paciente_nome} ({paciente_cpf}) - Dr(a). {profissional_nome}",
      status: "ACTIVE",
      version: 1,
      archivedAt: null,
      createdById: null,
      createdAt: new Date("2026-10-01T10:00:00.000Z"),
      updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    },
    {
      id: clinicAActiveTemplateId,
      organizationId: clinicAId,
      title: "Atestado 3 Dias - Clínica A",
      type: "CERTIFICATE",
      bodyTemplate:
        "Atesto para os devidos fins que {paciente_nome} esteve em atendimento na {clinica_nome} em {data_atual}.",
      status: "ACTIVE",
      version: 2,
      archivedAt: null,
      createdById: "user-1",
      createdAt: new Date("2026-10-02T10:00:00.000Z"),
      updatedAt: new Date("2026-10-05T10:00:00.000Z"),
    },
    {
      id: clinicAArchivedTemplateId,
      organizationId: clinicAId,
      title: "Atestado Antigo (Arquivado) - Clínica A",
      type: "CERTIFICATE",
      bodyTemplate: "Modelo antigo de atestado para {paciente_nome}.",
      status: "ARCHIVED",
      version: 1,
      archivedAt: new Date("2026-10-06T12:00:00.000Z"),
      createdById: "user-1",
      createdAt: new Date("2026-10-03T10:00:00.000Z"),
      updatedAt: new Date("2026-10-06T12:00:00.000Z"),
    },
    {
      id: clinicBTemplateId,
      organizationId: clinicBId,
      title: "Laudo Exclusivo - Clínica B",
      type: "REPORT",
      bodyTemplate: "Laudo da Clínica B para {paciente_nome}.",
      status: "ACTIVE",
      version: 1,
      archivedAt: null,
      createdById: "user-2",
      createdAt: new Date("2026-10-04T10:00:00.000Z"),
      updatedAt: new Date("2026-10-04T10:00:00.000Z"),
    },
  ];

  const templateVersions: StoredTemplateVersion[] = [
    {
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
      templateId: clinicAActiveTemplateId,
      organizationId: clinicAId,
      version: 1,
      title: "Atestado 1 Dia - Clínica A (v1)",
      type: "CERTIFICATE",
      bodyTemplate:
        "Atesto que {paciente_nome} compareceu à {clinica_nome} em {data_atual} (versão 1 original).",
      createdById: "user-1",
      createdAt: new Date("2026-10-02T10:00:00.000Z"),
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
      templateId: clinicAActiveTemplateId,
      organizationId: clinicAId,
      version: 2,
      title: "Atestado 3 Dias - Clínica A",
      type: "CERTIFICATE",
      bodyTemplate:
        "Atesto para os devidos fins que {paciente_nome} esteve em atendimento na {clinica_nome} em {data_atual}.",
      createdById: "user-1",
      createdAt: new Date("2026-10-05T10:00:00.000Z"),
    },
  ];

  const auditLogs: StoredAuditLog[] = [];

  const matchesWhere = (
    item: StoredTemplate,
    where: Record<string, unknown>,
  ): boolean => {
    const orClauses = where.OR as
      | Array<{ organizationId: string | null }>
      | undefined;
    if (orClauses) {
      const matchesOrg = orClauses.some(
        (clause) => item.organizationId === clause.organizationId,
      );
      if (!matchesOrg) return false;
    }
    if (
      where.organizationId !== undefined &&
      item.organizationId !== where.organizationId
    ) {
      return false;
    }
    if (where.id && item.id !== where.id) return false;
    if (where.status && item.status !== where.status) return false;
    if (where.type && item.type !== where.type) return false;
    if (where.version !== undefined && item.version !== where.version)
      return false;
    if (where.title && typeof where.title === "object") {
      const contains = (where.title as { contains?: string }).contains;
      if (
        contains &&
        !item.title.toLowerCase().includes(contains.toLowerCase())
      ) {
        return false;
      }
    }
    return true;
  };

  const prisma = {
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn(prisma),
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
    documentTemplate: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const found = seedTemplates.find((item) => matchesWhere(item, where));
        return found ? { ...found } : null;
      },
      findMany: async ({
        where,
        take,
        cursor,
        skip,
      }: {
        where: Record<string, unknown>;
        take: number;
        cursor?: { id: string };
        skip?: number;
      }) => {
        const filtered = seedTemplates
          .filter((item) => matchesWhere(item, where))
          .sort(
            (a, b) =>
              a.createdAt.getTime() - b.createdAt.getTime() ||
              a.id.localeCompare(b.id),
          );

        let startIndex = 0;
        if (cursor?.id) {
          const idx = filtered.findIndex((item) => item.id === cursor.id);
          startIndex = idx >= 0 ? idx + (skip ?? 0) : filtered.length;
        }
        return filtered.slice(startIndex, startIndex + take);
      },
      create: async ({
        data,
      }: {
        data: {
          organizationId: string | null;
          title: string;
          type: DocumentType;
          bodyTemplate: string;
          status: TemplateStatus;
          version: number;
          createdById?: string | null;
        };
      }) => {
        const now = new Date();
        const created: StoredTemplate = {
          id: nextUuid(),
          organizationId: data.organizationId,
          title: data.title,
          type: data.type,
          bodyTemplate: data.bodyTemplate,
          status: data.status,
          version: data.version,
          archivedAt: null,
          createdById: data.createdById ?? null,
          createdAt: now,
          updatedAt: now,
        };
        seedTemplates.push(created);
        return { ...created };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<StoredTemplate>;
      }) => {
        let count = 0;
        for (const item of seedTemplates) {
          if (matchesWhere(item, where)) {
            if (data.status !== undefined) item.status = data.status;
            if (data.archivedAt !== undefined)
              item.archivedAt = data.archivedAt;
            if (data.title !== undefined) item.title = data.title;
            if (data.type !== undefined) item.type = data.type;
            if (data.bodyTemplate !== undefined)
              item.bodyTemplate = data.bodyTemplate;
            if (data.version !== undefined) item.version = data.version;
            if (data.updatedAt !== undefined) item.updatedAt = data.updatedAt;
            if (
              (data as { archivedById?: string }).archivedById !== undefined
            ) {
              (
                item as StoredTemplate & { archivedById?: string }
              ).archivedById = (data as { archivedById: string }).archivedById;
            }
            count += 1;
          }
        }
        return { count };
      },
    },
    documentTemplateVersion: {
      findUnique: async ({
        where,
      }: {
        where: { templateId_version: { templateId: string; version: number } };
      }) => {
        const found = templateVersions.find(
          (v) =>
            v.templateId === where.templateId_version.templateId &&
            v.version === where.templateId_version.version,
        );
        return found ? { ...found } : null;
      },
      findMany: async ({ where }: { where: { templateId: string } }) => {
        return templateVersions
          .filter((v) => v.templateId === where.templateId)
          .sort((a, b) => a.version - b.version)
          .map((v) => ({ ...v }));
      },
      create: async ({
        data,
      }: {
        data: {
          templateId: string;
          organizationId: string | null;
          version: number;
          title: string;
          type: DocumentType;
          bodyTemplate: string;
          createdById?: string | null;
          createdAt?: Date;
        };
      }) => {
        const conflict = templateVersions.some(
          (v) => v.templateId === data.templateId && v.version === data.version,
        );
        if (conflict) {
          throw Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
          });
        }
        const created: StoredTemplateVersion = {
          id: nextUuid(),
          templateId: data.templateId,
          organizationId: data.organizationId,
          version: data.version,
          title: data.title,
          type: data.type,
          bodyTemplate: data.bodyTemplate,
          createdById: data.createdById ?? null,
          createdAt: data.createdAt ?? new Date(),
        };
        templateVersions.push(created);
        return { ...created };
      },
    },
    auditLog: {
      create: async ({
        data,
      }: {
        data: Omit<StoredAuditLog, "id" | "createdAt">;
      }) => {
        const entry: StoredAuditLog = {
          id: nextUuid(),
          ...data,
          createdAt: new Date(),
        };
        auditLogs.push(entry);
        return entry;
      },
    },
  } as unknown as PrismaClient;

  const env = {
    jwtSecret: secret,
    corsOrigin: "http://localhost:3000",
    wahaBaseUrl: "http://127.0.0.1:1",
    version: "test",
    webAppUrl: "http://localhost:3000",
  } as Env;

  const app = createApp(env, { prisma, mailer: {} as never });
  const token = signSessionToken(
    { sid: "session-1", sub: "user-1" },
    secret,
    3600,
  );

  const get = (path: string, authenticated = true) =>
    app.handle(
      new Request(`http://localhost/api${path}`, {
        headers: authenticated ? { authorization: `Bearer ${token}` } : {},
      }),
    );

  const send = (
    method: "POST" | "PATCH" | "PUT",
    path: string,
    body: unknown,
    authenticated = true,
  ) =>
    app.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...(authenticated ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    );

  return {
    get,
    post: (path: string, body: unknown, authenticated = true) =>
      send("POST", path, body, authenticated),
    patch: (path: string, body: unknown, authenticated = true) =>
      send("PATCH", path, body, authenticated),
    put: (path: string, body: unknown, authenticated = true) =>
      send("PUT", path, body, authenticated),
    auditLogs,
    templateCount: () => seedTemplates.length,
    templateVersions,
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

describe("templates module (#287)", () => {
  test("archives a clinic template, preserves historical versions, and audits once", async () => {
    const f = createFixture();
    const path = `/organizations/clinica-a/document-templates/${clinicAActiveTemplateId}/archive`;
    const first = await f.post(path, {});
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ archived: true });
    const second = await f.post(path, {});
    expect(second.status).toBe(200);
    expect(
      f.auditLogs.filter((log) => log.action === "TEMPLATE_ARCHIVED"),
    ).toHaveLength(1);
    expect(
      f.auditLogs.find((log) => log.action === "TEMPLATE_ARCHIVED"),
    ).toMatchObject({
      actorUserId: "user-1",
      targetId: clinicAActiveTemplateId,
    });

    const detail = await f.get(
      `/organizations/clinica-a/templates/${clinicAActiveTemplateId}`,
    );
    expect(detail.status).toBe(200);
    const archived = (await detail.json()) as TemplateDetailResponse;
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.selectable).toBe(false);
    expect(archived.archivedAt).not.toBeNull();

    const versions = await f.get(
      `/organizations/clinica-a/templates/${clinicAActiveTemplateId}/versions`,
    );
    expect(versions.status).toBe(200);
    expect(
      ((await versions.json()) as TemplateVersionsResponse).versions.map(
        (item) => item.version,
      ),
    ).toEqual([1, 2]);

    const selectable = await f.get(
      "/organizations/clinica-a/templates?selectableOnly=true",
    );
    expect(
      ((await selectable.json()) as ListTemplatesResponse).data.map(
        (item) => item.id,
      ),
    ).not.toContain(clinicAActiveTemplateId);
  });

  test("rejects archive of a global, foreign, or unauthorized template", async () => {
    const f = createFixture();
    expect(
      (
        await f.post(
          `/organizations/clinica-a/document-templates/${globalTemplateId}/archive`,
          {},
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.post(
          `/organizations/clinica-a/document-templates/${clinicBTemplateId}/archive`,
          {},
        )
      ).status,
    ).toBe(404);
    f.setRole("RECEPTIONIST");
    expect(
      (
        await f.post(
          `/organizations/clinica-a/document-templates/${clinicAActiveTemplateId}/archive`,
          {},
        )
      ).status,
    ).toBe(403);
  });

  test("previews fictitious values without persisting templates or clinical documents (#289)", async () => {
    const f = createFixture();
    const before = f.templateCount();
    const response = await f.post(
      "/organizations/clinica-a/templates/preview",
      {
        title: "Atestado de {paciente_nome}",
        type: "CERTIFICATE",
        bodyTemplate:
          "Paciente {paciente_nome} atendida em {data_atual} na {clinica_nome}.",
      },
    );
    expect(response.status).toBe(200);
    const preview = (await response.json()) as {
      content: string;
      [key: string]: unknown;
    };
    expect(preview).toMatchObject({
      isExample: true,
      watermark: "EXEMPLO — SEM VALIDADE CLÍNICA",
      title: "Atestado de Maria da Silva",
      missingPlaceholders: [],
      variables: { paciente_nome: "Maria da Silva" },
    });
    expect(preview.content).toContain("Clínica Vida & Saúde");
    expect(preview.content).not.toContain("{paciente_nome}");
    expect(f.templateCount()).toBe(before);
    expect(f.templateVersions).toHaveLength(2);
    expect(f.auditLogs).toHaveLength(0);
  });

  test("reports invalid or malformed placeholders without creating a preview (#289)", async () => {
    const f = createFixture();
    const invalid = await f.post(
      "/organizations/clinica-a/document-templates/preview",
      {
        title: "Modelo de exemplo",
        type: "REPORT",
        bodyTemplate: "Paciente: {paciente_desconhecido}",
      },
    );
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({
      error: {
        code: "INVALID_TEMPLATE_VARIABLE",
        details: { invalidVariables: ["paciente_desconhecido"] },
      },
    });
    const malformed = await f.post(
      "/organizations/clinica-a/templates/preview",
      {
        title: "Modelo de exemplo",
        type: "REPORT",
        bodyTemplate: "Paciente: {paciente_nome",
      },
    );
    expect(malformed.status).toBe(422);
    expect(f.auditLogs).toHaveLength(0);
  });

  test("requires template editing permission for previews (#289)", async () => {
    const f = createFixture();
    f.setRole("RECEPTIONIST");
    const response = await f.post(
      "/organizations/clinica-a/templates/preview",
      {
        title: "Modelo de exemplo",
        type: "REPORT",
        bodyTemplate: "Paciente: {paciente_nome}",
      },
    );
    expect(response.status).toBe(403);
    expect(f.auditLogs).toHaveLength(0);
  });

  test("lists only templates from the active clinic and authorized global templates, isolating other clinics", async () => {
    const f = createFixture();

    const resA = await f.get("/organizations/clinica-a/templates");
    expect(resA.status).toBe(200);
    const bodyA = (await resA.json()) as ListTemplatesResponse;
    expect(bodyA.data.map((item) => item.id)).toEqual([
      globalTemplateId,
      clinicAActiveTemplateId,
      clinicAArchivedTemplateId,
    ]);
    expect(bodyA.data[0]).toMatchObject({
      id: globalTemplateId,
      organizationId: null,
      scope: "GLOBAL",
      isGlobal: true,
      selectable: true,
    });
    expect(bodyA.data[1]).toMatchObject({
      id: clinicAActiveTemplateId,
      organizationId: clinicAId,
      scope: "ORGANIZATION",
      isGlobal: false,
      selectable: true,
    });
    expect(bodyA.data.some((item) => item.id === clinicBTemplateId)).toBe(
      false,
    );

    f.setMembershipOrgSlug("clinica-b");
    const resB = await f.get("/organizations/clinica-b/templates");
    expect(resB.status).toBe(200);
    const bodyB = (await resB.json()) as ListTemplatesResponse;
    expect(bodyB.data.map((item) => item.id)).toEqual([
      globalTemplateId,
      clinicBTemplateId,
    ]);
    expect(bodyB.data.some((item) => item.organizationId === clinicAId)).toBe(
      false,
    );
  });

  test("keeps archived templates visible in history with selectable=false, but excludes them from new document emission selection", async () => {
    const f = createFixture();

    // History / explicit archived query shows archived templates with selectable: false
    const archivedRes = await f.get(
      "/organizations/clinica-a/templates?status=ARCHIVED",
    );
    expect(archivedRes.status).toBe(200);
    const archivedBody = (await archivedRes.json()) as ListTemplatesResponse;
    expect(archivedBody.data).toHaveLength(1);
    expect(archivedBody.data[0]).toMatchObject({
      id: clinicAArchivedTemplateId,
      status: "ARCHIVED",
      selectable: false,
      archivedAt: "2026-10-06T12:00:00.000Z",
    });

    // Selection for new document emission (?selectableOnly=true) strictly excludes archived templates
    const selectableRes = await f.get(
      "/organizations/clinica-a/templates?selectableOnly=true",
    );
    expect(selectableRes.status).toBe(200);
    const selectableBody =
      (await selectableRes.json()) as ListTemplatesResponse;
    expect(selectableBody.data.map((item) => item.id)).toEqual([
      globalTemplateId,
      clinicAActiveTemplateId,
    ]);
    expect(
      selectableBody.data.every(
        (item) => item.status === "ACTIVE" && item.selectable === true,
      ),
    ).toBe(true);

    // ?includeArchived=false also excludes archived templates
    const activeOnlyRes = await f.get(
      "/organizations/clinica-a/templates?includeArchived=false",
    );
    expect(activeOnlyRes.status).toBe(200);
    const activeOnlyBody =
      (await activeOnlyRes.json()) as ListTemplatesResponse;
    expect(activeOnlyBody.data.map((item) => item.id)).toEqual([
      globalTemplateId,
      clinicAActiveTemplateId,
    ]);

    // Combining selectableOnly=true with status=ARCHIVED returns empty list (never leaks archived into selection)
    const conflictRes = await f.get(
      "/organizations/clinica-a/templates?selectableOnly=true&status=ARCHIVED",
    );
    expect(conflictRes.status).toBe(200);
    expect(await conflictRes.json()).toEqual({
      data: [],
      pageInfo: { nextCursor: null, hasNextPage: false },
    });
  });

  test("supports filtering by type, version, search, cursor pagination, and rejects foreign cursors", async () => {
    const f = createFixture();

    const byTypeAndVersion = await f.get(
      "/organizations/clinica-a/templates?type=CERTIFICATE&version=2",
    );
    expect(byTypeAndVersion.status).toBe(200);
    const filteredBody =
      (await byTypeAndVersion.json()) as ListTemplatesResponse;
    expect(filteredBody.data.map((item) => item.id)).toEqual([
      clinicAActiveTemplateId,
    ]);

    const bySearch = await f.get(
      "/organizations/clinica-a/templates?search=arquivado",
    );
    expect(bySearch.status).toBe(200);
    const searchBody = (await bySearch.json()) as ListTemplatesResponse;
    expect(searchBody.data.map((item) => item.id)).toEqual([
      clinicAArchivedTemplateId,
    ]);

    // Cursor pagination
    const page1 = await f.get("/organizations/clinica-a/templates?limit=1");
    expect(page1.status).toBe(200);
    const page1Body = (await page1.json()) as ListTemplatesResponse;
    expect(page1Body.data).toHaveLength(1);
    expect(page1Body.data[0]?.id).toBe(globalTemplateId);
    expect(page1Body.pageInfo).toEqual({
      nextCursor: globalTemplateId,
      hasNextPage: true,
    });

    const page2 = await f.get(
      `/organizations/clinica-a/templates?limit=1&cursor=${globalTemplateId}`,
    );
    expect(page2.status).toBe(200);
    const page2Body = (await page2.json()) as ListTemplatesResponse;
    expect(page2Body.data).toHaveLength(1);
    expect(page2Body.data[0]?.id).toBe(clinicAActiveTemplateId);
    expect(page2Body.pageInfo).toEqual({
      nextCursor: clinicAActiveTemplateId,
      hasNextPage: true,
    });

    // Foreign clinic cursor is rejected with 400 VALIDATION_ERROR
    const foreignCursor = await f.get(
      `/organizations/clinica-a/templates?cursor=${clinicBTemplateId}`,
    );
    expect(foreignCursor.status).toBe(400);
    expect(await foreignCursor.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    // Alias route /document-templates works identically
    const aliasRes = await f.get(
      "/organizations/clinica-a/document-templates?selectableOnly=true",
    );
    expect(aliasRes.status).toBe(200);
    const aliasBody = (await aliasRes.json()) as ListTemplatesResponse;
    expect(aliasBody.data.map((item) => item.id)).toEqual([
      globalTemplateId,
      clinicAActiveTemplateId,
    ]);
  });

  test("enforces RBAC permissions per role and membership state", async () => {
    const f = createFixture();

    // Unauthenticated -> 401 UNAUTHENTICATED
    const unauth = await f.get("/organizations/clinica-a/templates", false);
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });

    // Non-member -> 404 NOT_FOUND
    const nonMember = await f.get("/organizations/clinica-b/templates");
    expect(nonMember.status).toBe(404);
    expect(await nonMember.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });

    // Suspended member -> 403 MEMBERSHIP_INACTIVE
    f.setMembershipStatus("SUSPENDED");
    const suspended = await f.get("/organizations/clinica-a/templates");
    expect(suspended.status).toBe(403);
    expect(await suspended.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });
    f.setMembershipStatus("ACTIVE");

    // RECEPTIONIST -> 403 PERMISSION_DENIED
    for (const deniedRole of ["RECEPTIONIST"] as const) {
      f.setRole(deniedRole);
      const denied = await f.get("/organizations/clinica-a/templates");
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({
        error: {
          code: "PERMISSION_DENIED",
          details: { requiredPermission: "templates:read" },
        },
      });
    }

    // ADMIN (dono da clínica), PROFESSIONAL e ADMIN_PROFESSIONAL -> 200 OK
    for (const allowedRole of [
      "ADMIN",
      "PROFESSIONAL",
      "ADMIN_PROFESSIONAL",
    ] as const) {
      f.setRole(allowedRole);
      const allowed = await f.get("/organizations/clinica-a/templates");
      expect(allowed.status).toBe(200);
    }
  });

  test("returns the structured catalog of approved dynamic variables on both routes", async () => {
    const f = createFixture();

    const unauthGlobal = await f.get("/templates/variables", false);
    expect(unauthGlobal.status).toBe(401);

    const globalRes = await f.get("/templates/variables");
    expect(globalRes.status).toBe(200);
    const globalBody = (await globalRes.json()) as TemplateVariablesResponse;
    expect(globalBody).toEqual({
      data: [...APPROVED_TEMPLATE_VARIABLES],
    });

    const placeholders = globalBody.data.map((item) => item.placeholder);
    expect(placeholders).toContain("{paciente_nome}");
    expect(placeholders).toContain("{paciente_cpf}");
    expect(placeholders).toContain("{clinica_nome}");
    expect(placeholders).toContain("{profissional_nome}");
    expect(placeholders).toContain("{data_atual}");

    // Organization-scoped route also returns the catalog and enforces RBAC
    const orgRes = await f.get("/organizations/clinica-a/templates/variables");
    expect(orgRes.status).toBe(200);
    expect(await orgRes.json()).toEqual(globalBody);

    f.setRole("RECEPTIONIST");
    const deniedOrgVars = await f.get(
      "/organizations/clinica-a/templates/variables",
    );
    expect(deniedOrgVars.status).toBe(403);
    expect(await deniedOrgVars.json()).toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        details: { requiredPermission: "templates:read" },
      },
    });
  });
});

describe("templates validation, versioning, and concurrency (#288)", () => {
  test("creates a valid clinic template (v1), normalizes approved variables, and records version + audit log", async () => {
    const f = createFixture();

    const createRes = await f.post("/organizations/clinica-a/templates", {
      title: "  Solicitação de Exames Laboratoriais  ",
      type: "EXAM_REQUEST",
      bodyTemplate:
        "Solicito hemograma completo para {paciente_nome} (CPF: {paciente_cpf}) em {{data_atual}} — {profissional_nome} ({medico_crm}).",
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as TemplateDetailResponse;
    expect(created).toMatchObject({
      organizationId: clinicAId,
      scope: "ORGANIZATION",
      isGlobal: false,
      title: "Solicitação de Exames Laboratoriais",
      type: "EXAM_REQUEST",
      bodyTemplate:
        "Solicito hemograma completo para {paciente_nome} (CPF: {paciente_cpf}) em {data_atual} — {profissional_nome} ({medico_crm}).",
      status: "ACTIVE",
      version: 1,
      selectable: true,
      variables: [
        "paciente_nome",
        "paciente_cpf",
        "data_atual",
        "profissional_nome",
        "medico_crm",
      ],
    });
    expect(created.template.id).toBe(created.id);
    expect(f.auditLogs).toHaveLength(1);
    expect(f.auditLogs[0]).toMatchObject({
      organizationId: clinicAId,
      actorUserId: "user-1",
      action: "TEMPLATE_CREATED",
      targetType: "DOCUMENT_TEMPLATE",
      targetId: created.id,
    });
  });

  test("rejects invalid template structure and unapproved dynamic variables with HTTP 422", async () => {
    const f = createFixture();

    // 1. Unapproved dynamic variable in bodyTemplate -> 422 INVALID_TEMPLATE_VARIABLE
    const unapprovedVarRes = await f.post(
      "/organizations/clinica-a/templates",
      {
        title: "Receita com variável inválida",
        type: "PRESCRIPTION",
        bodyTemplate:
          "Prescrevo para {paciente_nome} portador do segredo {variavel_inexistente} e {paciente_rg}.",
      },
    );
    expect(unapprovedVarRes.status).toBe(422);
    expect(await unapprovedVarRes.json()).toMatchObject({
      error: {
        code: "INVALID_TEMPLATE_VARIABLE",
        details: {
          invalidVariables: ["variavel_inexistente", "paciente_rg"],
        },
      },
    });

    // 2. Unapproved dynamic variable on PATCH -> 422 INVALID_TEMPLATE_VARIABLE
    const patchUnapprovedRes = await f.patch(
      `/organizations/clinica-a/templates/${clinicAActiveTemplateId}`,
      {
        version: 2,
        bodyTemplate: "Texto com {campo_fora_do_catalogo}.",
      },
    );
    expect(patchUnapprovedRes.status).toBe(422);
    expect(await patchUnapprovedRes.json()).toMatchObject({
      error: {
        code: "INVALID_TEMPLATE_VARIABLE",
        details: {
          invalidVariables: ["campo_fora_do_catalogo"],
        },
      },
    });

    // 3. Invalid structures -> 422 INVALID_TEMPLATE_STRUCTURE
    const invalidStructures = [
      {
        title: "   ",
        type: "CERTIFICATE",
        bodyTemplate: "Atesto comparecimento de {paciente_nome}.",
        expectedReason: "EMPTY_OR_TOO_SHORT_TITLE",
      },
      {
        title: "Atestado Vazio",
        type: "CERTIFICATE",
        bodyTemplate: "    ",
        expectedReason: "EMPTY_BODY",
      },
      {
        title: "Chave não fechada",
        type: "CERTIFICATE",
        bodyTemplate: "Atesto que {paciente_nome compareceu hoje.",
        expectedReason: "UNCLOSED_PLACEHOLDER",
      },
      {
        title: "Chave fechada sem abrir",
        type: "CERTIFICATE",
        bodyTemplate: "Atesto que paciente_nome} compareceu hoje.",
        expectedReason: "UNMATCHED_CLOSING_BRACE",
      },
      {
        title: "Placeholder vazio",
        type: "CERTIFICATE",
        bodyTemplate: "Atesto que {} compareceu hoje.",
        expectedReason: "EMPTY_PLACEHOLDER",
      },
      {
        title: "Chaves aninhadas",
        type: "CERTIFICATE",
        bodyTemplate: "Atesto que {paciente_{nome}} compareceu hoje.",
        expectedReason: "MALFORMED_PLACEHOLDER",
      },
      {
        title: "Chaves desbalanceadas",
        type: "CERTIFICATE",
        bodyTemplate: "Atesto que {{paciente_nome} compareceu hoje.",
        expectedReason: "MISMATCHED_PLACEHOLDER_BRACES",
      },
      {
        title: "Placeholder com espaço interno",
        type: "CERTIFICATE",
        bodyTemplate: "Atesto que {paciente nome} compareceu hoje.",
        expectedReason: "INVALID_PLACEHOLDER_SYNTAX",
      },
    ] as const;

    for (const testCase of invalidStructures) {
      const res = await f.post("/organizations/clinica-a/templates", {
        title: testCase.title,
        type: testCase.type,
        bodyTemplate: testCase.bodyTemplate,
      });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({
        error: {
          code: "INVALID_TEMPLATE_STRUCTURE",
          details: {
            reason: testCase.expectedReason,
          },
        },
      });
    }
  });

  test("saving a new version preserves previous versions intact and readable for existing documents", async () => {
    const f = createFixture();

    // Read v1 and v2 before updating to v3
    const v1BeforeRes = await f.get(
      `/organizations/clinica-a/templates/${clinicAActiveTemplateId}?version=1`,
    );
    expect(v1BeforeRes.status).toBe(200);
    const v1Before = (await v1BeforeRes.json()) as TemplateDetailResponse;
    expect(v1Before).toMatchObject({
      id: clinicAActiveTemplateId,
      version: 1,
      title: "Atestado 1 Dia - Clínica A (v1)",
      bodyTemplate:
        "Atesto que {paciente_nome} compareceu à {clinica_nome} em {data_atual} (versão 1 original).",
    });

    // Save v3 via PATCH
    const updateRes = await f.patch(
      `/organizations/clinica-a/templates/${clinicAActiveTemplateId}`,
      {
        version: 2,
        title: "Atestado 5 Dias - Clínica A (v3)",
        bodyTemplate:
          "Atesto para os devidos fins que {paciente_nome} ({paciente_cpf}) necessita de 5 dias de repouso a partir de {data_atual}. Emitido por {profissional_nome} ({profissional_registro}).",
      },
    );
    expect(updateRes.status).toBe(200);
    const updatedV3 = (await updateRes.json()) as TemplateDetailResponse;
    expect(updatedV3).toMatchObject({
      id: clinicAActiveTemplateId,
      version: 3,
      title: "Atestado 5 Dias - Clínica A (v3)",
      variables: [
        "paciente_nome",
        "paciente_cpf",
        "data_atual",
        "profissional_nome",
        "profissional_registro",
      ],
    });

    // Verify that v1 and v2 are completely unchanged and still readable!
    const v1AfterRes = await f.get(
      `/organizations/clinica-a/templates/${clinicAActiveTemplateId}?version=1`,
    );
    expect(v1AfterRes.status).toBe(200);
    expect(await v1AfterRes.json()).toMatchObject({
      id: clinicAActiveTemplateId,
      version: 1,
      title: "Atestado 1 Dia - Clínica A (v1)",
      bodyTemplate:
        "Atesto que {paciente_nome} compareceu à {clinica_nome} em {data_atual} (versão 1 original).",
    });

    const v2AfterRes = await f.get(
      `/organizations/clinica-a/templates/${clinicAActiveTemplateId}/versions/2`,
    );
    expect(v2AfterRes.status).toBe(200);
    expect(await v2AfterRes.json()).toMatchObject({
      id: clinicAActiveTemplateId,
      version: 2,
      title: "Atestado 3 Dias - Clínica A",
      bodyTemplate:
        "Atesto para os devidos fins que {paciente_nome} esteve em atendimento na {clinica_nome} em {data_atual}.",
    });

    // Version history endpoint lists all 3 immutable versions in order
    const versionsRes = await f.get(
      `/organizations/clinica-a/templates/${clinicAActiveTemplateId}/versions`,
    );
    expect(versionsRes.status).toBe(200);
    const versionsBody = (await versionsRes.json()) as TemplateVersionsResponse;
    expect(versionsBody.versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versionsBody.data).toHaveLength(3);
  });

  test("detects concurrent edits in two sessions and returns HTTP 409 VERSION_CONFLICT", async () => {
    const f = createFixture();

    // Session 1 and Session 2 both load version 2 of clinicAActiveTemplateId
    const session1Res = await f.patch(
      `/organizations/clinica-a/templates/${clinicAActiveTemplateId}`,
      {
        version: 2,
        title: "Atestado Atualizado pela Sessão 1",
        bodyTemplate: "Texto salvo pela sessão 1 para {paciente_nome}.",
      },
    );
    expect(session1Res.status).toBe(200);
    const session1Body = (await session1Res.json()) as TemplateDetailResponse;
    expect(session1Body.version).toBe(3);

    // Session 2 tries to save using stale version 2 -> 409 VERSION_CONFLICT
    const session2Res = await f.patch(
      `/organizations/clinica-a/templates/${clinicAActiveTemplateId}`,
      {
        version: 2,
        title: "Atestado Concorrente da Sessão 2",
        bodyTemplate: "Texto concorrente da sessão 2 para {paciente_nome}.",
      },
    );
    expect(session2Res.status).toBe(409);
    expect(await session2Res.json()).toMatchObject({
      error: {
        code: "VERSION_CONFLICT",
        details: {
          expectedVersion: 2,
          currentVersion: 3,
        },
      },
    });

    // Confirm Session 1's version 3 remains intact
    const currentRes = await f.get(
      `/organizations/clinica-a/templates/${clinicAActiveTemplateId}`,
    );
    expect(currentRes.status).toBe(200);
    expect(await currentRes.json()).toMatchObject({
      version: 3,
      title: "Atestado Atualizado pela Sessão 1",
      bodyTemplate: "Texto salvo pela sessão 1 para {paciente_nome}.",
    });
  });

  test("enforces tenant isolation, global/archived protection, and RBAC on template mutations", async () => {
    const f = createFixture();

    // Editing a global template is forbidden (403 PERMISSION_DENIED)
    const editGlobal = await f.patch(
      `/organizations/clinica-a/templates/${globalTemplateId}`,
      {
        version: 1,
        title: "Tentativa de alterar global",
      },
    );
    expect(editGlobal.status).toBe(403);
    expect(await editGlobal.json()).toMatchObject({
      error: { code: "PERMISSION_DENIED" },
    });

    // Editing an archived template returns 409 INVALID_STATE_TRANSITION
    const editArchived = await f.patch(
      `/organizations/clinica-a/templates/${clinicAArchivedTemplateId}`,
      {
        version: 1,
        title: "Tentativa de alterar arquivado",
      },
    );
    expect(editArchived.status).toBe(409);
    expect(await editArchived.json()).toMatchObject({
      error: { code: "INVALID_STATE_TRANSITION" },
    });

    // Editing or reading a template from another clinic returns 404 NOT_FOUND
    const editForeign = await f.patch(
      `/organizations/clinica-a/templates/${clinicBTemplateId}`,
      {
        version: 1,
        title: "Tentativa de alterar outra clínica",
      },
    );
    expect(editForeign.status).toBe(404);
    expect(await editForeign.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });

    const getForeign = await f.get(
      `/organizations/clinica-a/templates/${clinicBTemplateId}`,
    );
    expect(getForeign.status).toBe(404);

    // RECEPTIONIST cannot create or edit templates (403 PERMISSION_DENIED)
    for (const deniedRole of ["RECEPTIONIST"] as const) {
      f.setRole(deniedRole);
      const deniedCreate = await f.post("/organizations/clinica-a/templates", {
        title: "Novo Modelo",
        type: "CERTIFICATE",
        bodyTemplate: "Atesto que {paciente_nome} compareceu.",
      });
      expect(deniedCreate.status).toBe(403);
      expect(await deniedCreate.json()).toMatchObject({
        error: {
          code: "PERMISSION_DENIED",
          details: { requiredPermission: "templates:write" },
        },
      });
    }

    // ADMIN (dono da clínica) pode criar modelos
    f.setRole("ADMIN");
    const adminCreate = await f.post("/organizations/clinica-a/templates", {
      title: "Modelo do dono",
      type: "CERTIFICATE",
      bodyTemplate: "Atesto que {paciente_nome} compareceu.",
    });
    expect(adminCreate.status).toBe(201);

    // ADMIN_PROFESSIONAL can create and update templates
    f.setRole("ADMIN_PROFESSIONAL");
    const allowedCreate = await f.post(
      "/organizations/clinica-a/document-templates",
      {
        title: "Laudo Cardiológico",
        type: "REPORT",
        bodyTemplate:
          "Laudo de {paciente_nome} emitido por {profissional_nome} ({profissional_registro}) em {data_hora_emissao}.",
      },
    );
    expect(allowedCreate.status).toBe(201);
  });
});
