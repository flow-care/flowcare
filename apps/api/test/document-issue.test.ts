import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { DocumentsService } from "../src/modules/documents/service";
import { resolveOrganizationAccess } from "../src/plugins/organization-access";

const org = "00000000-0000-4000-8000-000000000001";
const actor = "00000000-0000-4000-8000-000000000002";
const id = "00000000-0000-4000-8000-000000000003";
const revisionId = "00000000-0000-4000-8000-000000000004";

function fixture(status: "DRAFT" | "ISSUED" | "VOIDED" = "DRAFT") {
  const document = {
    id,
    organizationId: org,
    patientId: actor,
    authorId: actor,
    templateId: null,
    templateVersion: null,
    type: "REPORT",
    title: "Laudo",
    content: "Conteúdo congelado",
    variables: {},
    status,
    version: 2,
    currentRevisionId: revisionId,
    preparedRevisionId: revisionId as string | null,
    replacesDocumentId: null,
    chainVersion: 1,
    snapshotHash: status === "ISSUED" ? "sha256_existing" : null,
    pdfObjectKey:
      status === "ISSUED" ? `organizations/${org}/pdf/existing.pdf` : null,
    issuedAt: status === "ISSUED" ? new Date("2026-10-13T12:00:00Z") : null,
  };
  const versions = [
    {
      id: revisionId,
      documentId: id,
      organizationId: org,
      title: document.title,
      content: document.content,
      variables: {},
      templateId: null,
      templateVersion: null,
    },
  ];
  const audits: { action: string }[] = [];
  const documents = [document];
  const prisma = {
    clinicalDocument: {
      findFirst: async ({
        where,
      }: {
        where: {
          id?: string;
          organizationId: string;
          replacesDocumentId?: string;
        };
      }) =>
        documents.find(
          (item) =>
            item.organizationId === where.organizationId &&
            (where.id === undefined || item.id === where.id) &&
            (where.replacesDocumentId === undefined ||
              item.replacesDocumentId === where.replacesDocumentId),
        ) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id: string;
          status: string;
          version: number;
          currentRevisionId: string;
        };
        data: Record<string, unknown>;
      }) => {
        const target = documents.find((item) => item.id === where.id);
        if (
          !target ||
          target.status !== where.status ||
          target.version !== where.version ||
          target.currentRevisionId !== where.currentRevisionId
        )
          return { count: 0 };
        Object.assign(target, data);
        return { count: 1 };
      },
      create: async ({ data }: { data: typeof document }) => {
        const created = { ...data, id: crypto.randomUUID() };
        documents.push(created);
        return created;
      },
    },
    documentVersion: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; documentId: string; organizationId: string };
      }) =>
        versions.find(
          (v) =>
            v.id === where.id &&
            v.documentId === where.documentId &&
            v.organizationId === where.organizationId,
        ) ?? null,
      create: async ({ data }: { data: (typeof versions)[number] }) => {
        versions.push(data);
        return data;
      },
    },
    auditLog: {
      create: async ({ data }: { data: { action: string } }) => {
        audits.push(data);
        return data;
      },
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(prisma),
  };
  return {
    document,
    documents,
    versions,
    audits,
    prisma: prisma as unknown as PrismaClient,
  };
}

describe("document issue and rectification (#275)", () => {
  test("requires clinical role and active membership for issue and rectification", async () => {
    const membership = {
      id: crypto.randomUUID(),
      organizationId: org,
      role: "RECEPTIONIST",
      status: "ACTIVE",
    };
    const prisma = {
      membership: { findFirst: async () => membership },
    } as unknown as PrismaClient;
    await expect(
      resolveOrganizationAccess(prisma, actor, "clinic", "documents:issue"),
    ).rejects.toMatchObject({ httpStatus: 403 });
    await expect(
      resolveOrganizationAccess(prisma, actor, "clinic", "documents:write"),
    ).rejects.toMatchObject({ httpStatus: 403 });
    membership.role = "PROFESSIONAL";
    membership.status = "SUSPENDED";
    await expect(
      resolveOrganizationAccess(prisma, actor, "clinic", "documents:issue"),
    ).rejects.toMatchObject({ httpStatus: 403 });
    membership.status = "ACTIVE";
    const result = await resolveOrganizationAccess(
      prisma,
      actor,
      "clinic",
      "documents:issue",
    );
    expect(result.organizationId).toBe(org);
  });

  test("emits once after PDF confirmation and repeats idempotently", async () => {
    const f = fixture();
    let renders = 0;
    const service = new DocumentsService(f.prisma, {
      renderAndStore: async () => {
        renders++;
        return `organizations/${org}/pdf/final.pdf`;
      },
    });
    const first = await service.issue(org, actor, id);
    const second = await service.issue(org, actor, id);
    expect(first).toEqual(second);
    expect(first.status).toBe("ISSUED");
    expect(first.snapshotHash).toStartWith("sha256_");
    expect(f.document.status).toBe("ISSUED");
    expect(f.document.version).toBe(2);
    expect(f.versions).toHaveLength(1);
    expect(f.audits.map((a) => a.action)).toEqual(["DOCUMENT_ISSUED"]);
    expect(renders).toBe(1);
  });

  test("does not emit on missing or failed PDF and rejects stale snapshots", async () => {
    const f = fixture();
    const unavailable = new DocumentsService(f.prisma);
    await expect(unavailable.issue(org, actor, id)).rejects.toMatchObject({
      httpStatus: 503,
    });
    const failed = new DocumentsService(f.prisma, {
      renderAndStore: async () => {
        throw new Error("PDF failed");
      },
    });
    await expect(failed.issue(org, actor, id)).rejects.toThrow("PDF failed");
    expect(f.document.status).toBe("DRAFT");
    expect(f.audits).toHaveLength(0);
    f.document.preparedRevisionId = null;
    await expect(unavailable.issue(org, actor, id)).rejects.toMatchObject({
      httpStatus: 422,
    });
  });

  test("rejects voided and foreign documents", async () => {
    const f = fixture("VOIDED");
    const service = new DocumentsService(f.prisma);
    await expect(service.issue(org, actor, id)).rejects.toMatchObject({
      httpStatus: 409,
    });
    await expect(
      service.issue(crypto.randomUUID(), actor, id),
    ).rejects.toMatchObject({ httpStatus: 404 });
  });

  test("rectification clones the issued snapshot into a linked new draft", async () => {
    const f = fixture("ISSUED");
    const service = new DocumentsService(f.prisma);
    const result = await service.rectify(org, actor, id);
    expect(result).toMatchObject({
      status: "DRAFT",
      replacesDocumentId: id,
      chainVersion: 2,
    });
    expect(f.documents).toHaveLength(2);
    expect(f.document.content).toBe("Conteúdo congelado");
    expect(f.document.status).toBe("ISSUED");
    expect(f.audits.map((a) => a.action)).toEqual([
      "DOCUMENT_RECTIFICATION_STARTED",
    ]);
    await expect(service.rectify(org, actor, id)).rejects.toMatchObject({
      httpStatus: 409,
    });
  });

  test("emits the rectification as v2 without changing the original", async () => {
    const f = fixture("ISSUED");
    const originalHash = f.document.snapshotHash;
    const service = new DocumentsService(f.prisma, {
      renderAndStore: async () => `organizations/${org}/pdf/rectified.pdf`,
    });
    const draft = await service.rectify(org, actor, id);
    const replacement = f.documents.find(
      (item) => item.id === draft.documentId,
    );
    if (!replacement) throw new Error("Replacement missing");
    replacement.preparedRevisionId = replacement.currentRevisionId;
    const emitted = await service.issue(org, actor, draft.documentId);
    expect(emitted.chainVersion).toBe(2);
    expect(emitted.replacesDocumentId).toBe(id);
    expect(f.document.snapshotHash).toBe(originalHash);
    expect(f.document.content).toBe("Conteúdo congelado");
    expect(f.audits.map((a) => a.action)).toEqual([
      "DOCUMENT_RECTIFICATION_STARTED",
      "DOCUMENT_ISSUED",
    ]);
  });
});
