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
import type { PrepareDocumentSnapshotResponse } from "../src/modules/documents/model";
import { signSessionToken } from "../src/services/session-token";

const secret = "document-snapshot-test-secret-32c!!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const profAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const profBId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const patientAId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const patientBId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

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

interface StoredUser {
  id: string;
  fullName: string;
  registrationNumber: string | null;
  professionalTitle: string | null;
}

interface StoredOrganization {
  id: string;
  name: string;
  slug: string;
  taxId: string | null;
  street: string | null;
  streetNumber: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  contactPhone: string | null;
}

interface StoredPatient {
  id: string;
  organizationId: string;
  fullName: string;
  cpf: string | null;
  birthDate: Date | string | null;
}

function createFixture() {
  let role: MembershipRole = "PROFESSIONAL";
  let membershipStatus: MembershipStatus = "ACTIVE";
  let allowedOrgSlugs = new Set<string>(["clinica-a"]);
  let sessionActive = true;

  const users: StoredUser[] = [
    {
      id: profAId,
      fullName: "Dra. Ana Oliveira",
      registrationNumber: "CRM/SP 123456",
      professionalTitle: "Médica Cardiologista",
    },
    {
      id: profBId,
      fullName: "Dr. Bruno Santos",
      registrationNumber: "CRM/RJ 654321",
      professionalTitle: "Médico Clínico Geral",
    },
  ];

  const organizations: StoredOrganization[] = [
    {
      id: clinicAId,
      name: "Clínica Vida & Saúde",
      slug: "clinica-a",
      taxId: "12.345.678/0001-90",
      street: "Av. Paulista",
      streetNumber: "1000",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      contactPhone: "(11) 98765-4321",
    },
    {
      id: clinicBId,
      name: "Clínica Norte",
      slug: "clinica-b",
      taxId: "98.765.432/0001-10",
      street: "Rua das Flores",
      streetNumber: "50",
      district: "Centro",
      city: "Rio de Janeiro",
      state: "RJ",
      contactPhone: "(21) 91234-5678",
    },
  ];

  const patients: StoredPatient[] = [
    {
      id: patientAId,
      organizationId: clinicAId,
      fullName: "Maria da Silva",
      cpf: "123.456.789-00",
      birthDate: new Date("1985-05-20T00:00:00.000Z"),
    },
    {
      id: patientBId,
      organizationId: clinicBId,
      fullName: "João Oliveira",
      cpf: "987.654.321-11",
      birthDate: new Date("1990-10-15T00:00:00.000Z"),
    },
  ];

  const templates: StoredTemplate[] = [];
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
        const u = users.find((x) => x.id === where.id);
        return u ? { ...u } : null;
      },
    },
    organization: {
      findFirst: async ({ where }: { where: { id: string } }) => {
        const org = organizations.find((x) => x.id === where.id);
        return org ? { ...org } : null;
      },
    },
    patient: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId?: string };
      }) => {
        const p = patients.find(
          (x) =>
            x.id === where.id &&
            (where.organizationId === undefined ||
              x.organizationId === where.organizationId),
        );
        return p ? { ...p } : null;
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
    users,
    organizations,
    patients,
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
  };
}

describe("Document emission snapshot module (#274)", () => {
  test("prepares snapshot for each of the 4 MVP types (PRESCRIPTION, CERTIFICATE, REPORT, EXAM_REQUEST)", async () => {
    const f = createFixture();

    const types: DocumentType[] = [
      "PRESCRIPTION",
      "CERTIFICATE",
      "REPORT",
      "EXAM_REQUEST",
    ];

    for (let i = 0; i < types.length; i++) {
      const type = types[i]!;
      // 1. Create draft
      const draftRes = await f.request(
        "POST",
        "/organizations/clinica-a/documents",
        {
          patientId: patientAId,
          type,
          title: `Documento MVP ${type}`,
          content: `Conteúdo para ${type}: Paciente {paciente_nome}, Clínica {clinica_nome}, CRM {profissional_crm}.`,
        },
      );
      expect(draftRes.status).toBe(201);
      const draftBody = (await draftRes.json()) as {
        id: string;
        version: number;
      };
      const docId = draftBody.id;
      expect(draftBody.version).toBe(1);

      // 2. Prepare snapshot using /snapshot or /prepare (alternate endpoint)
      const endpoint =
        i % 2 === 0
          ? `/organizations/clinica-a/documents/${docId}/snapshot`
          : `/organizations/clinica-a/documents/${docId}/prepare`;

      const snapshotRes = await f.request("POST", endpoint, {});
      expect(snapshotRes.status).toBe(200);

      const snapshotBody =
        (await snapshotRes.json()) as PrepareDocumentSnapshotResponse;

      expect(snapshotBody.id).toBe(docId);
      expect(snapshotBody.version).toBe(2);
      expect(snapshotBody.status).toBe("DRAFT");
      expect(snapshotBody.snapshot).toBeDefined();
      expect(snapshotBody.snapshot.documentId).toBe(docId);
      expect(snapshotBody.snapshot.version).toBe(2);
      expect(snapshotBody.snapshot.type).toBe(type);

      // Verify content was resolved and frozen
      expect(snapshotBody.snapshot.content).toContain("Maria da Silva");
      expect(snapshotBody.snapshot.content).toContain("Clínica Vida & Saúde");
      expect(snapshotBody.snapshot.content).toContain("CRM/SP 123456");
      expect(snapshotBody.snapshot.content).not.toContain("{paciente_nome}");
      expect(snapshotBody.snapshot.content).not.toContain("{clinica_nome}");
      expect(snapshotBody.snapshot.content).not.toContain("{profissional_crm}");

      // Verify snapshot variables
      expect(snapshotBody.snapshot.variables.paciente_nome).toBe(
        "Maria da Silva",
      );
      expect(snapshotBody.snapshot.variables.clinica_nome).toBe(
        "Clínica Vida & Saúde",
      );
      expect(snapshotBody.snapshot.variables.profissional_nome).toBe(
        "Dra. Ana Oliveira",
      );
      expect(snapshotBody.snapshot.variables.profissional_crm).toBe(
        "CRM/SP 123456",
      );
      expect(snapshotBody.snapshot.variables.data_emissao).toBeDefined();

      // Verify DocumentVersion revision was persisted
      const docVersions = f.versions.filter((v) => v.documentId === docId);
      expect(docVersions.length).toBe(2);
      const latestVersion = docVersions.find((v) => v.version === 2);
      expect(latestVersion).toBeDefined();
      expect(latestVersion?.content).toBe(snapshotBody.snapshot.content);

      // Verify AuditLog was recorded
      const snapshotLog = f.auditLogs.find(
        (l) =>
          l.targetId === docId && l.action === "DOCUMENT_SNAPSHOT_PREPARED",
      );
      expect(snapshotLog).toBeDefined();
      expect(
        (snapshotLog?.metadata as Record<string, unknown>)?.newVersion,
      ).toBe(2);
      expect((snapshotLog?.metadata as Record<string, unknown>)?.type).toBe(
        type,
      );
    }
  });

  test("freezes automatic variables and verifies subsequent changes to patient name do NOT affect frozen snapshot", async () => {
    const f = createFixture();

    // Create draft with template placeholders
    const draftRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "PRESCRIPTION",
        title: "Receita de Controle",
        content:
          "Prescrição médica para {paciente_nome}, CPF {paciente_cpf}, emitida por {profissional_nome} ({profissional_crm}) em {data_emissao} na {clinica_nome}.",
      },
    );
    expect(draftRes.status).toBe(201);
    const draft = (await draftRes.json()) as { id: string };

    // Prepare snapshot
    const snapRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft.id}/snapshot`,
    );
    expect(snapRes.status).toBe(200);
    const snapData = (await snapRes.json()) as PrepareDocumentSnapshotResponse;

    const frozenContent = snapData.snapshot.content;
    expect(frozenContent).toContain("Maria da Silva");
    expect(frozenContent).toContain("123.456.789-00");
    expect(frozenContent).toContain("Dra. Ana Oliveira");
    expect(frozenContent).toContain("CRM/SP 123456");
    expect(snapData.snapshot.variables.paciente_nome).toBe("Maria da Silva");

    // Mutate the patient's record after snapshot was prepared
    const patientRecord = f.patients.find((p) => p.id === patientAId);
    expect(patientRecord).toBeDefined();
    if (patientRecord) {
      patientRecord.fullName = "Maria da Silva Pereira Alterada";
      patientRecord.cpf = "000.000.000-00";
    }

    // Also mutate the organization name
    const orgRecord = f.organizations.find((o) => o.id === clinicAId);
    if (orgRecord) {
      orgRecord.name = "Novo Nome da Clínica Hospitalar";
    }

    // Retrieve document again via GET
    const getRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${draft.id}`,
    );
    expect(getRes.status).toBe(200);
    const getDoc = (await getRes.json()) as {
      content: string;
      variables: Record<string, unknown>;
    };

    // The document must retain the FROZEN content and variables
    expect(getDoc.content).toBe(frozenContent);
    expect(getDoc.content).toContain("Maria da Silva");
    expect(getDoc.content).not.toContain("Maria da Silva Pereira Alterada");
    expect(getDoc.variables.paciente_nome).toBe("Maria da Silva");
    expect(getDoc.content).toContain("Clínica Vida & Saúde");
    expect(getDoc.content).not.toContain("Novo Nome da Clínica Hospitalar");

    // Check version list
    const versionsRes = await f.request(
      "GET",
      `/organizations/clinica-a/documents/${draft.id}/versions`,
    );
    expect(versionsRes.status).toBe(200);
    const versionsData = (await versionsRes.json()) as {
      versions: Array<{ content: string; variables: Record<string, unknown> }>;
    };
    const v2 = versionsData.versions.find((v) => v.content === frozenContent);
    expect(v2).toBeDefined();
    expect(v2?.variables.paciente_nome).toBe("Maria da Silva");
  });

  test("empty optional variables do not appear in snapshot variables dictionary and placeholders are replaced with empty string", async () => {
    const f = createFixture();

    // Patient without CPF
    const patientWithoutCpf = f.patients.find((p) => p.id === patientAId);
    if (patientWithoutCpf) {
      patientWithoutCpf.cpf = null;
    }

    const draftRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "CERTIFICATE",
        title: "Atestado sem CPF",
        content:
          "Atesto que {paciente_nome}, CPF: {paciente_cpf}, esteve em consulta.",
      },
    );
    expect(draftRes.status).toBe(201);
    const draft = (await draftRes.json()) as { id: string };

    const snapRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft.id}/snapshot`,
    );
    expect(snapRes.status).toBe(200);
    const snapData = (await snapRes.json()) as PrepareDocumentSnapshotResponse;

    // Optional empty variable should NOT appear in variables dictionary
    expect(snapData.snapshot.variables.paciente_cpf).toBeUndefined();
    expect(snapData.snapshot.variables.paciente_nome).toBe("Maria da Silva");

    // Placeholder {paciente_cpf} in text should be replaced with empty string
    expect(snapData.snapshot.content).toBe(
      "Atesto que Maria da Silva, CPF: , esteve em consulta.",
    );
    expect(snapData.snapshot.content).not.toContain("{paciente_cpf}");
  });

  test("rejects missing required fields with structured list (422 VALIDATION_ERROR)", async () => {
    const f = createFixture();

    // Case 1: Author registrationNumber is missing
    const authorUser = f.users.find((u) => u.id === profAId);
    expect(authorUser).toBeDefined();
    if (authorUser) {
      authorUser.registrationNumber = null;
    }

    const draftRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "PRESCRIPTION",
        title: "Receita Teste",
        content: "Conteúdo com {paciente_nome} e {profissional_crm}",
      },
    );
    expect(draftRes.status).toBe(201);
    const draft = (await draftRes.json()) as { id: string };

    const snapRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft.id}/snapshot`,
    );
    expect(snapRes.status).toBe(422);
    const errBody = (await snapRes.json()) as {
      error: { code: string; details?: { missingFields?: string[] } };
    };
    expect(errBody.error.code).toBe("VALIDATION_ERROR");
    expect(errBody.error.details?.missingFields).toBeDefined();
    expect(errBody.error.details?.missingFields).toContain("profissional_crm");

    // Case 2: Patient fullName is also missing
    const patientRecord = f.patients.find((p) => p.id === patientAId);
    if (patientRecord) {
      patientRecord.fullName = "   ";
    }

    const snapRes2 = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft.id}/snapshot`,
    );
    expect(snapRes2.status).toBe(422);
    const errBody2 = (await snapRes2.json()) as {
      error: { code: string; details?: { missingFields?: string[] } };
    };
    expect(errBody2.error.code).toBe("VALIDATION_ERROR");
    expect(errBody2.error.details?.missingFields).toContain("profissional_crm");
    expect(errBody2.error.details?.missingFields).toContain("paciente_nome");
  });

  test("rejects unknown variables outside APPROVED_TEMPLATE_VARIABLES catalog with 422 INVALID_VARIABLES", async () => {
    const f = createFixture();

    // Draft containing unknown placeholder in content
    const draftRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "PRESCRIPTION",
        title: "Receita com Variável Inválida",
        content:
          "Receita para {paciente_nome} com variável desconhecida {campo_desconhecido} e {variavel_proibida}.",
      },
    );
    expect(draftRes.status).toBe(201);
    const draft = (await draftRes.json()) as { id: string };

    const snapRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft.id}/snapshot`,
    );
    expect(snapRes.status).toBe(422);
    const errBody = (await snapRes.json()) as {
      error: { code: string; details?: { invalidVariables?: string[] } };
    };
    expect(errBody.error.code).toBe("INVALID_VARIABLES");
    expect(errBody.error.details?.invalidVariables).toContain(
      "campo_desconhecido",
    );
    expect(errBody.error.details?.invalidVariables).toContain(
      "variavel_proibida",
    );

    // Also test unknown variable passed in request body
    const draft2Res = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "CERTIFICATE",
        title: "Atestado Válido",
        content: "Atesto que {paciente_nome} compareceu.",
      },
    );
    const draft2 = (await draft2Res.json()) as { id: string };

    const snapRes2 = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft2.id}/snapshot`,
      {
        variables: {
          outro_campo_invalido: "valor",
        },
      },
    );
    expect(snapRes2.status).toBe(422);
    const errBody2 = (await snapRes2.json()) as {
      error: { code: string; details?: { invalidVariables?: string[] } };
    };
    expect(errBody2.error.code).toBe("INVALID_VARIABLES");
    expect(errBody2.error.details?.invalidVariables).toContain(
      "outro_campo_invalido",
    );
  });

  test("rejects snapshot on non-DRAFT documents (409 DOCUMENT_NOT_EDITABLE)", async () => {
    const f = createFixture();

    const draftRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "REPORT",
        title: "Laudo Clínico",
        content: "Laudo para {paciente_nome}.",
      },
    );
    expect(draftRes.status).toBe(201);
    const draft = (await draftRes.json()) as { id: string };

    // Simulate document transitioning to ISSUED
    const docRecord = f.documents.find((d) => d.id === draft.id);
    expect(docRecord).toBeDefined();
    if (docRecord) {
      docRecord.status = "ISSUED";
      docRecord.issuedAt = new Date();
    }

    const snapRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft.id}/snapshot`,
    );
    expect(snapRes.status).toBe(409);
    const errBody = (await snapRes.json()) as {
      error: { code: string; details?: { reason?: string } };
    };
    expect(errBody.error.code).toBe("DOCUMENT_NOT_EDITABLE");
    expect(errBody.error.details?.reason).toBe("DOCUMENT_NOT_EDITABLE");

    // Simulate document transitioning to VOIDED
    if (docRecord) {
      docRecord.status = "VOIDED";
      docRecord.voidedAt = new Date();
    }

    const snapResVoided = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft.id}/snapshot`,
    );
    expect(snapResVoided.status).toBe(409);
    const errBodyVoided = (await snapResVoided.json()) as {
      error: { code: string };
    };
    expect(errBodyVoided.error.code).toBe("DOCUMENT_NOT_EDITABLE");
  });

  test("rejects unsupported document types (CONTROLLED_PRESCRIPTION or custom type) with 422", async () => {
    const f = createFixture();

    const draftRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "PRESCRIPTION",
        title: "Receita Simples",
        content: "Conteúdo {paciente_nome}.",
      },
    );
    expect(draftRes.status).toBe(201);
    const draft = (await draftRes.json()) as { id: string };

    // Attempt to prepare with CONTROLLED_PRESCRIPTION override
    const snapRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft.id}/snapshot`,
      {
        type: "CONTROLLED_PRESCRIPTION",
      },
    );
    expect(snapRes.status).toBe(422);
    const errBody = (await snapRes.json()) as {
      error: { code: string; details?: { reason?: string } };
    };
    expect(errBody.error.code).toBe("BUSINESS_RULE_VIOLATION");
    expect(errBody.error.details?.reason).toBe("UNSUPPORTED_DOCUMENT_TYPE");

    // Also test if document in DB somehow had an unsupported type
    const docRecord = f.documents.find((d) => d.id === draft.id);
    if (docRecord) {
      docRecord.type = "CONTROLLED_PRESCRIPTION" as DocumentType;
    }
    const snapRes2 = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft.id}/snapshot`,
    );
    expect(snapRes2.status).toBe(422);
  });

  test("enforces cross-clinic isolation (404 NOT_FOUND) and RBAC checks (403 PERMISSION_DENIED)", async () => {
    const f = createFixture();

    // Create document in clinic B
    f.setAllowedOrgSlugs(["clinica-a", "clinica-b"]);
    const draftBRes = await f.request(
      "POST",
      "/organizations/clinica-b/documents",
      {
        patientId: patientBId,
        type: "REPORT",
        title: "Laudo Clínica B",
        content: "Laudo exclusivo Clínica B para {paciente_nome}.",
      },
      { userId: profBId },
    );
    expect(draftBRes.status).toBe(201);
    const draftB = (await draftBRes.json()) as { id: string };

    // Request from clinica-a attempting to access document from clinica-b
    const crossRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draftB.id}/snapshot`,
    );
    expect(crossRes.status).toBe(404);

    // Create document in clinic A
    const draftARes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "CERTIFICATE",
        title: "Atestado Clínica A",
        content: "Atestado para {paciente_nome}.",
      },
    );
    expect(draftARes.status).toBe(201);
    const draftA = (await draftARes.json()) as { id: string };

    // RECEPTIONIST role trying to prepare snapshot
    f.setRole("RECEPTIONIST");
    const recRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draftA.id}/snapshot`,
    );
    expect(recRes.status).toBe(403);
    const recBody = (await recRes.json()) as {
      error: { code: string; details?: { requiredPermission?: string } };
    };
    expect(recBody.error.code).toBe("PERMISSION_DENIED");

    // ADMIN (dono da clínica) acumula o papel clínico e pode preparar snapshot
    f.setRole("ADMIN");
    const adminRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draftA.id}/snapshot`,
    );
    expect(adminRes.status).toBe(200);

    // ADMIN_PROFESSIONAL role succeeds
    f.setRole("ADMIN_PROFESSIONAL");
    const adminProfRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draftA.id}/snapshot`,
    );
    expect(adminProfRes.status).toBe(200);
  });

  test("enforces optimistic concurrency control when version is provided in body", async () => {
    const f = createFixture();

    const draftRes = await f.request(
      "POST",
      "/organizations/clinica-a/documents",
      {
        patientId: patientAId,
        type: "PRESCRIPTION",
        title: "Receita Concorrente",
        content: "Conteúdo {paciente_nome}.",
      },
    );
    const draft = (await draftRes.json()) as { id: string; version: number };
    expect(draft.version).toBe(1);

    // Snapshot with conflicting version 99
    const conflictRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft.id}/snapshot`,
      {
        version: 99,
      },
    );
    expect(conflictRes.status).toBe(409);
    const conflictBody = (await conflictRes.json()) as {
      error: { code: string };
    };
    expect(conflictBody.error.code).toBe("VERSION_CONFLICT");

    // Snapshot with correct version 1 succeeds
    const successRes = await f.request(
      "POST",
      `/organizations/clinica-a/documents/${draft.id}/snapshot`,
      {
        version: 1,
      },
    );
    expect(successRes.status).toBe(200);
    const successBody = (await successRes.json()) as { version: number };
    expect(successBody.version).toBe(2);
  });
});
