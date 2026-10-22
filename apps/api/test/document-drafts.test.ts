import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type {
  DocumentStatus,
  DocumentType,
  MembershipRole,
  MembershipStatus,
  Prisma,
  PrismaClient,
  TemplateStatus,
} from "../src/generated/prisma/client";
import type {
  DocumentResponse,
  DocumentVersionsResponse,
} from "../src/modules/documents/model";
import { signSessionToken } from "../src/services/session-token";

const secret = "document-drafts-test-secret-32c!!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const profAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const profBId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const patientAId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const patientBId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const globalPrescriptionTemplateId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const clinicACertificateTemplateId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const clinicAArchivedTemplateId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";
const clinicBReportTemplateId = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";

interface StoredTemplate {
  id: string;
  organizationId: string | null;
  title: string;
  type: DocumentType;
  bodyTemplate: string;
  status: TemplateStatus;
  version: number;
}

interface StoredVersion {
  id: string;
  documentId: string;
  organizationId: string;
  version: number;
  title: string;
  content: string;
  variables: Prisma.JsonValue;
  templateId: string | null;
  templateVersion: number | null;
  savedById: string;
  createdAt: Date;
}

interface StoredDocument {
  id: string;
  organizationId: string;
  patientId: string;
  authorId: string;
  templateId: string | null;
  templateVersion: number | null;
  type: DocumentType;
  title: string;
  content: string;
  variables: Prisma.JsonValue;
  status: DocumentStatus;
  version: number;
  currentRevisionId: string | null;
  issuedAt: Date | null;
  voidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredAuditLog {
  id: string;
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

function createFixture() {
  let role: MembershipRole = "PROFESSIONAL";
  let membershipStatus: MembershipStatus = "ACTIVE";
  let allowedOrgSlugs = new Set<string>(["clinica-a"]);
  let sessionActive = true;

  const patients = [
    { id: patientAId, organizationId: clinicAId, fullName: "Maria da Silva" },
    { id: patientBId, organizationId: clinicBId, fullName: "João Oliveira" },
  ];

  const templates: StoredTemplate[] = [
    {
      id: globalPrescriptionTemplateId,
      organizationId: null,
      title: "Receita Simples Padrão",
      type: "PRESCRIPTION",
      bodyTemplate:
        "Uso oral: Dipirona 500mg a cada 6 horas para {paciente_nome}.",
      status: "ACTIVE",
      version: 1,
    },
    {
      id: clinicACertificateTemplateId,
      organizationId: clinicAId,
      title: "Atestado Médico - 3 Dias",
      type: "CERTIFICATE",
      bodyTemplate:
        "Atesto para os devidos fins que {paciente_nome} necessita de 3 dias de repouso.",
      status: "ACTIVE",
      version: 3,
    },
    {
      id: clinicAArchivedTemplateId,
      organizationId: clinicAId,
      title: "Atestado Antigo (Arquivado)",
      type: "CERTIFICATE",
      bodyTemplate: "Modelo antigo arquivado.",
      status: "ARCHIVED",
      version: 2,
    },
    {
      id: clinicBReportTemplateId,
      organizationId: clinicBId,
      title: "Laudo Clínica B",
      type: "REPORT",
      bodyTemplate: "Laudo exclusivo da Clínica B.",
      status: "ACTIVE",
      version: 1,
    },
  ];

  const documents: StoredDocument[] = [];
  const versions: StoredVersion[] = [];
  const auditLogs: StoredAuditLog[] = [];

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
        if (!allowedOrgSlugs.has(where.organization.slug)) return null;
        return {
          id: "membership-1",
          organizationId:
            where.organization.slug === "clinica-b" ? clinicBId : clinicAId,
          role,
          status: membershipStatus,
        };
      },
    },
    patient: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) => {
        return (
          patients.find(
            (p) =>
              p.id === where.id && p.organizationId === where.organizationId,
          ) ?? null
        );
      },
    },
    documentTemplate: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const orClauses = where.OR as
          | Array<{ organizationId: string | null }>
          | undefined;
        return (
          templates.find((tpl) => {
            if (where.id && tpl.id !== where.id) return false;
            if (orClauses) {
              return orClauses.some(
                (clause) => tpl.organizationId === clause.organizationId,
              );
            }
            return true;
          }) ?? null
        );
      },
    },
    clinicalDocument: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const now = (data.createdAt as Date | undefined) ?? new Date();
        const record: StoredDocument = {
          id: (data.id as string | undefined) ?? crypto.randomUUID(),
          organizationId: data.organizationId as string,
          patientId: data.patientId as string,
          authorId: data.authorId as string,
          templateId: (data.templateId as string | null | undefined) ?? null,
          templateVersion:
            (data.templateVersion as number | null | undefined) ?? null,
          type: data.type as DocumentType,
          title: data.title as string,
          content: data.content as string,
          variables: (data.variables as Prisma.JsonValue) ?? {},
          status: (data.status as DocumentStatus | undefined) ?? "DRAFT",
          version: (data.version as number | undefined) ?? 1,
          currentRevisionId:
            (data.currentRevisionId as string | null | undefined) ?? null,
          issuedAt: (data.issuedAt as Date | null | undefined) ?? null,
          voidedAt: (data.voidedAt as Date | null | undefined) ?? null,
          createdAt: now,
          updatedAt: (data.updatedAt as Date | undefined) ?? now,
        };
        documents.push(record);
        return { ...record };
      },
      findFirst: async ({
        where,
        include,
      }: {
        where: { id: string; organizationId: string };
        include?: { versions?: unknown };
      }) => {
        const doc = documents.find(
          (d) => d.id === where.id && d.organizationId === where.organizationId,
        );
        if (!doc) return null;
        if (include?.versions) {
          const docVersions = versions
            .filter((v) => v.documentId === doc.id)
            .sort((a, b) => a.version - b.version);
          return { ...doc, versions: docVersions };
        }
        return { ...doc };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id: string;
          organizationId: string;
          status?: DocumentStatus;
          version?: number;
        };
        data: Record<string, unknown>;
      }) => {
        const doc = documents.find(
          (d) =>
            d.id === where.id &&
            d.organizationId === where.organizationId &&
            (where.status === undefined || d.status === where.status) &&
            (where.version === undefined || d.version === where.version),
        );
        if (!doc) return { count: 0 };
        if (data.title !== undefined) doc.title = data.title as string;
        if (data.content !== undefined) doc.content = data.content as string;
        if (data.variables !== undefined)
          doc.variables = data.variables as Prisma.JsonValue;
        if (data.templateId !== undefined)
          doc.templateId = data.templateId as string | null;
        if (data.templateVersion !== undefined)
          doc.templateVersion = data.templateVersion as number | null;
        if (data.version !== undefined) doc.version = data.version as number;
        if (data.currentRevisionId !== undefined)
          doc.currentRevisionId = data.currentRevisionId as string | null;
        if (data.updatedAt !== undefined)
          doc.updatedAt = data.updatedAt as Date;
        return { count: 1 };
      },
    },
    documentVersion: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const existingConflict = versions.some(
          (v) => v.documentId === data.documentId && v.version === data.version,
        );
        if (existingConflict) {
          const err = new Error("Unique constraint failed") as Error & {
            code: string;
          };
          err.code = "P2002";
          throw err;
        }
        const record: StoredVersion = {
          id: (data.id as string | undefined) ?? crypto.randomUUID(),
          documentId: data.documentId as string,
          organizationId: data.organizationId as string,
          version: data.version as number,
          title: data.title as string,
          content: data.content as string,
          variables: (data.variables as Prisma.JsonValue) ?? {},
          templateId: (data.templateId as string | null | undefined) ?? null,
          templateVersion:
            (data.templateVersion as number | null | undefined) ?? null,
          savedById: data.savedById as string,
          createdAt: (data.createdAt as Date | undefined) ?? new Date(),
        };
        versions.push(record);
        return { ...record };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const entry: StoredAuditLog = {
          id: crypto.randomUUID(),
          organizationId: data.organizationId as string,
          actorUserId: data.actorUserId as string,
          action: data.action as string,
          targetType: data.targetType as string,
          targetId: data.targetId as string,
          metadata: (data.metadata as Prisma.JsonValue) ?? {},
          createdAt: new Date(),
        };
        auditLogs.push(entry);
        return entry;
      },
    },
    $transaction: async <T>(fn: (tx: PrismaClient) => Promise<T>) =>
      fn(prisma as unknown as PrismaClient),
  } as unknown as PrismaClient;

  const env = {
    jwtSecret: secret,
    corsOrigin: "http://localhost:3000",
    wahaBaseUrl: "http://127.0.0.1:1",
    version: "test",
    webAppUrl: "http://localhost:3000",
  } as Env;

  const app = createApp(env, { prisma, mailer: {} as never });
  const tokenForUser = (userId = profAId) =>
    signSessionToken({ sid: "session-1", sub: userId }, secret, 3600);

  const request = (
    method: string,
    path: string,
    body?: unknown,
    options?: { authenticated?: boolean; userId?: string },
  ) => {
    const authenticated = options?.authenticated ?? true;
    const headers: Record<string, string> = {};
    if (authenticated) {
      headers.authorization = `Bearer ${tokenForUser(options?.userId ?? profAId)}`;
    }
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    return app.handle(
      new Request(`http://localhost/api${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
  };

  return {
    request,
    documents,
    versions,
    auditLogs,
    setRole: (value: MembershipRole) => {
      role = value;
    },
    setMembershipStatus: (value: MembershipStatus) => {
      membershipStatus = value;
    },
    setAllowedOrgSlugs: (slugs: string[]) => {
      allowedOrgSlugs = new Set(slugs);
    },
    setSessionActive: (value: boolean) => {
      sessionActive = value;
    },
    markDocumentStatus: (
      documentId: string,
      status: DocumentStatus,
      timestamp = new Date("2026-10-12T18:00:00.000Z"),
    ) => {
      const doc = documents.find((d) => d.id === documentId);
      if (!doc) throw new Error(`Document ${documentId} not found`);
      doc.status = status;
      if (status === "ISSUED") doc.issuedAt = timestamp;
      if (status === "VOIDED") doc.voidedAt = timestamp;
    },
  };
}

describe("document drafts and versions module (#273)", () => {
  test("creates valid drafts with and without template, recording author, templateVersion, initial version=1, and DocumentVersion entry", async () => {
    const f = createFixture();

    // 1. Draft created with clinic template (CERTIFICATE, version 3)
    const withTemplateRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "CERTIFICATE",
        templateId: clinicACertificateTemplateId,
        variables: { dias_repouso: 3, cid: "J00" },
      },
    );
    expect(withTemplateRes.status).toBe(201);
    const createdWithTpl = (await withTemplateRes.json()) as DocumentResponse;

    expect(createdWithTpl).toMatchObject({
      organizationId: clinicAId,
      patientId: patientAId,
      authorId: profAId,
      templateId: clinicACertificateTemplateId,
      templateVersion: 3,
      type: "CERTIFICATE",
      title: "Atestado Médico - 3 Dias",
      content:
        "Atesto para os devidos fins que {paciente_nome} necessita de 3 dias de repouso.",
      variables: { dias_repouso: 3, cid: "J00" },
      status: "DRAFT",
      version: 1,
      issuedAt: null,
      voidedAt: null,
    });
    expect(createdWithTpl.documentId).toBe(createdWithTpl.id);
    expect(createdWithTpl.revisionId).toBeTruthy();
    expect(createdWithTpl.versions).toHaveLength(1);
    expect(createdWithTpl.versions[0]).toMatchObject({
      id: createdWithTpl.revisionId,
      revisionId: createdWithTpl.revisionId,
      documentId: createdWithTpl.id,
      version: 1,
      title: "Atestado Médico - 3 Dias",
      templateId: clinicACertificateTemplateId,
      templateVersion: 3,
      savedById: profAId,
    });

    // 2. Draft created without template via /documents/drafts alias across remaining MVP types
    for (const allowedType of [
      "PRESCRIPTION",
      "REPORT",
      "EXAM_REQUEST",
    ] as const) {
      const res = await f.request(
        "POST",
        "/organizations/clinica-a/documents/drafts",
        {
          patientId: patientAId,
          type: allowedType,
          title: `Rascunho ${allowedType}`,
          content: `Conteúdo inicial para ${allowedType}`,
        },
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as DocumentResponse;
      expect(body.type).toBe(allowedType);
      expect(body.status).toBe("DRAFT");
      expect(body.version).toBe(1);
      expect(body.templateId).toBeNull();
      expect(body.templateVersion).toBeNull();
      expect(body.versions).toHaveLength(1);
    }

    expect(
      f.auditLogs.filter((log) => log.action === "DOCUMENT_DRAFT_CREATED"),
    ).toHaveLength(4);
  });

  test("validates allowed document types and rejects archived, mismatched, or foreign templates and foreign patients", async () => {
    const f = createFixture();

    // Disallowed document type (e.g. CONTROLLED_PRESCRIPTION or FREE_TEXT) -> 400 VALIDATION_ERROR
    for (const invalidType of [
      "CONTROLLED_PRESCRIPTION",
      "FREE_TEXT",
      "CUSTOM",
    ]) {
      const invalidTypeRes = await f.request(
        "POST",
        "/organizations/clinica-a/documents",
        {
          patientId: patientAId,
          type: invalidType,
          title: "Receita Controlada",
          content: "Conteúdo restrito",
        },
      );
      expect(invalidTypeRes.status).toBe(400);
      expect(await invalidTypeRes.json()).toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    }

    // Archived template -> 400 VALIDATION_ERROR
    const archivedTplRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "CERTIFICATE",
        templateId: clinicAArchivedTemplateId,
      },
    );
    expect(archivedTplRes.status).toBe(400);
    expect(await archivedTplRes.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: { field: "templateId", reason: "TEMPLATE_ARCHIVED" },
      },
    });

    // Template type mismatch (PRESCRIPTION template for REPORT document) -> 400 VALIDATION_ERROR
    const mismatchTplRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "REPORT",
        templateId: globalPrescriptionTemplateId,
      },
    );
    expect(mismatchTplRes.status).toBe(400);
    expect(await mismatchTplRes.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: { field: "type", expectedType: "PRESCRIPTION" },
      },
    });

    // Foreign clinic template -> 404 NOT_FOUND
    const foreignTplRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "REPORT",
        templateId: clinicBReportTemplateId,
      },
    );
    expect(foreignTplRes.status).toBe(404);
    expect(await foreignTplRes.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });

    // Foreign clinic patient -> 404 NOT_FOUND
    const foreignPatientRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientBId,
        type: "PRESCRIPTION",
        title: "Receita",
        content: "Conteúdo",
      },
    );
    expect(foreignPatientRes.status).toBe(404);
    expect(await foreignPatientRes.json()).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  test("persists a new intermediate revision in DocumentVersion on every draft save and enforces optimistic concurrency (409 VERSION_CONFLICT)", async () => {
    const f = createFixture();

    const createRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "PRESCRIPTION",
        templateId: globalPrescriptionTemplateId,
        title: "Receita - Versão 1",
        content: "Dipirona 500mg - 1 comprimido de 8/8h",
        variables: { posologia: "8/8h" },
      },
    );
    expect(createRes.status).toBe(201);
    const v1 = (await createRes.json()) as DocumentResponse;
    expect(v1.version).toBe(1);
    const rev1Id = v1.revisionId;

    // Session 1 saves update against version 1 -> succeeds and increments to version 2
    const save1Res = await f.request(
      "PATCH",
      `/organizations/clinica-a/documents/${v1.id}`,
      {
        version: 1,
        content: "Dipirona 500mg - 1 comprimido de 6/6h por 5 dias",
        variables: { posologia: "6/6h", duracao_dias: 5 },
      },
      { userId: profAId },
    );
    expect(save1Res.status).toBe(200);
    const v2 = (await save1Res.json()) as DocumentResponse;
    expect(v2.version).toBe(2);
    expect(v2.revisionId).not.toBe(rev1Id);
    expect(v2.content).toBe("Dipirona 500mg - 1 comprimido de 6/6h por 5 dias");
    expect(v2.versions).toHaveLength(2);

    // Session 2 concurrently tries to save with stale version 1 -> 409 VERSION_CONFLICT
    const staleSaveRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/documents/${v1.id}`,
      {
        version: 1,
        content: "Edição concorrente desatualizada que não deve sobrescrever",
      },
      { userId: profBId },
    );
    expect(staleSaveRes.status).toBe(409);
    expect(await staleSaveRes.json()).toMatchObject({
      error: { code: "VERSION_CONFLICT" },
    });

    // Session 2 reloads and saves with version 2 via PUT /draft alias -> succeeds and increments to version 3
    const save2Res = await f.request(
      "PUT",
      `/organizations/clinica-a/documents/${v1.id}/draft`,
      {
        version: 2,
        title: "Receita Simples Finalizada no Rascunho",
        content:
          "Dipirona 500mg - 1 comprimido de 6/6h por 5 dias + hidratação oral",
      },
      { userId: profBId },
    );
    expect(save2Res.status).toBe(200);
    const v3 = (await save2Res.json()) as DocumentResponse;
    expect(v3.version).toBe(3);
    expect(v3.versions).toHaveLength(3);

    // Verify full intermediate revision history via GET /documents/:documentId/versions
    const versionsRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${v1.id}/versions`,
    );
    expect(versionsRes.status).toBe(200);
    const history = (await versionsRes.json()) as DocumentVersionsResponse;
    expect(history.currentVersion).toBe(3);
    expect(history.currentRevisionId).toBe(v3.revisionId);
    expect(history.versions.map((item) => item.version)).toEqual([1, 2, 3]);
    expect(history.versions.map((item) => item.content)).toEqual([
      "Dipirona 500mg - 1 comprimido de 8/8h",
      "Dipirona 500mg - 1 comprimido de 6/6h por 5 dias",
      "Dipirona 500mg - 1 comprimido de 6/6h por 5 dias + hidratação oral",
    ]);
    expect(history.versions.map((item) => item.savedById)).toEqual([
      profAId,
      profAId,
      profBId,
    ]);
  });

  test("rejects updating an ISSUED or VOIDED document (409 DOCUMENT_STATE_CONFLICT) without altering snapshot or versions", async () => {
    const f = createFixture();

    const createRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "CERTIFICATE",
        templateId: clinicACertificateTemplateId,
        title: "Atestado Emitido",
        content: "Conteúdo definitivo do atestado emitido.",
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as DocumentResponse;

    // Transition document to ISSUED
    f.markDocumentStatus(created.id, "ISSUED");

    const updateIssuedRes = await f.request(
      "PATCH",
      `/organizations/clinica-a/documents/${created.id}`,
      {
        version: 1,
        content: "Tentativa de alterar documento já emitido",
      },
    );
    expect(updateIssuedRes.status).toBe(409);
    expect(await updateIssuedRes.json()).toMatchObject({
      error: {
        code: "DOCUMENT_STATE_CONFLICT",
        message: "Documento emitido não pode ser atualizado por este comando.",
        details: {
          currentStatus: "ISSUED",
          reason: "DOCUMENT_NOT_EDITABLE",
        },
      },
    });

    // Verify document content and version count remained untouched
    const getRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${created.id}`,
    );
    expect(getRes.status).toBe(200);
    const afterAttempt = (await getRes.json()) as DocumentResponse;
    expect(afterAttempt.status).toBe("ISSUED");
    expect(afterAttempt.version).toBe(1);
    expect(afterAttempt.content).toBe(
      "Conteúdo definitivo do atestado emitido.",
    );
    expect(afterAttempt.versions).toHaveLength(1);

    // Also reject when VOIDED
    f.markDocumentStatus(created.id, "VOIDED");
    const updateVoidedRes = await f.request(
      "PUT",
      `/organizations/clinica-a/documents/${created.id}`,
      {
        version: 1,
        content: "Tentativa de alterar documento anulado",
      },
    );
    expect(updateVoidedRes.status).toBe(409);
    expect(await updateVoidedRes.json()).toMatchObject({
      error: {
        code: "DOCUMENT_STATE_CONFLICT",
        details: { currentStatus: "VOIDED" },
      },
    });
  });

  test("isolates drafts across clinics (404 NOT_FOUND) and enforces RBAC permissions", async () => {
    const f = createFixture();
    f.setAllowedOrgSlugs(["clinica-a", "clinica-b"]);

    const createARes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "REPORT",
        title: "Laudo Clínica A",
        content: "Conteúdo sigiloso da Clínica A.",
      },
    );
    expect(createARes.status).toBe(201);
    const docA = (await createARes.json()) as DocumentResponse;

    // Accessing Clinic A's draft from Clinic B returns 404 NOT_FOUND on GET, versions, and PATCH
    const getFromB = await f.request(
      "GET",
      `/organizations/clinica-b/documents/${docA.id}`,
    );
    expect(getFromB.status).toBe(404);

    const versionsFromB = await f.request(
      "GET",
      `/organizations/clinica-b/documents/${docA.id}/versions`,
    );
    expect(versionsFromB.status).toBe(404);

    const patchFromB = await f.request(
      "PATCH",
      `/organizations/clinica-b/documents/${docA.id}`,
      {
        version: 1,
        content: "Tentativa de alteração cruzada",
      },
    );
    expect(patchFromB.status).toBe(404);

    // RBAC: RECEPTIONIST é negada com 403 PERMISSION_DENIED
    for (const deniedRole of ["RECEPTIONIST"] as const) {
      f.setRole(deniedRole);
      const readDenied = await f.request(
        "GET",
        `/organizations/clinica-a/documents/${docA.id}`,
      );
      expect(readDenied.status).toBe(403);
      expect(await readDenied.json()).toMatchObject({
        error: {
          code: "PERMISSION_DENIED",
          details: { requiredPermission: "documents:read" },
        },
      });

      const writeDenied = await f.request(
        "POST",
        "/organizations/clinica-a/documents",
        {
          patientId: patientAId,
          type: "PRESCRIPTION",
          title: "Receita",
          content: "Conteúdo",
        },
      );
      expect(writeDenied.status).toBe(403);
      expect(await writeDenied.json()).toMatchObject({
        error: {
          code: "PERMISSION_DENIED",
          details: { requiredPermission: "documents:write" },
        },
      });
    }

    // ADMIN (dono da clínica) também é papel clínico
    f.setRole("ADMIN");
    const adminRead = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${docA.id}`,
    );
    expect(adminRead.status).toBe(200);

    // ADMIN_PROFESSIONAL is allowed
    f.setRole("ADMIN_PROFESSIONAL");
    const adminProfRead = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${docA.id}`,
    );
    expect(adminProfRead.status).toBe(200);

    // Unauthenticated -> 401 UNAUTHENTICATED
    const unauth = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${docA.id}`,
      undefined,
      { authenticated: false },
    );
    expect(unauth.status).toBe(401);

    // Suspended membership -> 403 MEMBERSHIP_INACTIVE
    f.setMembershipStatus("SUSPENDED");
    const suspended = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${docA.id}`,
    );
    expect(suspended.status).toBe(403);
    expect(await suspended.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });
  });
});
