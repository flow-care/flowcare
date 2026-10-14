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
import {
  createDocumentPdfService,
  type DocumentPdfRenderInput,
  MemoryDocumentPdfStore,
  renderClinicalDocumentPdf,
} from "../src/services/document-pdf";
import { signSessionToken } from "../src/services/session-token";

const secret = "document-pdf-test-secret-32c!!";
const clinicAId = "11111111-1111-4111-8111-111111111111";
const clinicBId = "22222222-2222-4222-8222-222222222222";

const profAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const profBId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const receptAId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const patientAId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const patientBId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

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
  preparedRevisionId: string | null;
  replacesDocumentId: string | null;
  chainVersion: number;
  snapshotHash: string | null;
  pdfObjectKey: string | null;
  issuedById: string | null;
  issuedAt: Date | null;
  voidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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

interface StoredMembership {
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
  status: MembershipStatus;
}

function createPdfFixture() {
  const users: StoredUser[] = [
    {
      id: profAId,
      fullName: "Dra. Ana Oliveira",
      registrationNumber: "CRM/SP 123456",
      professionalTitle: "Médica Cardiologista",
    },
    {
      id: profBId,
      fullName: "Dr. Bernardo Silva",
      registrationNumber: "CRM/RJ 654321",
      professionalTitle: "Médico Geral",
    },
    {
      id: receptAId,
      fullName: "Carla Recepcionista",
      registrationNumber: null,
      professionalTitle: null,
    },
  ];

  const organizations: StoredOrganization[] = [
    {
      id: clinicAId,
      name: "Clínica Vida & Saúde",
      slug: "clinica-vida",
      taxId: "12.345.678/0001-90",
      street: "Avenida Paulista",
      streetNumber: "1000",
      district: "Bela Vista",
      city: "São Paulo",
      state: "SP",
      contactPhone: "(11) 3333-4444",
    },
    {
      id: clinicBId,
      name: "Clínica Boa Esperança",
      slug: "clinica-boa",
      taxId: "98.765.432/0001-10",
      street: "Rua das Flores",
      streetNumber: "50",
      district: "Centro",
      city: "Rio de Janeiro",
      state: "RJ",
      contactPhone: "(21) 2222-3333",
    },
  ];

  const patients: StoredPatient[] = [
    {
      id: patientAId,
      organizationId: clinicAId,
      fullName: "João da Silva Sauro",
      cpf: "123.456.789-00",
      birthDate: "1985-05-15",
    },
    {
      id: patientBId,
      organizationId: clinicBId,
      fullName: "Maria dos Santos",
      cpf: "987.654.321-11",
      birthDate: "1990-08-20",
    },
  ];

  const memberships: StoredMembership[] = [
    {
      id: "mem-prof-a",
      userId: profAId,
      organizationId: clinicAId,
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-prof-b",
      userId: profBId,
      organizationId: clinicBId,
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-recept-a",
      userId: receptAId,
      organizationId: clinicAId,
      role: "RECEPTIONIST",
      status: "ACTIVE",
    },
  ];

  const documents: StoredDocument[] = [];
  const versions: StoredVersion[] = [];
  const audits: Array<{ action: string; targetId: string }> = [];

  const pdfStore = new MemoryDocumentPdfStore();
  const pdfService = createDocumentPdfService(undefined, pdfStore);

  const prisma = {
    user: {
      findFirst: async ({ where }: { where: { id: string } }) =>
        users.find((u) => u.id === where.id) ?? null,
    },
    organization: {
      findFirst: async ({ where }: { where: { id?: string; slug?: string } }) =>
        organizations.find(
          (o) =>
            (where.id ? o.id === where.id : true) &&
            (where.slug ? o.slug === where.slug : true),
        ) ?? null,
      findUnique: async ({ where }: { where: { slug: string } }) =>
        organizations.find((o) => o.slug === where.slug) ?? null,
    },
    patient: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId?: string };
      }) =>
        patients.find(
          (p) =>
            p.id === where.id &&
            (where.organizationId
              ? p.organizationId === where.organizationId
              : true),
        ) ?? null,
    },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: {
          userId: string;
          organizationId?: string;
          organization?: { slug: string };
        };
      }) => {
        let orgId = where.organizationId;
        if (!orgId && where.organization?.slug) {
          const org = organizations.find(
            (o) => o.slug === where.organization?.slug,
          );
          orgId = org?.id;
        }
        return (
          memberships.find(
            (m) =>
              m.userId === where.userId &&
              (orgId ? m.organizationId === orgId : true),
          ) ?? null
        );
      },
    },
    session: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; userId: string };
      }) => ({
        id: where.id,
        userId: where.userId,
        lastActiveAt: new Date(),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 3600 * 1000),
      }),
      updateMany: async () => ({ count: 1 }),
    },
    clinicalDocument: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) => {
        const doc = documents.find(
          (d) => d.id === where.id && d.organizationId === where.organizationId,
        );
        if (!doc) return null;
        return {
          ...doc,
          patient: patients.find((p) => p.id === doc.patientId) ?? null,
          author: users.find((u) => u.id === doc.authorId) ?? null,
          versions: versions
            .filter((v) => v.documentId === doc.id)
            .sort((a, b) => a.version - b.version),
        };
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
          currentRevisionId?: string;
        };
        data: Record<string, unknown>;
      }) => {
        const doc = documents.find(
          (d) =>
            d.id === where.id &&
            d.organizationId === where.organizationId &&
            (where.status ? d.status === where.status : true) &&
            (where.version !== undefined ? d.version === where.version : true),
        );
        if (!doc) return { count: 0 };
        Object.assign(doc, data);
        return { count: 1 };
      },
      create: async ({ data }: { data: StoredDocument }) => {
        const created = { ...data, id: data.id || crypto.randomUUID() };
        documents.push(created);
        return created;
      },
    },
    documentVersion: {
      findFirst: async ({
        where,
      }: {
        where: { id?: string; documentId?: string; organizationId?: string };
      }) =>
        versions.find(
          (v) =>
            (where.id ? v.id === where.id : true) &&
            (where.documentId ? v.documentId === where.documentId : true) &&
            (where.organizationId
              ? v.organizationId === where.organizationId
              : true),
        ) ?? null,
      create: async ({ data }: { data: StoredVersion }) => {
        const created = { ...data, id: data.id || crypto.randomUUID() };
        versions.push(created);
        return created;
      },
    },
    auditLog: {
      create: async ({
        data,
      }: {
        data: { action: string; targetId: string };
      }) => {
        audits.push(data);
        return data;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
    $queryRaw: async () => [{ 1: 1 }],
  } as unknown as PrismaClient;

  const env: Env = {
    port: 3000,
    nodeEnv: "test",
    version: "0.1.0",
    jwtSecret: secret,
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/test",
    corsOrigin: "http://localhost:3000",
    trustProxy: false,
    wahaBaseUrl: "http://localhost:3001",
    wahaApiKey: null,
    webAppUrl: "http://localhost:3000",
    mailProvider: "disabled",
    sesRegion: null,
    mailFrom: null,
  };

  const app = createApp(env, {
    prisma,
    mailer: { send: async () => {} } as unknown as never,
    documentPdfService: pdfService,
  });

  return {
    app,
    prisma,
    pdfStore,
    pdfService,
    documents,
    versions,
    patients,
    users,
    memberships,
    audits,
  };
}

function extractPdfText(pdfRaw: string): string {
  const hexMatches = pdfRaw.matchAll(/<([0-9a-fA-F]+)>/g);
  let text = "";
  for (const match of hexMatches) {
    const hexStr = match[1] ?? "";
    text += `${Buffer.from(hexStr, "hex").toString("latin1")}\n`;
  }
  return text;
}

describe("Document PDF generation and download (#276)", () => {
  test("unit: renderClinicalDocumentPdf generates standard A4 PDF with faithful snapshot content", () => {
    const input: DocumentPdfRenderInput = {
      organizationId: clinicAId,
      documentId: "00000000-0000-4000-8000-000000000001",
      title: "Receita Simples de Amoxicilina",
      type: "PRESCRIPTION",
      content:
        "1. Amoxicilina 500mg — Tomar 1 cápsula via oral a cada 8 horas por 7 dias consecutivamente.\n2. Paracetamol 750mg — Tomar 1 comprimido se houver dor ou febre até de 6 em 6 horas.",
      snapshotHash: "sha256_mock_hash_for_testing_1234567890abcdef",
      chainVersion: 1,
      variables: {
        clinica_nome: "Clínica Vida & Saúde",
        clinica_cnpj: "12.345.678/0001-90",
        clinica_endereco: "Avenida Paulista, 1000, São Paulo/SP",
        clinica_telefone: "(11) 3333-4444",
        paciente_nome: "João da Silva Sauro",
        paciente_cpf: "123.456.789-00",
        paciente_data_nascimento: "15/05/1985",
        profissional_nome: "Dra. Ana Oliveira",
        profissional_registro: "CRM/SP 123456",
        profissional_titulo: "Médica Cardiologista",
        data_emissao: "14/10/2026",
      },
    };

    const bytes = renderClinicalDocumentPdf(input);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(500);

    const pdfString = Buffer.from(bytes).toString("latin1");
    // PDF structure
    expect(pdfString).toStartWith("%PDF-1.4");
    expect(pdfString).toEndWith("%%EOF\n");
    expect(pdfString).toContain("/Type /Catalog");
    expect(pdfString).toContain("/Type /Pages");
    expect(pdfString).toContain("/Type /Page");
    expect(pdfString).toContain("/BaseFont /Helvetica");
    expect(pdfString).toContain("/BaseFont /Helvetica-Bold");

    const text = extractPdfText(pdfString);
    // Mandatory disclaimer for manual signature
    expect(text).toContain("DOCUMENTO DESTINADO EXCLUSIVAMENTE");
    expect(text).toContain("IMPRESSÃO E ASSINATURA MANUSCRITA");
    expect(text).toContain("ICP-Brasil");

    // Faithful content
    expect(text).toContain("Clínica Vida & Saúde");
    expect(text).toContain("João da Silva Sauro");
    expect(text).toContain("Dra. Ana Oliveira");
    expect(text).toContain("CRM/SP 123456");
    expect(text).toContain("Amoxicilina 500mg");

    // Integrity hash & metadata
    expect(text).toContain("sha256_mock_hash_for_testing");
    expect(text).toContain("00000000-0000-4000-8000-000000000001");
  });

  test("unit: renderClinicalDocumentPdf wraps multi-page documents and numbers pages correctly", () => {
    // Generate long content that forces multiple pages
    const paragraphs: string[] = [];
    for (let i = 1; i <= 35; i++) {
      paragraphs.push(
        `Item ${i}: Descrição clínica detalhada do procedimento realizado, observações pertinentes ao quadro e prescrição de cuidados contínuos com acompanhamento ambulatorial regular.`,
      );
    }
    const longContent = paragraphs.join("\n\n");

    const input: DocumentPdfRenderInput = {
      organizationId: clinicAId,
      documentId: "00000000-0000-4000-8000-000000000002",
      title: "Laudo Pericial Extenso",
      type: "REPORT",
      content: longContent,
      snapshotHash: "sha256_long_report_hash",
      chainVersion: 1,
      variables: {
        clinica_nome: "Clínica Vida & Saúde",
        paciente_nome: "João da Silva Sauro",
        profissional_nome: "Dra. Ana Oliveira",
        profissional_registro: "CRM/SP 123456",
        data_emissao: "14/10/2026",
      },
    };

    const bytes = renderClinicalDocumentPdf(input);
    const pdfString = Buffer.from(bytes).toString("latin1");

    // Must have at least 2 pages
    const countMatch = pdfString.match(/\/Count (\d+)/);
    expect(countMatch).not.toBeNull();
    const count = Number.parseInt(countMatch?.[1] ?? "0", 10);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("integration: generates PDF on document issue and allows download via GET /organizations/:orgSlug/documents/:id/pdf", async () => {
    const f = createPdfFixture();

    const docId = "00000000-0000-4000-8000-000000000010";
    const revId = "00000000-0000-4000-8000-000000000011";
    const now = new Date();

    // Create draft with prepared snapshot
    f.documents.push({
      id: docId,
      organizationId: clinicAId,
      patientId: patientAId,
      authorId: profAId,
      templateId: null,
      templateVersion: null,
      type: "PRESCRIPTION",
      title: "Receita Emitida",
      content: "Amoxicilina 500mg 8/8h por 7 dias.",
      variables: {
        clinica_nome: "Clínica Vida & Saúde",
        clinica_cnpj: "12.345.678/0001-90",
        paciente_nome: "João da Silva Sauro",
        paciente_cpf: "123.456.789-00",
        profissional_nome: "Dra. Ana Oliveira",
        profissional_registro: "CRM/SP 123456",
        data_emissao: "14/10/2026",
      },
      status: "DRAFT",
      version: 2,
      currentRevisionId: revId,
      preparedRevisionId: revId,
      replacesDocumentId: null,
      chainVersion: 1,
      snapshotHash: null,
      pdfObjectKey: null,
      issuedById: null,
      issuedAt: null,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    f.versions.push({
      id: revId,
      documentId: docId,
      organizationId: clinicAId,
      version: 2,
      title: "Receita Emitida",
      content: "Amoxicilina 500mg 8/8h por 7 dias.",
      variables: {
        clinica_nome: "Clínica Vida & Saúde",
        clinica_cnpj: "12.345.678/0001-90",
        paciente_nome: "João da Silva Sauro",
        paciente_cpf: "123.456.789-00",
        profissional_nome: "Dra. Ana Oliveira",
        profissional_registro: "CRM/SP 123456",
        data_emissao: "14/10/2026",
      },
      templateId: null,
      templateVersion: null,
      savedById: profAId,
      createdAt: now,
    });

    const token = signSessionToken(
      { sub: profAId, sid: "sess-prof-a" },
      secret,
      3600,
    );

    // 1. Issue the document
    const issueRes = await f.app.handle(
      new Request(
        `http://localhost/api/organizations/clinica-vida/documents/${docId}/issue`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      ),
    );
    expect(issueRes.status).toBe(200);
    const issueBody = (await issueRes.json()) as {
      status: string;
      snapshotHash: string;
    };
    expect(issueBody.status).toBe("ISSUED");
    expect(issueBody.snapshotHash).toStartWith("sha256_");

    // Check that PDF was stored in storage bucket
    const expectedKey = `organizations/${clinicAId}/pdf/${docId}.pdf`;
    const storedBytes = await f.pdfStore.get(expectedKey);
    expect(storedBytes).not.toBeNull();
    expect(storedBytes?.length).toBeGreaterThan(500);

    // 2. Download the generated PDF
    const downloadRes = await f.app.handle(
      new Request(
        `http://localhost/api/organizations/clinica-vida/documents/${docId}/pdf`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      ),
    );

    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("content-type")).toBe("application/pdf");
    expect(downloadRes.headers.get("content-disposition")).toBe(
      `inline; filename="documento-${docId}.pdf"`,
    );

    const pdfBuffer = await downloadRes.arrayBuffer();
    expect(pdfBuffer.byteLength).toBeGreaterThan(500);
    const pdfContent = Buffer.from(pdfBuffer).toString("latin1");
    expect(pdfContent).toStartWith("%PDF-1.4");
    const downloadedText = extractPdfText(pdfContent);
    expect(downloadedText).toContain("sha256_");
    expect(downloadedText).toContain("DOCUMENTO DESTINADO EXCLUSIVAMENTE");
  });

  test("integration: rejects PDF download for DRAFT documents with HTTP 409", async () => {
    const f = createPdfFixture();

    const docId = "00000000-0000-4000-8000-000000000020";
    const now = new Date();

    f.documents.push({
      id: docId,
      organizationId: clinicAId,
      patientId: patientAId,
      authorId: profAId,
      templateId: null,
      templateVersion: null,
      type: "CERTIFICATE",
      title: "Atestado em Rascunho",
      content: "Atesto repouso por 2 dias.",
      variables: {},
      status: "DRAFT",
      version: 1,
      currentRevisionId: "rev-20",
      preparedRevisionId: null,
      replacesDocumentId: null,
      chainVersion: 1,
      snapshotHash: null,
      pdfObjectKey: null,
      issuedById: null,
      issuedAt: null,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const token = signSessionToken(
      { sub: profAId, sid: "sess-prof-a" },
      secret,
      3600,
    );

    const res = await f.app.handle(
      new Request(
        `http://localhost/api/organizations/clinica-vida/documents/${docId}/pdf`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      ),
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("DOCUMENT_STATE_CONFLICT");
    expect(body.error.message).toContain("rascunho");
  });

  test("integration: strictly enforces multi-tenant clinic isolation (foreign clinic gets 404)", async () => {
    const f = createPdfFixture();

    const docId = "00000000-0000-4000-8000-000000000030";
    const now = new Date();

    // Document belongs to Clinic A
    f.documents.push({
      id: docId,
      organizationId: clinicAId,
      patientId: patientAId,
      authorId: profAId,
      templateId: null,
      templateVersion: null,
      type: "REPORT",
      title: "Laudo Clínico da Clínica A",
      content: "Paciente clinicamente estável.",
      variables: {},
      status: "ISSUED",
      version: 1,
      currentRevisionId: "rev-30",
      preparedRevisionId: "rev-30",
      replacesDocumentId: null,
      chainVersion: 1,
      snapshotHash: "sha256_clinic_a_doc",
      pdfObjectKey: `organizations/${clinicAId}/pdf/${docId}.pdf`,
      issuedById: profAId,
      issuedAt: now,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Professional B authenticated in Clinic B attempts to access Clinic A document
    const tokenProfB = signSessionToken(
      { sub: profBId, sid: "sess-prof-b" },
      secret,
      3600,
    );

    const res = await f.app.handle(
      new Request(
        `http://localhost/api/organizations/clinica-boa/documents/${docId}/pdf`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokenProfB}`,
          },
        },
      ),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("integration: enforces RBAC clinical permissions (RECEPTIONIST gets 403)", async () => {
    const f = createPdfFixture();

    const docId = "00000000-0000-4000-8000-000000000040";
    const now = new Date();

    f.documents.push({
      id: docId,
      organizationId: clinicAId,
      patientId: patientAId,
      authorId: profAId,
      templateId: null,
      templateVersion: null,
      type: "EXAM_REQUEST",
      title: "Exames de Rotina",
      content: "Hemograma completo e perfil lipídico.",
      variables: {},
      status: "ISSUED",
      version: 1,
      currentRevisionId: "rev-40",
      preparedRevisionId: "rev-40",
      replacesDocumentId: null,
      chainVersion: 1,
      snapshotHash: "sha256_exam_request_hash",
      pdfObjectKey: `organizations/${clinicAId}/pdf/${docId}.pdf`,
      issuedById: profAId,
      issuedAt: now,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // Receptionist has documents:read capability denied by clinicalEligibility
    const tokenRecept = signSessionToken(
      { sub: receptAId, sid: "sess-recept-a" },
      secret,
      3600,
    );

    const res = await f.app.handle(
      new Request(
        `http://localhost/api/organizations/clinica-vida/documents/${docId}/pdf`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${tokenRecept}`,
          },
        },
      ),
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(body.error.code).toBe("PERMISSION_DENIED");
  });

  test("integration: stability check — modifying patient record after issue does NOT affect generated PDF", async () => {
    const f = createPdfFixture();

    const docId = "00000000-0000-4000-8000-000000000050";
    const revId = "00000000-0000-4000-8000-000000000051";
    const now = new Date();

    // Patient originally named "João da Silva Sauro"
    f.documents.push({
      id: docId,
      organizationId: clinicAId,
      patientId: patientAId,
      authorId: profAId,
      templateId: null,
      templateVersion: null,
      type: "CERTIFICATE",
      title: "Atestado Médico Original",
      content: "Atesto repouso por 5 dias.",
      variables: {
        clinica_nome: "Clínica Vida & Saúde",
        paciente_nome: "João da Silva Sauro",
        profissional_nome: "Dra. Ana Oliveira",
        profissional_registro: "CRM/SP 123456",
        data_emissao: "14/10/2026",
      },
      status: "DRAFT",
      version: 2,
      currentRevisionId: revId,
      preparedRevisionId: revId,
      replacesDocumentId: null,
      chainVersion: 1,
      snapshotHash: null,
      pdfObjectKey: null,
      issuedById: null,
      issuedAt: null,
      voidedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    f.versions.push({
      id: revId,
      documentId: docId,
      organizationId: clinicAId,
      version: 2,
      title: "Atestado Médico Original",
      content: "Atesto repouso por 5 dias.",
      variables: {
        clinica_nome: "Clínica Vida & Saúde",
        paciente_nome: "João da Silva Sauro",
        profissional_nome: "Dra. Ana Oliveira",
        profissional_registro: "CRM/SP 123456",
        data_emissao: "14/10/2026",
      },
      templateId: null,
      templateVersion: null,
      savedById: profAId,
      createdAt: now,
    });

    const token = signSessionToken(
      { sub: profAId, sid: "sess-prof-a" },
      secret,
      3600,
    );

    // 1. Issue document
    const issueRes = await f.app.handle(
      new Request(
        `http://localhost/api/organizations/clinica-vida/documents/${docId}/issue`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        },
      ),
    );
    expect(issueRes.status).toBe(200);

    // 2. Download original PDF
    const res1 = await f.app.handle(
      new Request(
        `http://localhost/api/organizations/clinica-vida/documents/${docId}/pdf`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(res1.status).toBe(200);
    const pdfBytes1 = new Uint8Array(await res1.arrayBuffer());

    // 3. Mutate patient in database AFTER issue
    const patientRecord = f.patients.find((p) => p.id === patientAId);
    if (!patientRecord) throw new Error("Patient not found");
    patientRecord.fullName = "Nome Alterado Posteriormente";
    patientRecord.cpf = "000.000.000-99";

    // 4. Download PDF again
    const res2 = await f.app.handle(
      new Request(
        `http://localhost/api/organizations/clinica-vida/documents/${docId}/pdf`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    );
    expect(res2.status).toBe(200);
    const pdfBytes2 = new Uint8Array(await res2.arrayBuffer());

    // Both PDFs must be byte-for-byte identical!
    expect(pdfBytes1).toEqual(pdfBytes2);
    const content2 = Buffer.from(pdfBytes2).toString("latin1");
    expect(content2).not.toContain("Nome Alterado Posteriormente");
  });
});
