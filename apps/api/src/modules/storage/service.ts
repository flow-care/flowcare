import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type { UploadBody } from "./model";

const MIME_LIMITS: Record<
  string,
  { category: UploadBody["category"]; max: number }
> = {
  "audio/mp4": { category: "audio", max: 50 * 1024 * 1024 },
  "audio/webm": { category: "audio", max: 50 * 1024 * 1024 },
  "audio/mpeg": { category: "audio", max: 50 * 1024 * 1024 },
  "application/pdf": { category: "pdf", max: 25 * 1024 * 1024 },
  "image/jpeg": { category: "attachment", max: 25 * 1024 * 1024 },
  "image/png": { category: "attachment", max: 25 * 1024 * 1024 },
};

export class StorageService {
  private readonly client: S3Client | null;

  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      config: {
        endpoint: string | null;
        bucket: string | null;
        region: string;
        accessKeyId: string | null;
        secretAccessKey: string | null;
      };
    },
  ) {
    this.client =
      deps.config.endpoint &&
      deps.config.bucket &&
      deps.config.accessKeyId &&
      deps.config.secretAccessKey
        ? new S3Client({
            region: deps.config.region,
            endpoint: deps.config.endpoint,
            forcePathStyle: true,
            credentials: {
              accessKeyId: deps.config.accessKeyId,
              secretAccessKey: deps.config.secretAccessKey,
            },
          })
        : null;
  }

  async createUpload(organizationId: string, body: UploadBody) {
    // Generic storage has no consultation/document context to establish
    // professional qualification. These categories must use resource routes.
    if (body.category !== "attachment")
      throw new ApiError(
        "PERMISSION_DENIED",
        403,
        "Habilitação clínica não verificada.",
      );
    const allowed = MIME_LIMITS[body.contentType];
    if (!allowed || allowed.category !== body.category)
      throw new ApiError(
        "VALIDATION_ERROR",
        400,
        "Tipo de arquivo não permitido.",
      );
    if (body.sizeBytes > allowed.max)
      throw new ApiError(
        "FILE_TOO_LARGE",
        413,
        "Arquivo excede o limite permitido.",
      );
    if (!this.client || !this.deps.config.bucket)
      throw new ApiError(
        "STORAGE_UNAVAILABLE",
        503,
        "Armazenamento indisponível.",
      );
    const safeName = body.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const objectKey = `organizations/${organizationId}/${body.category}/${crypto.randomUUID()}-${safeName}`;
    const object = await this.deps.prisma.storageObject.create({
      data: {
        organizationId,
        objectKey,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        category: body.category,
      },
    });
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.deps.config.bucket,
        Key: objectKey,
        ContentType: body.contentType,
        ContentLength: body.sizeBytes,
      }),
      {
        expiresIn: 600,
        signableHeaders: new Set(["content-length", "content-type"]),
      },
    );
    return { objectId: object.id, objectKey, uploadUrl, expiresInSeconds: 600 };
  }

  async createDownload(organizationId: string, objectId: string) {
    const object = await this.deps.prisma.storageObject.findFirst({
      where: { id: objectId, organizationId },
    });
    if (!object)
      throw new ApiError("NOT_FOUND", 404, "Arquivo não encontrado.");
    if (object.category !== "attachment")
      throw new ApiError(
        "PERMISSION_DENIED",
        403,
        "Habilitação clínica não verificada.",
      );
    if (!this.client || !this.deps.config.bucket)
      throw new ApiError(
        "STORAGE_UNAVAILABLE",
        503,
        "Armazenamento indisponível.",
      );
    const downloadUrl = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.deps.config.bucket,
        Key: object.objectKey,
      }),
      { expiresIn: 900 },
    );
    return { objectId, downloadUrl, expiresInSeconds: 900 };
  }
}
