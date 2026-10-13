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
  DocumentVersionDetailResponse,
  DocumentVersionsResponse,
  ListDocumentsResponse,
} from "../src/modules/documents/model";
import { signSessionToken } from "../src/services/session-token";

const secret = "document-history-test-secret-32c!!";

const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const profAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const profBId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const receptionistId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const adminOnlyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";

const patientA1Id = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const patientA2Id = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
const patientB1Id = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

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

  const users = [
    { id: profAId, fullName: "Dr. João Silva" },
    { id: profBId, fullName: "Dra. Ana Santos" },
    { id: receptionistId, fullName: "Carla Recepção" },
    { id: adminOnlyId, fullName: "Marcos Administrador" },
  ];

  const patients = [
    { id: patientA1Id, organizationId: clinicAId, fullName: "Carlos Eduardo" },
    { id: patientA2Id, organizationId: clinicAId, fullName: "Beatriz Souza" },
    { id: patientB1Id, organizationId: clinicBId, fullName: "Fernando Dias" },
  ];

  const templates: StoredTemplate[] = [
    {
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
      organizationId: null,
      title: "Receita Simples Padrão",
      type: "PRESCRIPTION",
      bodyTemplate: "Uso oral: Amoxicilina 500mg para {paciente_nome}.",
      status: "ACTIVE",
      version: 1,
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
      organizationId: clinicAId,
      title: "Atestado 3 Dias",
      type: "CERTIFICATE",
      bodyTemplate: "Atesto repouso de 3 dias para {paciente_nome}.",
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
    user: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        return users.find((u) => u.id === where.id) ?? null;
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
      count: async ({ where }: { where: Record<string, unknown> }) => {
        return filterDocuments(documents, where).length;
      },
      findMany: async ({
        where,
        orderBy,
        skip,
        take,
        cursor,
      }: {
        where: Record<string, unknown>;
        orderBy?: Array<Record<string, "asc" | "desc">>;
        skip?: number;
        take?: number;
        cursor?: { id: string };
        include?: Record<string, unknown>;
      }) => {
        const filtered = filterDocuments(documents, where);

        if (orderBy && orderBy.length > 0) {
          const firstSort = orderBy[0];
          if (firstSort) {
            const entries = Object.entries(firstSort);
            const firstEntry = entries[0];
            if (firstEntry) {
              const [field, direction] = firstEntry;
              filtered.sort((a, b) => {
                const valA = (a as unknown as Record<string, unknown>)[field];
                const valB = (b as unknown as Record<string, unknown>)[field];
                if (valA instanceof Date && valB instanceof Date) {
                  return direction === "asc"
                    ? valA.getTime() - valB.getTime()
                    : valB.getTime() - valA.getTime();
                }
                if (typeof valA === "string" && typeof valB === "string") {
                  return direction === "asc"
                    ? valA.localeCompare(valB)
                    : valB.localeCompare(valA);
                }
                return 0;
              });
            }
          }
        }

        let startIndex = 0;
        if (cursor) {
          const cursorIndex = filtered.findIndex((d) => d.id === cursor.id);
          if (cursorIndex >= 0) {
            startIndex = cursorIndex + (skip ?? 0);
          }
        } else if (skip) {
          startIndex = skip;
        }

        const sliced =
          take !== undefined
            ? filtered.slice(startIndex, startIndex + take)
            : filtered.slice(startIndex);

        return sliced.map((d) =>
          attachDocumentRelations(d, patients, users, versions),
        );
      },
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) => {
        const doc = documents.find(
          (d) => d.id === where.id && d.organizationId === where.organizationId,
        );
        if (!doc) return null;
        return attachDocumentRelations(doc, patients, users, versions);
      },
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
        return attachDocumentRelations(record, patients, users, versions);
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
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string;
          documentId?: string;
          organizationId?: string;
          version?: number;
        };
      }) => {
        const versionRecord = versions.find((v) => {
          if (where.id && v.id !== where.id) return false;
          if (where.documentId && v.documentId !== where.documentId)
            return false;
          if (where.organizationId && v.organizationId !== where.organizationId)
            return false;
          if (where.version !== undefined && v.version !== where.version)
            return false;
          return true;
        });
        if (!versionRecord) return null;
        const author = users.find((u) => u.id === versionRecord.savedById) ?? {
          id: versionRecord.savedById,
          fullName: "Profissional",
        };
        return {
          ...versionRecord,
          savedBy: author,
        };
      },
      findMany: async ({
        where,
      }: {
        where: { documentId?: string; organizationId?: string };
      }) => {
        return versions
          .filter(
            (v) =>
              (!where.documentId || v.documentId === where.documentId) &&
              (!where.organizationId ||
                v.organizationId === where.organizationId),
          )
          .map((v) => {
            const author = users.find((u) => u.id === v.savedById) ?? {
              id: v.savedById,
              fullName: "Profissional",
            };
            return {
              ...v,
              savedBy: author,
            };
          });
      },
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
        const author = users.find((u) => u.id === record.savedById) ?? {
          id: record.savedById,
          fullName: "Profissional",
        };
        return {
          ...record,
          savedBy: author,
        };
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
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> =>
      fn(prisma),
  };

  const env = {
    jwtSecret: secret,
    corsOrigin: "http://localhost:3000",
    wahaBaseUrl: "http://127.0.0.1:1",
    version: "test",
    webAppUrl: "http://localhost:3000",
  } as Env;

  const app = createApp(env, {
    prisma: prisma as unknown as PrismaClient,
    mailer: {} as never,
  });

  const tokenForUser = (userId = profAId) =>
    signSessionToken({ sid: "session-1", sub: userId }, secret, 3600);

  const request = async (
    method: string,
    path: string,
    body?: unknown,
    options?: { authenticated?: boolean; userId?: string },
  ) => {
    const headers: Record<string, string> = {};
    if (options?.authenticated ?? true) {
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
    documents,
    versions,
    auditLogs,
    request,
    setRole: (newRole: MembershipRole) => {
      role = newRole;
    },
    setMembershipStatus: (status: MembershipStatus) => {
      membershipStatus = status;
    },
    setAllowedOrgSlugs: (slugs: string[]) => {
      allowedOrgSlugs = new Set(slugs);
    },
    setSessionActive: (active: boolean) => {
      sessionActive = active;
    },
    seedDocument: (doc: StoredDocument, docVersions: StoredVersion[] = []) => {
      documents.push(doc);
      for (const v of docVersions) {
        versions.push(v);
      }
    },
  };
}

function filterDocuments(
  docs: StoredDocument[],
  where: Record<string, unknown>,
): StoredDocument[] {
  return docs.filter((d) => {
    if (where.organizationId && d.organizationId !== where.organizationId) {
      return false;
    }
    if (where.patientId && d.patientId !== where.patientId) {
      return false;
    }
    if (where.authorId && d.authorId !== where.authorId) {
      return false;
    }
    if (where.type && d.type !== where.type) {
      return false;
    }
    if (where.status && d.status !== where.status) {
      return false;
    }
    if (where.createdAt) {
      const dateFilter = where.createdAt as {
        gte?: Date;
        lte?: Date;
      };
      if (dateFilter.gte && d.createdAt < dateFilter.gte) {
        return false;
      }
      if (dateFilter.lte && d.createdAt > dateFilter.lte) {
        return false;
      }
    }
    if (where.OR) {
      const orConditions = where.OR as Array<{
        title?: { contains: string; mode?: string };
        content?: { contains: string; mode?: string };
      }>;
      const matched = orConditions.some((clause) => {
        if (clause.title?.contains) {
          return d.title
            .toLowerCase()
            .includes(clause.title.contains.toLowerCase());
        }
        if (clause.content?.contains) {
          return d.content
            .toLowerCase()
            .includes(clause.content.contains.toLowerCase());
        }
        return false;
      });
      if (!matched) return false;
    }
    return true;
  });
}

function attachDocumentRelations(
  doc: StoredDocument,
  patients: Array<{ id: string; fullName: string }>,
  users: Array<{ id: string; fullName: string }>,
  versions: StoredVersion[],
) {
  const patient = patients.find((p) => p.id === doc.patientId) ?? {
    id: doc.patientId,
    fullName: "Paciente",
  };
  const author = users.find((u) => u.id === doc.authorId) ?? {
    id: doc.authorId,
    fullName: "Profissional",
  };
  const docVersions = versions
    .filter((v) => v.documentId === doc.id)
    .sort((a, b) => a.version - b.version)
    .map((v) => {
      const savedBy = users.find((u) => u.id === v.savedById) ?? {
        id: v.savedById,
        fullName: "Profissional",
      };
      return {
        ...v,
        savedBy,
      };
    });

  return {
    ...doc,
    patient,
    author,
    versions: docVersions,
  };
}

describe("Document history, paginated list, and version snapshot endpoints (#277)", () => {
  test("lists documents with filters by patientId, type, status, authorId, date range, and text search", async () => {
    const f = createFixture();

    const date1 = new Date("2026-10-01T10:00:00.000Z");
    const date2 = new Date("2026-10-05T14:30:00.000Z");
    const date3 = new Date("2026-10-10T09:15:00.000Z");
    const date4 = new Date("2026-10-12T16:00:00.000Z");

    const doc1Id = crypto.randomUUID();
    const doc2Id = crypto.randomUUID();
    const doc3Id = crypto.randomUUID();
    const doc4Id = crypto.randomUUID();

    f.seedDocument(
      {
        id: doc1Id,
        organizationId: clinicAId,
        patientId: patientA1Id,
        authorId: profAId,
        templateId: null,
        templateVersion: null,
        type: "PRESCRIPTION",
        title: "Receita de Amoxicilina",
        content: "Tomar 500mg de amoxicilina a cada 8 horas",
        variables: { posologia: "8/8h" },
        status: "DRAFT",
        version: 1,
        currentRevisionId: crypto.randomUUID(),
        issuedAt: null,
        voidedAt: null,
        createdAt: date1,
        updatedAt: date1,
      },
      [
        {
          id: crypto.randomUUID(),
          documentId: doc1Id,
          organizationId: clinicAId,
          version: 1,
          title: "Receita de Amoxicilina",
          content: "Tomar 500mg de amoxicilina a cada 8 horas",
          variables: { posologia: "8/8h" },
          templateId: null,
          templateVersion: null,
          savedById: profAId,
          createdAt: date1,
        },
      ],
    );

    f.seedDocument(
      {
        id: doc2Id,
        organizationId: clinicAId,
        patientId: patientA1Id,
        authorId: profAId,
        templateId: null,
        templateVersion: null,
        type: "CERTIFICATE",
        title: "Atestado Médico 3 Dias",
        content: "Paciente necessita de repouso por 3 dias",
        variables: { dias: 3 },
        status: "ISSUED",
        version: 1,
        currentRevisionId: crypto.randomUUID(),
        issuedAt: date2,
        voidedAt: null,
        createdAt: date2,
        updatedAt: date2,
      },
      [
        {
          id: crypto.randomUUID(),
          documentId: doc2Id,
          organizationId: clinicAId,
          version: 1,
          title: "Atestado Médico 3 Dias",
          content: "Paciente necessita de repouso por 3 dias",
          variables: { dias: 3 },
          templateId: null,
          templateVersion: null,
          savedById: profAId,
          createdAt: date2,
        },
      ],
    );

    f.seedDocument(
      {
        id: doc3Id,
        organizationId: clinicAId,
        patientId: patientA2Id,
        authorId: profBId,
        templateId: null,
        templateVersion: null,
        type: "REPORT",
        title: "Laudo Cardiológico",
        content:
          "Eletrocardiograma dentro dos padrões normais de ritmo sinusal",
        variables: {},
        status: "DRAFT",
        version: 1,
        currentRevisionId: crypto.randomUUID(),
        issuedAt: null,
        voidedAt: null,
        createdAt: date3,
        updatedAt: date3,
      },
      [
        {
          id: crypto.randomUUID(),
          documentId: doc3Id,
          organizationId: clinicAId,
          version: 1,
          title: "Laudo Cardiológico",
          content:
            "Eletrocardiograma dentro dos padrões normais de ritmo sinusal",
          variables: {},
          templateId: null,
          templateVersion: null,
          savedById: profBId,
          createdAt: date3,
        },
      ],
    );

    f.seedDocument(
      {
        id: doc4Id,
        organizationId: clinicAId,
        patientId: patientA2Id,
        authorId: profAId,
        templateId: null,
        templateVersion: null,
        type: "EXAM_REQUEST",
        title: "Solicitação de Hemograma Completo",
        content: "Hemograma completo com contagem de plaquetas e coagulograma",
        variables: {},
        status: "VOIDED",
        version: 1,
        currentRevisionId: crypto.randomUUID(),
        issuedAt: date4,
        voidedAt: date4,
        createdAt: date4,
        updatedAt: date4,
      },
      [
        {
          id: crypto.randomUUID(),
          documentId: doc4Id,
          organizationId: clinicAId,
          version: 1,
          title: "Solicitação de Hemograma Completo",
          content:
            "Hemograma completo com contagem de plaquetas e coagulograma",
          variables: {},
          templateId: null,
          templateVersion: null,
          savedById: profAId,
          createdAt: date4,
        },
      ],
    );

    // 1. List all documents of Clinic A
    const listAllRes = await f.request(
      "GET",
      "/organizations/clinica-a/documents",
    );
    expect(listAllRes.status).toBe(200);
    const listAll = (await listAllRes.json()) as ListDocumentsResponse;
    expect(listAll.data).toHaveLength(4);
    expect(listAll.pageInfo.totalCount).toBe(4);
    expect(listAll.data[0]?.patient.fullName).toBeDefined();
    expect(listAll.data[0]?.author.fullName).toBeDefined();

    // 2. Filter by patientId
    const filterPatientRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents?patientId=${patientA1Id}`,
    );
    expect(filterPatientRes.status).toBe(200);
    const filterPatient =
      (await filterPatientRes.json()) as ListDocumentsResponse;
    expect(filterPatient.data).toHaveLength(2);
    expect(filterPatient.data.every((d) => d.patientId === patientA1Id)).toBe(
      true,
    );
    expect(filterPatient.data.map((d) => d.id)).toEqual([doc2Id, doc1Id]); // Ordered DESC by date

    // 3. Filter by type
    const filterTypeRes = await f.request(
      "GET",
      "/organizations/clinica-a/documents?type=PRESCRIPTION",
    );
    expect(filterTypeRes.status).toBe(200);
    const filterType = (await filterTypeRes.json()) as ListDocumentsResponse;
    expect(filterType.data).toHaveLength(1);
    expect(filterType.data[0]?.id).toBe(doc1Id);
    expect(filterType.data[0]?.type).toBe("PRESCRIPTION");

    // 4. Filter by status
    const filterStatusRes = await f.request(
      "GET",
      "/organizations/clinica-a/documents?status=ISSUED",
    );
    expect(filterStatusRes.status).toBe(200);
    const filterStatus =
      (await filterStatusRes.json()) as ListDocumentsResponse;
    expect(filterStatus.data).toHaveLength(1);
    expect(filterStatus.data[0]?.id).toBe(doc2Id);
    expect(filterStatus.data[0]?.status).toBe("ISSUED");

    // 5. Filter by authorId
    const filterAuthorRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents?authorId=${profBId}`,
    );
    expect(filterAuthorRes.status).toBe(200);
    const filterAuthor =
      (await filterAuthorRes.json()) as ListDocumentsResponse;
    expect(filterAuthor.data).toHaveLength(1);
    expect(filterAuthor.data[0]?.id).toBe(doc3Id);
    expect(filterAuthor.data[0]?.authorId).toBe(profBId);

    // 6. Text search by title or content (search or q)
    const searchRes = await f.request(
      "GET",
      "/organizations/clinica-a/documents?search=amoxicilina",
    );
    expect(searchRes.status).toBe(200);
    const searchData = (await searchRes.json()) as ListDocumentsResponse;
    expect(searchData.data).toHaveLength(1);
    expect(searchData.data[0]?.id).toBe(doc1Id);

    const qRes = await f.request(
      "GET",
      "/organizations/clinica-a/documents?q=sinusal",
    );
    expect(qRes.status).toBe(200);
    const qData = (await qRes.json()) as ListDocumentsResponse;
    expect(qData.data).toHaveLength(1);
    expect(qData.data[0]?.id).toBe(doc3Id);

    // 7. Date range filter (startDate and endDate)
    const dateRangeRes = await f.request(
      "GET",
      "/organizations/clinica-a/documents?startDate=2026-10-04&endDate=2026-10-11",
    );
    expect(dateRangeRes.status).toBe(200);
    const dateRangeData = (await dateRangeRes.json()) as ListDocumentsResponse;
    expect(dateRangeData.data).toHaveLength(2);
    expect(dateRangeData.data.map((d) => d.id)).toEqual([doc3Id, doc2Id]);
  });

  test("supports pagination with limit, cursor, pageInfo, and ordering", async () => {
    const f = createFixture();

    const ids: string[] = [];
    for (let i = 1; i <= 6; i++) {
      const id = crypto.randomUUID();
      ids.push(id);
      const date = new Date(`2026-10-0${i}T12:00:00.000Z`);
      f.seedDocument(
        {
          id,
          organizationId: clinicAId,
          patientId: patientA1Id,
          authorId: profAId,
          templateId: null,
          templateVersion: null,
          type: "PRESCRIPTION",
          title: `Receita ${i}`,
          content: `Conteúdo da receita ${i}`,
          variables: {},
          status: "DRAFT",
          version: 1,
          currentRevisionId: crypto.randomUUID(),
          issuedAt: null,
          voidedAt: null,
          createdAt: date,
          updatedAt: date,
        },
        [
          {
            id: crypto.randomUUID(),
            documentId: id,
            organizationId: clinicAId,
            version: 1,
            title: `Receita ${i}`,
            content: `Conteúdo da receita ${i}`,
            variables: {},
            templateId: null,
            templateVersion: null,
            savedById: profAId,
            createdAt: date,
          },
        ],
      );
    }

    // Default DESC order: IDs [6, 5, 4, 3, 2, 1]
    const expectedDesc = [...ids].reverse();

    // Page 1 with limit = 2
    const p1Res = await f.request(
      "GET",
      "/organizations/clinica-a/documents?limit=2&page=1",
    );
    expect(p1Res.status).toBe(200);
    const p1 = (await p1Res.json()) as ListDocumentsResponse;
    expect(p1.data).toHaveLength(2);
    expect(p1.data.map((d) => d.id)).toEqual(expectedDesc.slice(0, 2));
    expect(p1.pageInfo.limit).toBe(2);
    expect(p1.pageInfo.page).toBe(1);
    expect(p1.pageInfo.totalCount).toBe(6);
    expect(p1.pageInfo.hasNextPage).toBe(true);
    expect(p1.pageInfo.nextCursor).toBe(expectedDesc[1] ?? null);

    // Page 2 with limit = 2
    const p2Res = await f.request(
      "GET",
      "/organizations/clinica-a/documents?limit=2&page=2",
    );
    expect(p2Res.status).toBe(200);
    const p2 = (await p2Res.json()) as ListDocumentsResponse;
    expect(p2.data).toHaveLength(2);
    expect(p2.data.map((d) => d.id)).toEqual(expectedDesc.slice(2, 4));
    expect(p2.pageInfo.page).toBe(2);
    expect(p2.pageInfo.hasNextPage).toBe(true);

    // Cursor-based pagination: fetch next page starting after cursor
    const cursorRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents?limit=2&cursor=${p1.pageInfo.nextCursor}`,
    );
    expect(cursorRes.status).toBe(200);
    const cursorData = (await cursorRes.json()) as ListDocumentsResponse;
    expect(cursorData.data).toHaveLength(2);
    expect(cursorData.data.map((d) => d.id)).toEqual(expectedDesc.slice(2, 4));

    // Last page: limit = 2, page = 3
    const p3Res = await f.request(
      "GET",
      "/organizations/clinica-a/documents?limit=2&page=3",
    );
    expect(p3Res.status).toBe(200);
    const p3 = (await p3Res.json()) as ListDocumentsResponse;
    expect(p3.data).toHaveLength(2);
    expect(p3.data.map((d) => d.id)).toEqual(expectedDesc.slice(4, 6));
    expect(p3.pageInfo.hasNextPage).toBe(false);
    expect(p3.pageInfo.nextCursor).toBeNull();

    // Ascending order with ?order=asc
    const ascRes = await f.request(
      "GET",
      "/organizations/clinica-a/documents?limit=3&order=asc",
    );
    expect(ascRes.status).toBe(200);
    const ascData = (await ascRes.json()) as ListDocumentsResponse;
    expect(ascData.data.map((d) => d.id)).toEqual(ids.slice(0, 3));
  });

  test("fetches complete document details including patient, author, and snapshot at current and historical versions", async () => {
    const f = createFixture();

    const createRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientA1Id,
        type: "PRESCRIPTION",
        title: "Receita Inicial (v1)",
        content: "Paracetamol 500mg 1 comprimido 6/6h se dor ou febre",
        variables: { dose: "500mg", frequencia: "6/6h" },
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as DocumentResponse;

    // Update to v2
    const updateV2Res = await f.request(
      "PATCH",
      `/organizations/clinica-a/documents/${created.id}`,
      {
        version: 1,
        title: "Receita Atualizada (v2)",
        content: "Paracetamol 750mg 1 comprimido 8/8h + repouso",
        variables: { dose: "750mg", frequencia: "8/8h" },
      },
    );
    expect(updateV2Res.status).toBe(200);
    const docV2 = (await updateV2Res.json()) as DocumentResponse;
    expect(docV2.version).toBe(2);

    // Fetch current details (v2)
    const getRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${created.id}`,
    );
    expect(getRes.status).toBe(200);
    const currentDoc = (await getRes.json()) as DocumentResponse;
    expect(currentDoc.id).toBe(created.id);
    expect(currentDoc.title).toBe("Receita Atualizada (v2)");
    expect(currentDoc.content).toBe(
      "Paracetamol 750mg 1 comprimido 8/8h + repouso",
    );
    expect(currentDoc.variables).toEqual({ dose: "750mg", frequencia: "8/8h" });
    expect(currentDoc.version).toBe(2);
    expect(currentDoc.patient).toEqual({
      id: patientA1Id,
      fullName: "Carlos Eduardo",
    });
    expect(currentDoc.author).toEqual({
      id: profAId,
      fullName: "Dr. João Silva",
    });
    expect(currentDoc.status).toBe("DRAFT");
    expect(currentDoc.createdAt).toBeDefined();
    expect(currentDoc.updatedAt).toBeDefined();

    // Fetch with ?version=1: returns historical snapshot of v1
    const getV1Res = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${created.id}?version=1`,
    );
    expect(getV1Res.status).toBe(200);
    const v1Doc = (await getV1Res.json()) as DocumentResponse;
    expect(v1Doc.version).toBe(1);
    expect(v1Doc.title).toBe("Receita Inicial (v1)");
    expect(v1Doc.content).toBe(
      "Paracetamol 500mg 1 comprimido 6/6h se dor ou febre",
    );
    expect(v1Doc.variables).toEqual({ dose: "500mg", frequencia: "6/6h" });

    // Request non-existent version returns 404
    const getV99Res = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${created.id}?version=99`,
    );
    expect(getV99Res.status).toBe(404);
  });

  test("fetches list of revisions (DocumentVersion) across multiple draft saves with savedBy and isActiveVersion", async () => {
    const f = createFixture();

    // 1. Create v1
    const createRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientA1Id,
        type: "REPORT",
        title: "Laudo Clínico Inicial",
        content: "Observações iniciais do paciente.",
      },
      { userId: profAId },
    );
    expect(createRes.status).toBe(201);
    const doc = (await createRes.json()) as DocumentResponse;

    // 2. Update to v2 by Prof B
    const updateV2Res = await f.request(
      "PATCH",
      `/organizations/clinica-a/documents/${doc.id}`,
      {
        version: 1,
        content: "Observações iniciais complementadas por Dra. Ana.",
      },
      { userId: profBId },
    );
    expect(updateV2Res.status).toBe(200);

    // 3. Update to v3 by Prof A
    const updateV3Res = await f.request(
      "PATCH",
      `/organizations/clinica-a/documents/${doc.id}`,
      {
        version: 2,
        title: "Laudo Clínico Final",
        content: "Observações finais validadas e concluídas.",
      },
      { userId: profAId },
    );
    expect(updateV3Res.status).toBe(200);

    // List all versions: default chronological (ascending)
    const versionsRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}/versions`,
    );
    expect(versionsRes.status).toBe(200);
    const versionsData = (await versionsRes.json()) as DocumentVersionsResponse;
    expect(versionsData.currentVersion).toBe(3);
    expect(versionsData.versions).toHaveLength(3);

    // Verify version numbers
    expect(versionsData.versions.map((v) => v.version)).toEqual([1, 2, 3]);

    // Verify savedBy metadata
    expect(versionsData.versions[0]?.savedBy.fullName).toBe("Dr. João Silva");
    expect(versionsData.versions[1]?.savedBy.fullName).toBe("Dra. Ana Santos");
    expect(versionsData.versions[2]?.savedBy.fullName).toBe("Dr. João Silva");

    // Verify isActiveVersion flags
    expect(versionsData.versions[0]?.isActiveVersion).toBe(false);
    expect(versionsData.versions[1]?.isActiveVersion).toBe(false);
    expect(versionsData.versions[2]?.isActiveVersion).toBe(true);

    // Verify ?order=desc: returns reverse chronological [3, 2, 1]
    const descVersionsRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}/versions?order=desc`,
    );
    expect(descVersionsRes.status).toBe(200);
    const descData = (await descVersionsRes.json()) as DocumentVersionsResponse;
    expect(descData.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(descData.versions[0]?.isActiveVersion).toBe(true);
    expect(descData.versions[1]?.isActiveVersion).toBe(false);
  });

  test("fetches specific historical version snapshot and verifies historical content remains frozen and immutable", async () => {
    const f = createFixture();

    // Create v1
    const createRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientA1Id,
        type: "PRESCRIPTION",
        title: "Receita Imutável v1",
        content: "Dipirona 500mg 1 comp 6/6h",
        variables: { med: "Dipirona", dose: "500mg" },
      },
      { userId: profAId },
    );
    expect(createRes.status).toBe(201);
    const v1Doc = (await createRes.json()) as DocumentResponse;
    const v1RevisionId = v1Doc.versions[0]?.id ?? "";

    // Update to v2
    const updateV2Res = await f.request(
      "PATCH",
      `/organizations/clinica-a/documents/${v1Doc.id}`,
      {
        version: 1,
        title: "Receita Modificada v2",
        content: "Ibuprofeno 400mg 1 comp 8/8h",
        variables: { med: "Ibuprofeno", dose: "400mg" },
      },
      { userId: profBId },
    );
    expect(updateV2Res.status).toBe(200);
    const v2Doc = (await updateV2Res.json()) as DocumentResponse;
    const v2Revision = v2Doc.versions.find((v) => v.version === 2);
    expect(v2Revision).toBeDefined();
    const v2RevisionId = v2Revision?.id ?? "";

    // Update to v3
    const updateV3Res = await f.request(
      "PATCH",
      `/organizations/clinica-a/documents/${v1Doc.id}`,
      {
        version: 2,
        title: "Receita Final v3",
        content: "Amoxicilina 500mg 1 comp 8/8h por 7 dias",
        variables: { med: "Amoxicilina", dose: "500mg" },
      },
      { userId: profAId },
    );
    expect(updateV3Res.status).toBe(200);

    // 1. Fetch historical v1 by revision UUID
    const getByUuidRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${v1Doc.id}/versions/${v1RevisionId}`,
    );
    expect(getByUuidRes.status).toBe(200);
    const v1Details =
      (await getByUuidRes.json()) as DocumentVersionDetailResponse;
    expect(v1Details.version).toBe(1);
    expect(v1Details.title).toBe("Receita Imutável v1");
    expect(v1Details.content).toBe("Dipirona 500mg 1 comp 6/6h");
    expect(v1Details.variables).toEqual({ med: "Dipirona", dose: "500mg" });
    expect(v1Details.savedBy.fullName).toBe("Dr. João Silva");
    expect(v1Details.isActiveVersion).toBe(false);
    expect(v1Details.snapshot.content).toBe("Dipirona 500mg 1 comp 6/6h");
    expect(v1Details.snapshot.variables).toEqual({
      med: "Dipirona",
      dose: "500mg",
    });

    // 2. Fetch historical v1 by version number "1"
    const getByNumRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${v1Doc.id}/versions/1`,
    );
    expect(getByNumRes.status).toBe(200);
    const v1ByNum = (await getByNumRes.json()) as DocumentVersionDetailResponse;
    expect(v1ByNum.version).toBe(1);
    expect(v1ByNum.content).toBe("Dipirona 500mg 1 comp 6/6h");

    // 3. Fetch historical v2 by revision UUID
    const getV2Res = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${v1Doc.id}/versions/${v2RevisionId}`,
    );
    expect(getV2Res.status).toBe(200);
    const v2Details = (await getV2Res.json()) as DocumentVersionDetailResponse;
    expect(v2Details.version).toBe(2);
    expect(v2Details.title).toBe("Receita Modificada v2");
    expect(v2Details.content).toBe("Ibuprofeno 400mg 1 comp 8/8h");
    expect(v2Details.savedBy.fullName).toBe("Dra. Ana Santos");
    expect(v2Details.isActiveVersion).toBe(false);

    // 4. Fetch current active v3 by version number "3"
    const getV3Res = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${v1Doc.id}/versions/3`,
    );
    expect(getV3Res.status).toBe(200);
    const v3Details = (await getV3Res.json()) as DocumentVersionDetailResponse;
    expect(v3Details.version).toBe(3);
    expect(v3Details.title).toBe("Receita Final v3");
    expect(v3Details.content).toBe("Amoxicilina 500mg 1 comp 8/8h por 7 dias");
    expect(v3Details.isActiveVersion).toBe(true);

    // 5. Non-existent version returns 404
    const notFoundRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${v1Doc.id}/versions/99`,
    );
    expect(notFoundRes.status).toBe(404);
  });

  test("enforces strict multi-tenant isolation across all document endpoints (404 NOT_FOUND)", async () => {
    const f = createFixture();
    f.setAllowedOrgSlugs(["clinica-a", "clinica-b"]);

    // Create document in Clinic A
    const createRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientA1Id,
        type: "REPORT",
        title: "Laudo Sigiloso Clínica A",
        content: "Dados confidenciais exclusivos da Clínica A.",
      },
    );
    expect(createRes.status).toBe(201);
    const docA = (await createRes.json()) as DocumentResponse;
    const versionAId = docA.versions[0]?.id ?? "";

    // Clinic B listing documents NEVER returns Clinic A documents
    const listFromB = await f.request(
      "GET",
      "/organizations/clinica-b/documents",
    );
    expect(listFromB.status).toBe(200);
    const listB = (await listFromB.json()) as ListDocumentsResponse;
    expect(listB.data).toHaveLength(0);

    // Clinic B trying to get document details of Clinic A -> 404 NOT_FOUND
    const getFromB = await f.request(
      "GET",
      `/organizations/clinica-b/documents/${docA.id}`,
    );
    expect(getFromB.status).toBe(404);

    // Clinic B trying to list versions of Clinic A document -> 404 NOT_FOUND
    const versionsFromB = await f.request(
      "GET",
      `/organizations/clinica-b/documents/${docA.id}/versions`,
    );
    expect(versionsFromB.status).toBe(404);

    // Clinic B trying to get historical version snapshot of Clinic A -> 404 NOT_FOUND
    const singleVersionFromB = await f.request(
      "GET",
      `/organizations/clinica-b/documents/${docA.id}/versions/${versionAId}`,
    );
    expect(singleVersionFromB.status).toBe(404);

    const versionNumFromB = await f.request(
      "GET",
      `/organizations/clinica-b/documents/${docA.id}/versions/1`,
    );
    expect(versionNumFromB.status).toBe(404);
  });

  test("enforces RBAC checks: user without documents:read denied with 403 PERMISSION_DENIED", async () => {
    const f = createFixture();

    const createRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientA1Id,
        type: "PRESCRIPTION",
        title: "Receita RBAC",
        content: "Dipirona 500mg",
      },
    );
    expect(createRes.status).toBe(201);
    const doc = (await createRes.json()) as DocumentResponse;
    const versionId = doc.versions[0]?.id ?? "";

    // 1. RECEPTIONIST role -> 403 on list, details, versions, snapshot
    f.setRole("RECEPTIONIST");

    const listAsReceptionist = await f.request(
      "GET",
      "/organizations/clinica-a/documents",
      undefined,
      { userId: receptionistId },
    );
    expect(listAsReceptionist.status).toBe(403);

    const getAsReceptionist = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}`,
      undefined,
      { userId: receptionistId },
    );
    expect(getAsReceptionist.status).toBe(403);

    const versionsAsReceptionist = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}/versions`,
      undefined,
      { userId: receptionistId },
    );
    expect(versionsAsReceptionist.status).toBe(403);

    const versionDetailAsReceptionist = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}/versions/${versionId}`,
      undefined,
      { userId: receptionistId },
    );
    expect(versionDetailAsReceptionist.status).toBe(403);

    // 2. ADMIN without clinical role -> 403
    f.setRole("ADMIN");

    const listAsAdmin = await f.request(
      "GET",
      "/organizations/clinica-a/documents",
      undefined,
      { userId: adminOnlyId },
    );
    expect(listAsAdmin.status).toBe(403);

    const getAsAdmin = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}`,
      undefined,
      { userId: adminOnlyId },
    );
    expect(getAsAdmin.status).toBe(403);

    // 3. ADMIN_PROFESSIONAL (with clinical eligibility) -> 200 OK
    f.setRole("ADMIN_PROFESSIONAL");

    const listAsAdminProf = await f.request(
      "GET",
      "/organizations/clinica-a/documents",
      undefined,
      { userId: profAId },
    );
    expect(listAsAdminProf.status).toBe(200);

    const getAsAdminProf = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}`,
      undefined,
      { userId: profAId },
    );
    expect(getAsAdminProf.status).toBe(200);

    // 4. Inactive membership -> 403 MEMBERSHIP_INACTIVE
    f.setMembershipStatus("INVITED");
    const getInactive = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}`,
      undefined,
      { userId: profAId },
    );
    expect(getInactive.status).toBe(403);
    expect(await getInactive.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });

    // 5. Unauthenticated request -> 401 UNAUTHENTICATED
    f.setMembershipStatus("ACTIVE");
    const getUnauth = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${doc.id}`,
      undefined,
      { authenticated: false },
    );
    expect(getUnauth.status).toBe(401);
  });
});
