import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../config/env";

export interface ConsultationAudioStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  signedUploadUrl(
    key: string,
    contentType: string,
    sizeBytes: number,
  ): Promise<string>;
}

export function createConsultationAudioStore(
  env: Pick<
    Env,
    | "storageEndpoint"
    | "storageBucket"
    | "storageRegion"
    | "storageAccessKeyId"
    | "storageSecretAccessKey"
  >,
): ConsultationAudioStore | null {
  if (
    !env.storageEndpoint ||
    !env.storageBucket ||
    !env.storageAccessKeyId ||
    !env.storageSecretAccessKey
  )
    return null;

  const client = new S3Client({
    endpoint: env.storageEndpoint,
    region: env.storageRegion ?? "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.storageAccessKeyId,
      secretAccessKey: env.storageSecretAccessKey,
    },
  });
  const bucket = env.storageBucket;

  return {
    async put(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
    },
    async read(key) {
      const head = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!head.ContentLength || head.ContentLength > 50 * 1024 * 1024) {
        throw new Error("Invalid audio object size");
      }
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, IfMatch: head.ETag }),
      );
      if (!result.Body) throw new Error("Missing audio object body");
      return result.Body.transformToByteArray();
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    signedUploadUrl(key, contentType, sizeBytes) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: sizeBytes,
        }),
        {
          expiresIn: 600,
          signableHeaders: new Set(["content-type", "content-length"]),
        },
      );
    },
  };
}
