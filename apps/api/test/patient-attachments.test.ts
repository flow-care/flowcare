import { describe, expect, mock, test } from "bun:test";
import { Elysia } from "elysia";
import type {
  MembershipRole,
  MembershipStatus,
  PrismaClient,
} from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { patientsModule } from "../src/modules/patients";
import {
  type ArchivePatientAttachmentResponse,
  type ListPatientAttachmentsResponse,
  PATIENT_ATTACHMENT_MAX_BYTES,
  PATIENT_ATTACHMENT_URL_TTL_SECONDS,
  type PatientAttachmentDownloadUrlResponse,
  type UploadPatientAttachmentResponse,
} from "../src/modules/patients/model";
import { signSessionToken } from "../src/services/session-token";

const jwtSecret = "patient-attachments-test-secret";

const VALID_PDF = new TextEncoder().encode(
  "%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n",
);

const VALID_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1,
]);

const VALID_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff,
  0xd9,
]);

const VALID_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x14, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20, 0x08, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a,
  0x01, 0x00, 0x01, 0x00,
]);

interface StoredPatient {
  id: string;
  organizationId: string;
  fullName: string;
}

interface StoredAttachment {
  id: string;
  organizationId: string;
  patientId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  objectKey: string;
  category: string | null;
  description: string | null;
  uploadedById: string;
  archivedAt: Date | null;
  archivedById: string | null;
  archiveReason: string | null;
  createdAt: Date;
}

interface StoredMembership {
  id: string;
  userId: string;
  organizationId: string;
  orgSlug: string;
  role: MembershipRole;
  status: MembershipStatus;
}

interface StoredAuditLog {
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

function setup(options?: { storageAvailable?: boolean }) {
  const patients: StoredPatient[] = [
    {
      id: "patient-clinic-a",
      organizationId: "org-a",
      fullName: "Maria Oliveira",
    },
    {
      id: "patient-clinic-b",
      organizationId: "org-b",
      fullName: "Carlos Mendes",
    },
  ];

  const memberships: StoredMembership[] = [
    {
      id: "mem-prof-a",
      userId: "user-prof-a",
      organizationId: "org-a",
      orgSlug: "clinica-a",
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-admin-prof-a",
      userId: "user-admin-prof-a",
      organizationId: "org-a",
      orgSlug: "clinica-a",
      role: "ADMIN_PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-admin-a",
      userId: "user-admin-a",
      organizationId: "org-a",
      orgSlug: "clinica-a",
      role: "ADMIN",
      status: "ACTIVE",
    },
    {
      id: "mem-recep-a",
      userId: "user-recep-a",
      organizationId: "org-a",
      orgSlug: "clinica-a",
      role: "RECEPTIONIST",
      status: "ACTIVE",
    },
    {
      id: "mem-suspended-a",
      userId: "user-suspended-a",
      organizationId: "org-a",
      orgSlug: "clinica-a",
      role: "PROFESSIONAL",
      status: "SUSPENDED",
    },
    {
      id: "mem-prof-b",
      userId: "user-prof-b",
      organizationId: "org-b",
      orgSlug: "clinica-b",
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
  ];

  const attachments: StoredAttachment[] = [];
  const auditLogs: StoredAuditLog[] = [];

  const put = mock(
    async (_key: string, _body: Uint8Array, _type: string) => {},
  );
  const del = mock(async (_key: string) => {});
  const downloadUrl = mock(
    async (key: string) =>
      `https://private-storage.example/${key}?X-Amz-Expires=${PATIENT_ATTACHMENT_URL_TTL_SECONDS}&sig=signed`,
  );

  const patientApi = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      patients.find(
        (p) => p.id === where.id && p.organizationId === where.organizationId,
      ) ?? null,
  };

  const patientAttachmentApi = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const record: StoredAttachment = {
        id: `att-${attachments.length + 1}`,
        organizationId: data.organizationId as string,
        patientId: data.patientId as string,
        fileName: data.fileName as string,
        contentType: data.contentType as string,
        sizeBytes: data.sizeBytes as number,
        objectKey: data.objectKey as string,
        category: (data.category as string | null) ?? null,
        description: (data.description as string | null) ?? null,
        uploadedById: data.uploadedById as string,
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
        createdAt: new Date(
          Date.UTC(2026, 9, 12, 14, 0, attachments.length, 0),
        ),
      };
      attachments.push(record);
      return record;
    },
    findMany: async ({ where }: { where: Record<string, unknown> }) => {
      return attachments
        .filter((item) => {
          if (item.organizationId !== where.organizationId) return false;
          if (item.patientId !== where.patientId) return false;
          if ("archivedAt" in where && item.archivedAt !== where.archivedAt) {
            return false;
          }
          if (where.category && item.category !== where.category) return false;
          return true;
        })
        .sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        );
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      attachments.find(
        (item) =>
          item.id === where.id &&
          item.patientId === where.patientId &&
          item.organizationId === where.organizationId,
      ) ?? null,
    updateMany: async ({
      where,
      data,
    }: {
      where: {
        id: string;
        organizationId: string;
        patientId: string;
        archivedAt: null;
      };
      data: Record<string, unknown>;
    }) => {
      const record = attachments.find(
        (item) =>
          item.id === where.id &&
          item.organizationId === where.organizationId &&
          item.patientId === where.patientId &&
          item.archivedAt === null,
      );
      if (!record) return { count: 0 };
      if ("archivedAt" in data)
        record.archivedAt = data.archivedAt as Date | null;
      if ("archivedById" in data)
        record.archivedById = data.archivedById as string | null;
      if ("archiveReason" in data)
        record.archiveReason = data.archiveReason as string | null;
      return { count: 1 };
    },
  };

  const auditLogApi = {
    create: async ({ data }: { data: StoredAuditLog }) => {
      auditLogs.push(data);
      return { id: `audit-${auditLogs.length}`, ...data };
    },
  };

  const prisma = {
    session: {
      findFirst: async () => ({ id: "session-1", lastActiveAt: new Date() }),
    },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; organization: { slug: string } };
      }) => {
        const found = memberships.find(
          (m) =>
            m.userId === where.userId && m.orgSlug === where.organization.slug,
        );
        if (!found) return null;
        return {
          id: found.id,
          organizationId: found.organizationId,
          role: found.role,
          status: found.status,
        };
      },
    },
    patient: patientApi,
    patientAttachment: patientAttachmentApi,
    auditLog: auditLogApi,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        patient: patientApi,
        patientAttachment: patientAttachmentApi,
        auditLog: auditLogApi,
      }),
  } as unknown as PrismaClient;

  const app = new Elysia({ prefix: "/api" })
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
      if (code === "NOT_FOUND") {
        return status(404, {
          error: { code: "NOT_FOUND", message: "Recurso não encontrado." },
        });
      }
      if (
        code === "VALIDATION" ||
        code === "INVALID_FILE_TYPE" ||
        code === "PARSE"
      ) {
        if (
          code === "VALIDATION" &&
          error.all.some((item) => {
            if (!(item.value instanceof Blob)) return false;
            const schemaMaxSize = (item.schema as { maxSize?: unknown })
              ?.maxSize;
            const maxBytes =
              typeof schemaMaxSize === "number"
                ? schemaMaxSize
                : PATIENT_ATTACHMENT_MAX_BYTES;
            return item.value.size > maxBytes;
          })
        ) {
          return status(413, {
            error: {
              code: "FILE_TOO_LARGE",
              message: "Arquivo excede o limite de 10 MiB.",
            },
          });
        }
        return status(400, {
          error: {
            code: "VALIDATION_ERROR",
            message: "Dados inválidos.",
          },
        });
      }
      return status(500, {
        error: { code: "INTERNAL", message: "Erro interno." },
      });
    })
    .use(
      patientsModule({
        prisma,
        jwtSecret,
        attachmentStore:
          options?.storageAvailable === false
            ? null
            : {
                put,
                downloadUrl,
                delete: del,
              },
      }),
    );

  const tokenFor = (userId: string) =>
    signSessionToken({ sid: "session-1", sub: userId }, jwtSecret, 3600);

  const request = (
    path: string,
    init: RequestInit & { userId?: string | null } = {},
  ) => {
    const { userId = "user-prof-a", headers, ...rest } = init;
    const mergedHeaders = new Headers(headers);
    if (userId) {
      mergedHeaders.set("authorization", `Bearer ${tokenFor(userId)}`);
    }
    return app.handle(
      new Request(`http://localhost/api${path}`, {
        ...rest,
        headers: mergedHeaders,
      }),
    );
  };

  return {
    request,
    attachments,
    auditLogs,
    put,
    del,
    downloadUrl,
  };
}

describe("#253 private patient attachments", () => {
  test("uploads valid PDF and image attachments privately without public URLs and authorizes short-lived downloads", async () => {
    const { request, attachments, auditLogs, put, downloadUrl } = setup();

    // 1. Upload a valid PDF exam
    const pdfForm = new FormData();
    pdfForm.append(
      "file",
      new File([VALID_PDF], "hemograma-completo.pdf", {
        type: "application/pdf",
      }),
    );
    pdfForm.append("category", "LAB_EXAM");
    pdfForm.append("description", "Hemograma de retorno");

    const uploadPdfRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments",
      {
        method: "POST",
        body: pdfForm,
      },
    );
    expect(uploadPdfRes.status).toBe(201);
    const pdfCreated =
      (await uploadPdfRes.json()) as UploadPatientAttachmentResponse;
    expect(pdfCreated).toMatchObject({
      attachmentId: "att-1",
      fileName: "hemograma-completo.pdf",
      contentType: "application/pdf",
      sizeBytes: VALID_PDF.byteLength,
      category: "LAB_EXAM",
      description: "Hemograma de retorno",
      attachment: {
        id: "att-1",
        attachmentId: "att-1",
        patientId: "patient-clinic-a",
        fileName: "hemograma-completo.pdf",
        contentType: "application/pdf",
        sizeBytes: VALID_PDF.byteLength,
        category: "LAB_EXAM",
        description: "Hemograma de retorno",
        uploadedById: "user-prof-a",
        status: "ACTIVE",
        archivedAt: null,
        archivedById: null,
        archiveReason: null,
      },
    });

    // Metadata never exposes objectKey or a permanent URL
    const rawUploadJson = JSON.stringify(pdfCreated);
    expect(rawUploadJson).not.toContain("organizations/org-a");
    expect(rawUploadJson).not.toContain("http://");
    expect(rawUploadJson).not.toContain("https://");

    expect(put).toHaveBeenCalledTimes(1);
    expect(attachments[0]?.objectKey).toMatch(
      /^organizations\/org-a\/patients\/patient-clinic-a\/attachments\/.+-hemograma-completo\.pdf$/,
    );

    // 2. Upload PNG, JPEG, and WebP images as ADMIN_PROFESSIONAL
    for (const sample of [
      { bytes: VALID_PNG, name: "raio-x.png", type: "image/png" },
      { bytes: VALID_JPEG, name: "laudo.jpg", type: "image/jpeg" },
      { bytes: VALID_WEBP, name: "dermato.webp", type: "image/webp" },
    ]) {
      const form = new FormData();
      form.append(
        "file",
        new File([sample.bytes], sample.name, { type: sample.type }),
      );
      const res = await request(
        "/organizations/clinica-a/patients/patient-clinic-a/attachments",
        {
          userId: "user-admin-prof-a",
          method: "POST",
          body: form,
        },
      );
      expect(res.status).toBe(201);
    }
    expect(attachments).toHaveLength(4);

    // 3. List attachments returns active metadata without public URLs
    const listRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments",
    );
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as ListPatientAttachmentsResponse;
    expect(listed.data).toHaveLength(4);
    expect(listed.attachments).toHaveLength(4);
    expect(JSON.stringify(listed)).not.toContain("organizations/org-a");

    // 4. Authorize temporary download URL (POST and GET) with bounded expiration and audit log
    const beforeDownload = Date.now();
    const postDownloadRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments/att-1/download-url",
      { method: "POST" },
    );
    expect(postDownloadRes.status).toBe(200);
    const signedPost =
      (await postDownloadRes.json()) as PatientAttachmentDownloadUrlResponse;
    expect(signedPost.attachmentId).toBe("att-1");
    expect(signedPost.expiresInSeconds).toBe(
      PATIENT_ATTACHMENT_URL_TTL_SECONDS,
    );
    expect(signedPost.downloadUrl).toContain(
      `X-Amz-Expires=${PATIENT_ATTACHMENT_URL_TTL_SECONDS}`,
    );
    const expiresAtMs = Date.parse(signedPost.expiresAt);
    expect(expiresAtMs).toBeGreaterThanOrEqual(
      beforeDownload + (PATIENT_ATTACHMENT_URL_TTL_SECONDS - 5) * 1000,
    );

    const getDownloadRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments/att-1/download-url",
    );
    expect(getDownloadRes.status).toBe(200);
    expect(downloadUrl).toHaveBeenCalledTimes(2);

    expect(
      auditLogs.filter(
        (log) => log.action === "PATIENT_ATTACHMENT_DOWNLOAD_AUTHORIZED",
      ),
    ).toHaveLength(2);
  });

  test("verifies real magic bytes and size, rejecting disguised formats and oversized files", async () => {
    const { request, attachments, auditLogs, put } = setup();

    const invalidCases: Array<{ file: File; expectedStatus: number }> = [
      // Plain text disguised as PDF
      {
        file: new File(["not a real pdf file"], "disguised.pdf", {
          type: "application/pdf",
        }),
        expectedStatus: 400,
      },
      // Executable MZ header disguised as PDF
      {
        file: new File(
          [new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])],
          "malware.pdf",
          { type: "application/pdf" },
        ),
        expectedStatus: 400,
      },
      // PNG bytes disguised as PDF
      {
        file: new File([VALID_PNG], "spoofed.pdf", {
          type: "application/pdf",
        }),
        expectedStatus: 400,
      },
      // PDF bytes disguised as PNG
      {
        file: new File([VALID_PDF], "spoofed.png", {
          type: "image/png",
        }),
        expectedStatus: 400,
      },
      // PNG bytes disguised as JPEG
      {
        file: new File([VALID_PNG], "spoofed.jpg", {
          type: "image/jpeg",
        }),
        expectedStatus: 400,
      },
      // Disallowed MIME type (SVG)
      {
        file: new File(["<svg></svg>"], "image.svg", {
          type: "image/svg+xml",
        }),
        expectedStatus: 400,
      },
      // Empty file
      {
        file: new File([], "empty.pdf", {
          type: "application/pdf",
        }),
        expectedStatus: 400,
      },
      // Oversized file (> 10 MiB)
      {
        file: new File(
          [new Uint8Array(PATIENT_ATTACHMENT_MAX_BYTES + 1)],
          "huge.pdf",
          { type: "application/pdf" },
        ),
        expectedStatus: 413,
      },
    ];

    for (const item of invalidCases) {
      const form = new FormData();
      form.append("file", item.file);
      const res = await request(
        "/organizations/clinica-a/patients/patient-clinic-a/attachments",
        {
          method: "POST",
          body: form,
        },
      );
      expect(res.status).toBe(item.expectedStatus);
    }

    expect(put).not.toHaveBeenCalled();
    expect(attachments).toHaveLength(0);
    expect(auditLogs).toHaveLength(0);

    // Storage unavailable returns 503 STORAGE_UNAVAILABLE
    const unavailable = setup({ storageAvailable: false });
    const form = new FormData();
    form.append(
      "file",
      new File([VALID_PDF], "exam.pdf", { type: "application/pdf" }),
    );
    const unavailableRes = await unavailable.request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments",
      {
        method: "POST",
        body: form,
      },
    );
    expect(unavailableRes.status).toBe(503);
    expect(await unavailableRes.json()).toMatchObject({
      error: { code: "STORAGE_UNAVAILABLE" },
    });
  });

  test("enforces cross-clinic isolation and RBAC permissions on all attachment routes", async () => {
    const { request, auditLogs } = setup();

    // Seed an attachment in Clinic A
    const form = new FormData();
    form.append(
      "file",
      new File([VALID_PDF], "exame-clinica-a.pdf", {
        type: "application/pdf",
      }),
    );
    const createdRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments",
      {
        method: "POST",
        body: form,
      },
    );
    expect(createdRes.status).toBe(201);

    // 1. Professional from Clinic B cannot access Clinic A slug (404 NOT_FOUND)
    const crossSlugDownload = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments/att-1/download-url",
      {
        userId: "user-prof-b",
        method: "POST",
      },
    );
    expect(crossSlugDownload.status).toBe(404);

    // 2. Professional from Clinic B using their own clinic slug but passing Clinic A's patientId/attachmentId gets 404 NOT_FOUND
    const crossIdDownload = await request(
      "/organizations/clinica-b/patients/patient-clinic-a/attachments/att-1/download-url",
      {
        userId: "user-prof-b",
        method: "POST",
      },
    );
    expect(crossIdDownload.status).toBe(404);

    const crossPatientDownload = await request(
      "/organizations/clinica-b/patients/patient-clinic-b/attachments/att-1/download-url",
      {
        userId: "user-prof-b",
        method: "POST",
      },
    );
    expect(crossPatientDownload.status).toBe(404);

    const crossIdList = await request(
      "/organizations/clinica-b/patients/patient-clinic-a/attachments",
      { userId: "user-prof-b" },
    );
    expect(crossIdList.status).toBe(404);

    const crossIdArchive = await request(
      "/organizations/clinica-b/patients/patient-clinic-a/attachments/att-1",
      {
        userId: "user-prof-b",
        method: "DELETE",
      },
    );
    expect(crossIdArchive.status).toBe(404);

    // 3. Non-clinical ADMIN and RECEPTIONIST in Clinic A are denied with 403 PERMISSION_DENIED
    for (const userId of ["user-admin-a", "user-recep-a"]) {
      const listDenied = await request(
        "/organizations/clinica-a/patients/patient-clinic-a/attachments",
        { userId },
      );
      expect(listDenied.status).toBe(403);
      expect(await listDenied.json()).toMatchObject({
        error: {
          code: "PERMISSION_DENIED",
          details: { requiredPermission: "patients:attachments:read" },
        },
      });

      const downloadDenied = await request(
        "/organizations/clinica-a/patients/patient-clinic-a/attachments/att-1/download-url",
        { userId, method: "POST" },
      );
      expect(downloadDenied.status).toBe(403);
      expect(await downloadDenied.json()).toMatchObject({
        error: {
          code: "PERMISSION_DENIED",
          details: { requiredPermission: "patients:attachments:read" },
        },
      });

      const uploadForm = new FormData();
      uploadForm.append(
        "file",
        new File([VALID_PDF], "denied.pdf", { type: "application/pdf" }),
      );
      const uploadDenied = await request(
        "/organizations/clinica-a/patients/patient-clinic-a/attachments",
        {
          userId,
          method: "POST",
          body: uploadForm,
        },
      );
      expect(uploadDenied.status).toBe(403);
      expect(await uploadDenied.json()).toMatchObject({
        error: {
          code: "PERMISSION_DENIED",
          details: { requiredPermission: "patients:attachments:write" },
        },
      });

      const archiveDenied = await request(
        "/organizations/clinica-a/patients/patient-clinic-a/attachments/att-1",
        { userId, method: "DELETE" },
      );
      expect(archiveDenied.status).toBe(403);
      expect(await archiveDenied.json()).toMatchObject({
        error: {
          code: "PERMISSION_DENIED",
          details: { requiredPermission: "patients:attachments:write" },
        },
      });
    }

    // 4. Suspended professional gets 403 MEMBERSHIP_INACTIVE
    const suspendedRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments",
      { userId: "user-suspended-a" },
    );
    expect(suspendedRes.status).toBe(403);
    expect(await suspendedRes.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });

    // 5. Unauthenticated request gets 401 UNAUTHENTICATED
    const unauthRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments",
      { userId: null },
    );
    expect(unauthRes.status).toBe(401);

    // Only the initial upload was audited; no unauthorized download or archive occurred
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.action).toBe("PATIENT_ATTACHMENT_UPLOADED");
  });

  test("logically archives attachments preserving historical records and audit trail", async () => {
    const { request, attachments, auditLogs } = setup();

    const form = new FormData();
    form.append(
      "file",
      new File([VALID_PDF], "exame-antigo.pdf", { type: "application/pdf" }),
    );
    const uploadRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments",
      {
        method: "POST",
        body: form,
      },
    );
    expect(uploadRes.status).toBe(201);

    // Archive with reason via POST .../archive (or DELETE)
    const archiveRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments/att-1/archive",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Arquivo anexado ao paciente errado" }),
      },
    );
    expect(archiveRes.status).toBe(200);
    const archivedBody =
      (await archiveRes.json()) as ArchivePatientAttachmentResponse;
    expect(archivedBody).toMatchObject({
      archived: true,
      attachment: {
        id: "att-1",
        status: "ARCHIVED",
        archivedById: "user-prof-a",
        archiveReason: "Arquivo anexado ao paciente errado",
      },
    });
    expect(typeof archivedBody.attachment.archivedAt).toBe("string");

    // Repeating archive via DELETE is idempotent and does not duplicate audit log
    const repeatDelete = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments/att-1",
      { method: "DELETE" },
    );
    expect(repeatDelete.status).toBe(200);

    // Default listing excludes archived attachments
    const activeListRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments",
    );
    expect(activeListRes.status).toBe(200);
    const activeList =
      (await activeListRes.json()) as ListPatientAttachmentsResponse;
    expect(activeList.data).toHaveLength(0);

    // Historical listing (?includeArchived=true) preserves the archived attachment
    const historyListRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments?includeArchived=true",
    );
    expect(historyListRes.status).toBe(200);
    const historyList =
      (await historyListRes.json()) as ListPatientAttachmentsResponse;
    expect(historyList.data).toHaveLength(1);
    expect(historyList.data[0]).toMatchObject({
      id: "att-1",
      status: "ARCHIVED",
      archivedById: "user-prof-a",
      archiveReason: "Arquivo anexado ao paciente errado",
    });

    // Archived attachment cannot generate a new download URL
    const archivedDownloadRes = await request(
      "/organizations/clinica-a/patients/patient-clinic-a/attachments/att-1/download-url",
      { method: "POST" },
    );
    expect(archivedDownloadRes.status).toBe(404);

    // Underlying database record is preserved (never hard-deleted)
    expect(attachments).toHaveLength(1);
    expect(
      auditLogs.map((entry) => ({
        action: entry.action,
        targetId: entry.targetId,
      })),
    ).toEqual([
      { action: "PATIENT_ATTACHMENT_UPLOADED", targetId: "att-1" },
      { action: "PATIENT_ATTACHMENT_ARCHIVED", targetId: "att-1" },
    ]);
  });
});
