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
} from "../src/generated/prisma/client";
import { ALL_PERMISSIONS } from "../src/lib/permissions";
import type {
  DocumentResponse,
  DocumentVersionsResponse,
  VoidDocumentResponse,
} from "../src/modules/documents/model";
import { DocumentsService } from "../src/modules/documents/service";
import { signSessionToken } from "../src/services/session-token";

const secret = "document-void-test-secret-32c!!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const profAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const profBId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const adminProfId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const patientAId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const patientBId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

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
  preparedRevisionId?: string | null;
  replacesDocumentId?: string | null;
  chainVersion?: number;
  snapshotHash?: string | null;
  pdfObjectKey?: string | null;
  issuedById?: string | null;
  issuedAt: Date | null;
  voidedAt: Date | null;
  voidReason?: string | null;
  voidedById?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredAuditLog {
  id: string;
  organizationId: string | null;
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
  let permissions: string[] | null = null;
  const allowedOrgSlugs = new Set<string>(["clinica-a"]);
  let sessionActive = true;

  const users = [
    { id: profAId, fullName: "Dra. Maria Santos" },
    { id: profBId, fullName: "Dr. Carlos Lima" },
    { id: adminProfId, fullName: "Dra. Diretora Clínica" },
  ];

  const patients = [
    { id: patientAId, organizationId: clinicAId, fullName: "Paciente Silva" },
    { id: patientBId, organizationId: clinicBId, fullName: "Paciente Souza" },
  ];

  const documents: StoredDocument[] = [];
  const versions: StoredVersion[] = [];
  const auditLogs: StoredAuditLog[] = [];

  const prisma = {
    session: {
      findFirst: async () =>
        sessionActive ? { id: "session-1", lastActiveAt: new Date() } : null,
    },
    user: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        users.find((u) => u.id === where.id) ?? null,
    },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; organization: { slug: string } };
      }) => {
        if (!allowedOrgSlugs.has(where.organization.slug)) return null;
        let effectiveRole = role;
        if (where.userId === adminProfId) {
          effectiveRole = "ADMIN_PROFESSIONAL";
        }
        return {
          id: `membership-${where.userId}`,
          organizationId:
            where.organization.slug === "clinica-b" ? clinicBId : clinicAId,
          role: effectiveRole,
          permissions,
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
    clinicalDocument: {
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string;
          organizationId: string;
          status?: DocumentStatus;
          replacesDocumentId?: string;
        };
      }) => {
        const found = documents.find(
          (d) =>
            d.organizationId === where.organizationId &&
            (where.id === undefined || d.id === where.id) &&
            (where.status === undefined || d.status === where.status) &&
            (where.replacesDocumentId === undefined ||
              d.replacesDocumentId === where.replacesDocumentId),
        );
        if (!found) return null;
        const patient = patients.find((p) => p.id === found.patientId);
        const author = users.find((u) => u.id === found.authorId);
        const docVersions = versions
          .filter(
            (v) =>
              v.documentId === found.id &&
              v.organizationId === found.organizationId,
          )
          .map((v) => ({
            ...v,
            savedBy: users.find((u) => u.id === v.savedById) ?? {
              id: v.savedById,
              fullName: "Profissional",
            },
          }));
        return {
          ...found,
          patient: patient
            ? { id: patient.id, fullName: patient.fullName }
            : null,
          author: author ? { id: author.id, fullName: author.fullName } : null,
          versions: docVersions,
        };
      },
      findMany: async ({
        where,
      }: {
        where: { organizationId: string; status?: DocumentStatus };
      }) => {
        return documents
          .filter(
            (d) =>
              d.organizationId === where.organizationId &&
              (where.status === undefined || d.status === where.status),
          )
          .map((found) => {
            const patient = patients.find((p) => p.id === found.patientId);
            const author = users.find((u) => u.id === found.authorId);
            const docVersions = versions.filter(
              (v) =>
                v.documentId === found.id &&
                v.organizationId === found.organizationId,
            );
            return {
              ...found,
              patient: patient
                ? { id: patient.id, fullName: patient.fullName }
                : null,
              author: author
                ? { id: author.id, fullName: author.fullName }
                : null,
              versions: docVersions,
            };
          });
      },
      count: async ({
        where,
      }: {
        where: { organizationId: string; status?: DocumentStatus };
      }) => {
        return documents.filter(
          (d) =>
            d.organizationId === where.organizationId &&
            (where.status === undefined || d.status === where.status),
        ).length;
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
        if (data.status !== undefined)
          doc.status = data.status as DocumentStatus;
        if (data.voidedAt !== undefined) doc.voidedAt = data.voidedAt as Date;
        if (data.voidReason !== undefined)
          doc.voidReason = data.voidReason as string;
        if (data.voidedById !== undefined)
          doc.voidedById = data.voidedById as string;
        if (data.updatedAt !== undefined)
          doc.updatedAt = data.updatedAt as Date;
        return { count: 1 };
      },
    },
    documentVersion: {
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string;
          documentId: string;
          organizationId: string;
          version?: number;
        };
      }) => {
        const found = versions.find(
          (v) =>
            v.documentId === where.documentId &&
            v.organizationId === where.organizationId &&
            (where.id === undefined || v.id === where.id) &&
            (where.version === undefined || v.version === where.version),
        );
        if (!found) return null;
        return {
          ...found,
          savedBy: users.find((u) => u.id === found.savedById) ?? {
            id: found.savedById,
            fullName: "Profissional",
          },
        };
      },
      findMany: async ({
        where,
      }: {
        where: { documentId: string; organizationId: string };
      }) => {
        return versions
          .filter(
            (v) =>
              v.documentId === where.documentId &&
              v.organizationId === where.organizationId,
          )
          .map((v) => ({
            ...v,
            savedBy: users.find((u) => u.id === v.savedById) ?? {
              id: v.savedById,
              fullName: "Profissional",
            },
          }));
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const entry: StoredAuditLog = {
          id: crypto.randomUUID(),
          organizationId: (data.organizationId as string | null) ?? null,
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

  const seedDocument = (
    overrides?: Partial<StoredDocument>,
  ): StoredDocument => {
    const docId = overrides?.id ?? crypto.randomUUID();
    const revisionId = overrides?.currentRevisionId ?? crypto.randomUUID();
    const doc: StoredDocument = {
      id: docId,
      organizationId: overrides?.organizationId ?? clinicAId,
      patientId: overrides?.patientId ?? patientAId,
      authorId: overrides?.authorId ?? profAId,
      templateId: null,
      templateVersion: null,
      type: overrides?.type ?? "PRESCRIPTION",
      title: overrides?.title ?? "Receita Simples",
      content: overrides?.content ?? "Paracetamol 500mg",
      variables: overrides?.variables ?? {},
      status: overrides?.status ?? "ISSUED",
      version: overrides?.version ?? 2,
      currentRevisionId: revisionId,
      preparedRevisionId: revisionId,
      replacesDocumentId: null,
      chainVersion: 1,
      snapshotHash: "sha256_mock_hash",
      pdfObjectKey: `organizations/${clinicAId}/pdf/mock.pdf`,
      issuedById: overrides?.authorId ?? profAId,
      issuedAt:
        overrides?.issuedAt !== undefined
          ? overrides.issuedAt
          : new Date("2026-10-13T10:00:00Z"),
      voidedAt: overrides?.voidedAt ?? null,
      voidReason: overrides?.voidReason ?? null,
      voidedById: overrides?.voidedById ?? null,
      createdAt: new Date("2026-10-13T09:00:00Z"),
      updatedAt: new Date("2026-10-13T10:00:00Z"),
      ...overrides,
    };
    documents.push(doc);

    versions.push({
      id: revisionId,
      documentId: docId,
      organizationId: doc.organizationId,
      version: doc.version,
      title: doc.title,
      content: doc.content,
      variables: doc.variables,
      templateId: null,
      templateVersion: null,
      savedById: doc.authorId,
      createdAt: doc.createdAt,
    });

    return doc;
  };

  return {
    app,
    request,
    prisma,
    documents,
    versions,
    auditLogs,
    seedDocument,
    setRole: (value: MembershipRole) => {
      role = value;
    },
    setMembershipStatus: (value: MembershipStatus) => {
      membershipStatus = value;
    },
    setPermissions: (value: string[] | null) => {
      permissions = value;
    },
    setSessionActive: (value: boolean) => {
      sessionActive = value;
    },
  };
}

describe("document voiding (#278)", () => {
  test("successfully voids an ISSUED document and records immutable audit log", async () => {
    const f = createFixture();
    const doc = f.seedDocument({ status: "ISSUED" });

    const res = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      {
        reason: "Erro na dosagem prescrita: 500mg ao invés de 250mg",
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as VoidDocumentResponse;
    expect(body.status).toBe("VOIDED");
    expect(body.voidReason).toBe(
      "Erro na dosagem prescrita: 500mg ao invés de 250mg",
    );
    expect(typeof body.voidedAt).toBe("string");
    expect(new Date(body.voidedAt).getTime()).not.toBeNaN();

    // Verify database state
    const stored = f.documents.find((d) => d.id === doc.id);
    expect(stored).toBeDefined();
    expect(stored?.status).toBe("VOIDED");
    expect(stored?.voidReason).toBe(
      "Erro na dosagem prescrita: 500mg ao invés de 250mg",
    );
    expect(stored?.voidedById).toBe(profAId);
    expect(stored?.voidedAt).toBeDefined();

    // Verify AuditLog creation
    const voidAudit = f.auditLogs.find(
      (a) => a.action === "DOCUMENT_VOIDED" && a.targetId === doc.id,
    );
    expect(voidAudit).toBeDefined();
    expect(voidAudit?.targetType).toBe("DOCUMENT");
    expect(voidAudit?.actorUserId).toBe(profAId);
    expect(voidAudit?.organizationId).toBe(clinicAId);
    expect(voidAudit?.metadata).toEqual({
      reason: "Erro na dosagem prescrita: 500mg ao invés de 250mg",
      previousStatus: "ISSUED",
    });
  });

  test("rejects voiding if reason is missing or shorter than 10 characters (HTTP 400)", async () => {
    const f = createFixture();
    const doc = f.seedDocument({ status: "ISSUED" });

    // Missing reason in body
    const resNoReason = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      {},
    );
    expect(resNoReason.status).toBe(400);
    const bodyNoReason = (await resNoReason.json()) as {
      error: { code: string; message: string };
    };
    expect(bodyNoReason.error.code).toBe("VALIDATION_ERROR");

    // Empty reason
    const resEmpty = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      { reason: "" },
    );
    expect(resEmpty.status).toBe(400);

    // Reason shorter than 10 characters
    const resShort = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      { reason: "Curto" },
    );
    expect(resShort.status).toBe(400);

    // Reason with only whitespace (trimmed < 10)
    const resWhitespace = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      { reason: "          " },
    );
    expect(resWhitespace.status).toBe(400);

    // Document remains ISSUED and no audit log was created
    const stored = f.documents.find((d) => d.id === doc.id);
    expect(stored?.status).toBe("ISSUED");
    expect(
      f.auditLogs.filter((a) => a.action === "DOCUMENT_VOIDED").length,
    ).toBe(0);
  });

  test("rejects voiding if document is in DRAFT status (HTTP 409)", async () => {
    const f = createFixture();
    const draftDoc = f.seedDocument({ status: "DRAFT" });

    const res = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draftDoc.id}/void`,
      {
        reason: "Tentativa de anular documento em rascunho",
      },
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("DOCUMENT_STATE_CONFLICT");

    const stored = f.documents.find((d) => d.id === draftDoc.id);
    expect(stored?.status).toBe("DRAFT");
  });

  test("rejects voiding if document is already VOIDED (HTTP 409)", async () => {
    const f = createFixture();
    const voidedDoc = f.seedDocument({
      status: "VOIDED",
      voidedAt: new Date("2026-10-14T08:00:00Z"),
      voidReason: "Primeira anulação formal realizada",
      voidedById: profAId,
    });

    const res = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${voidedDoc.id}/void`,
      {
        reason: "Segunda tentativa de anulação",
      },
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("DOCUMENT_STATE_CONFLICT");
    expect(body.error.message).toContain("anulado");
  });

  test("multi-tenant isolation: rejects document from another clinic with 404", async () => {
    const f = createFixture();
    const foreignDoc = f.seedDocument({
      organizationId: clinicBId,
      status: "ISSUED",
    });

    // Calling clinica-a with doc from clinicB
    const res = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${foreignDoc.id}/void`,
      {
        reason: "Tentativa em outra organização",
      },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("NOT_FOUND");

    // Calling with non-existent document UUID
    const nonExistentUuid = "99999999-9999-4999-8999-999999999999";
    const resNonExistent = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${nonExistentUuid}/void`,
      {
        reason: "Documento que não existe no banco",
      },
    );
    expect(resNonExistent.status).toBe(404);
  });

  test("permission checks: rejects unauthorized roles with 403", async () => {
    const f = createFixture();
    const doc = f.seedDocument({ status: "ISSUED", authorId: profAId });

    // 1. RECEPTIONIST role -> 403 PERMISSION_DENIED
    f.setRole("RECEPTIONIST");
    const resReceptionist = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      { reason: "Recepcionista tentando anular" },
    );
    expect(resReceptionist.status).toBe(403);
    const bodyRec = (await resReceptionist.json()) as {
      error: { code: string; message: string };
    };
    expect(bodyRec.error.code).toBe("PERMISSION_DENIED");

    // 2. ADMIN não autor do documento, sem `clinical:read_all` -> 403
    f.setRole("ADMIN");
    const resAdmin = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      { reason: "Administrador tentando anular documento de terceiro" },
      { userId: profBId },
    );
    expect(resAdmin.status).toBe(403);
    const bodyAdmin = (await resAdmin.json()) as {
      error: { code: string; message: string };
    };
    expect(bodyAdmin.error.code).toBe("PERMISSION_DENIED");

    // 3. Unauthenticated request -> 401 UNAUTHENTICATED
    f.setRole("PROFESSIONAL");
    const resUnauth = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      { reason: "Tentativa sem token autenticado" },
      { authenticated: false },
    );
    expect(resUnauth.status).toBe(401);

    // 4. Suspended/inactive membership -> 403 MEMBERSHIP_INACTIVE
    f.setMembershipStatus("SUSPENDED");
    const resInactive = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      { reason: "Tentativa com vínculo suspenso" },
    );
    expect(resInactive.status).toBe(403);
    const bodyInactive = (await resInactive.json()) as {
      error: { code: string; message: string };
    };
    expect(bodyInactive.error.code).toBe("MEMBERSHIP_INACTIVE");
  });

  test("permission checks: autor anula o próprio documento; anular o de terceiro exige clinical:read_all", async () => {
    const f = createFixture();
    // Document authored by Dra. Maria Santos (profAId)
    const doc = f.seedDocument({ status: "ISSUED", authorId: profAId });

    // Dr. Carlos Lima (profBId) is a PROFESSIONAL but NOT the author
    f.setRole("PROFESSIONAL");
    const resProfB = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      { reason: "Tentativa de anular documento de colega" },
      { userId: profBId },
    );
    expect(resProfB.status).toBe(403);
    const bodyProfB = (await resProfB.json()) as {
      error: { code: string; message: string };
    };
    expect(bodyProfB.error.code).toBe("PERMISSION_DENIED");

    // A autora (profAId) anula o próprio documento
    const resAuthor = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      { reason: "Correção solicitada pelo próprio profissional" },
      { userId: profAId },
    );
    expect(resAuthor.status).toBe(200);

    // Admin que não é autor, sem `clinical:read_all` -> 403
    const doc2 = f.seedDocument({ status: "ISSUED", authorId: profAId });
    const resAdminProf = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc2.id}/void`,
      { reason: "Anulação formal autorizada pela diretoria clínica" },
      { userId: adminProfId },
    );
    expect(resAdminProf.status).toBe(403);

    // Com `clinical:read_all` concedida explicitamente -> 200
    f.setPermissions([...ALL_PERMISSIONS]);
    const resWithScope = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc2.id}/void`,
      { reason: "Anulação formal autorizada pela diretoria clínica" },
      { userId: adminProfId },
    );
    expect(resWithScope.status).toBe(200);
    const bodyWithScope = (await resWithScope.json()) as VoidDocumentResponse;
    expect(bodyWithScope.status).toBe("VOIDED");
    expect(bodyWithScope.voidReason).toBe(
      "Anulação formal autorizada pela diretoria clínica",
    );
  });

  test("supports optimistic concurrency control with optional version field", async () => {
    const f = createFixture();
    const doc = f.seedDocument({ status: "ISSUED", version: 3 });

    // Conflict version
    const resConflict = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      {
        reason: "Tentativa de anulação concorrente",
        version: 1, // diverges from doc.version (3)
      },
    );
    expect(resConflict.status).toBe(409);
    const bodyConflict = (await resConflict.json()) as {
      error: { code: string; message: string };
    };
    expect(bodyConflict.error.code).toBe("VERSION_CONFLICT");

    // Matching version
    const resMatch = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      {
        reason: "Anulação com versão perfeitamente sincronizada",
        version: 3,
      },
    );
    expect(resMatch.status).toBe(200);
    const bodyMatch = (await resMatch.json()) as VoidDocumentResponse;
    expect(bodyMatch.status).toBe("VOIDED");
  });

  test("document detail, listing and version endpoints expose voidReason and voidedAt", async () => {
    const f = createFixture();
    const doc = f.seedDocument({ status: "ISSUED" });

    // Void the document
    await f.request(
      "POST",
      `/organizations/clinica-a/documents/${doc.id}/void`,
      {
        reason: "Justificativa detalhada de anulação registrada",
      },
    );

    // 1. GET /documents/:documentId returns voidReason and voidedAt
    const resDetail = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}`,
    );
    expect(resDetail.status).toBe(200);
    const bodyDetail = (await resDetail.json()) as DocumentResponse;
    expect(bodyDetail.status).toBe("VOIDED");
    expect(bodyDetail.voidReason).toBe(
      "Justificativa detalhada de anulação registrada",
    );
    expect(typeof bodyDetail.voidedAt).toBe("string");
    expect(bodyDetail.document.voidReason).toBe(
      "Justificativa detalhada de anulação registrada",
    );
    expect(typeof bodyDetail.document.voidedAt).toBe("string");

    // 2. GET /documents lists voidReason and voidedAt
    const resList = await f.request(
      "GET",
      `/organizations/clinica-a/documents`,
    );
    expect(resList.status).toBe(200);
    const bodyList = (await resList.json()) as {
      data: Array<{
        id: string;
        status: string;
        voidReason?: string | null;
        voidedAt?: string | null;
      }>;
    };
    const listedItem = bodyList.data.find(
      (item: { id: string }) => item.id === doc.id,
    );
    expect(listedItem).toBeDefined();
    expect(listedItem?.status).toBe("VOIDED");
    expect(listedItem?.voidReason).toBe(
      "Justificativa detalhada de anulação registrada",
    );
    expect(typeof listedItem?.voidedAt).toBe("string");

    // 3. GET /documents/:documentId/versions includes voidedAt, voidReason and status
    const resVersions = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}/versions`,
    );
    expect(resVersions.status).toBe(200);
    const bodyVersions = (await resVersions.json()) as DocumentVersionsResponse;
    expect(bodyVersions.status).toBe("VOIDED");
    expect(bodyVersions.voidReason).toBe(
      "Justificativa detalhada de anulação registrada",
    );
    expect(typeof bodyVersions.voidedAt).toBe("string");

    // 4. GET /documents/:documentId/versions/:versionId preserves historical snapshot and exposes voidedAt
    const resVersionDetail = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}/versions/2`,
    );
    expect(resVersionDetail.status).toBe(200);
    const bodyVersionDetail = (await resVersionDetail.json()) as {
      version: number;
      voidReason?: string | null;
      voidedAt?: string | null;
      snapshot: { title: string; content: string };
    };
    expect(bodyVersionDetail.version).toBe(2);
    expect(bodyVersionDetail.voidReason).toBe(
      "Justificativa detalhada de anulação registrada",
    );
    expect(typeof bodyVersionDetail.voidedAt).toBe("string");
    expect(bodyVersionDetail.snapshot).toBeDefined();
    expect(bodyVersionDetail.snapshot.title).toBe("Receita Simples");
    expect(bodyVersionDetail.snapshot.content).toBe("Paracetamol 500mg");
  });
});
