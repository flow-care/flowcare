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
  TemplateVariablesResponse,
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
  createdAt: Date;
  updatedAt: Date;
}

function createFixture() {
  let role: MembershipRole = "PROFESSIONAL";
  let membershipStatus: MembershipStatus = "ACTIVE";
  let membershipOrgSlug: string | null = "clinica-a";
  let sessionActive = true;

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
      createdAt: new Date("2026-10-04T10:00:00.000Z"),
      updatedAt: new Date("2026-10-04T10:00:00.000Z"),
    },
  ];

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
        return found ? { id: found.id } : null;
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

  return {
    get,
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

    // ADMIN (non-clinical) and RECEPTIONIST -> 403 PERMISSION_DENIED
    for (const deniedRole of ["ADMIN", "RECEPTIONIST"] as const) {
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

    // PROFESSIONAL and ADMIN_PROFESSIONAL -> 200 OK
    for (const allowedRole of ["PROFESSIONAL", "ADMIN_PROFESSIONAL"] as const) {
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
