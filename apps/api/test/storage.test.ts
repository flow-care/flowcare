import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import type { ApiError } from "../src/lib/api-error";
import { StorageService } from "../src/modules/storage/service";

const orgId = "11111111-1111-4111-8111-111111111111";
const otherOrgId = "22222222-2222-4222-8222-222222222222";

function setup() {
  const records: Array<{
    id: string;
    organizationId: string;
    objectKey: string;
    category: string;
  }> = [];
  const prisma = {
    storageObject: {
      create: async ({
        data,
      }: {
        data: { organizationId: string; objectKey: string; category: string };
      }) => {
        const record = { id: crypto.randomUUID(), ...data };
        records.push(record);
        return record;
      },
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) =>
        records.find(
          (record) =>
            record.id === where.id &&
            record.organizationId === where.organizationId,
        ) ?? null,
    },
  } as unknown as PrismaClient;
  const service = new StorageService({
    prisma,
    config: {
      endpoint: "https://example.invalid",
      bucket: "test-private-bucket",
      region: "auto",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
    },
  });
  return { service, records };
}

const upload = {
  fileName: "sample.png",
  contentType: "image/png",
  sizeBytes: 1024,
  category: "attachment" as const,
};

describe("private storage", () => {
  test("signs only allowed category and organization with bounded expiry", async () => {
    const { service } = setup();
    const result = await service.createUpload(orgId, upload);
    expect(
      result.objectKey.startsWith(`organizations/${orgId}/attachment/`),
    ).toBe(true);
    expect(result.expiresInSeconds).toBe(600);
    expect(new URL(result.uploadUrl).searchParams.get("X-Amz-Expires")).toBe(
      "600",
    );
    expect(
      new URL(result.uploadUrl).searchParams.get("X-Amz-SignedHeaders"),
    ).toBe("content-length;content-type;host");
    const download = await service.createDownload(orgId, result.objectId);
    expect(download.expiresInSeconds).toBe(900);
    expect(
      new URL(download.downloadUrl).searchParams.get("X-Amz-Expires"),
    ).toBe("900");
  });

  test("cannot sign a download for another organization", async () => {
    const { service, records } = setup();
    records.push({
      id: "other-object",
      organizationId: otherOrgId,
      objectKey: `organizations/${otherOrgId}/audio/sample`,
      category: "audio",
    });
    await expect(
      service.createDownload(orgId, "other-object"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    } satisfies Partial<ApiError>);
  });

  test("rejects MIME mismatches and oversized files before persistence", async () => {
    const { service, records } = setup();
    await expect(
      service.createUpload(orgId, {
        ...upload,
        contentType: "application/pdf",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.createUpload(orgId, {
        ...upload,
        contentType: "application/octet-stream",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.createUpload(orgId, {
        ...upload,
        sizeBytes: 25 * 1024 * 1024 + 1,
      }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE", httpStatus: 413 });
    expect(records).toHaveLength(0);
  });

  test("fails closed for audio and PDF without resource-specific clinical eligibility", async () => {
    const { service, records } = setup();
    await expect(
      service.createUpload(orgId, {
        fileName: "recording.webm",
        contentType: "audio/webm",
        sizeBytes: 1024,
        category: "audio",
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", httpStatus: 403 });
    records.push({
      id: "clinical-pdf",
      organizationId: orgId,
      objectKey: "private",
      category: "pdf",
    });
    await expect(
      service.createDownload(orgId, "clinical-pdf"),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED", httpStatus: 403 });
  });
});
