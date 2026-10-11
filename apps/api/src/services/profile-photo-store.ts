import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Env } from "../config/env";

export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_URL_TTL_SECONDS = 900;

export interface ProfilePhotoStore {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  downloadUrl(key: string): Promise<string>;
  delete(key: string): Promise<void>;
}

export function createProfilePhotoStore(
  env: Pick<
    Env,
    | "storageEndpoint"
    | "storageBucket"
    | "storageRegion"
    | "storageAccessKeyId"
    | "storageSecretAccessKey"
  >,
): ProfilePhotoStore | null {
  if (
    !env.storageEndpoint ||
    !env.storageBucket ||
    !env.storageAccessKeyId ||
    !env.storageSecretAccessKey
  ) {
    return null;
  }

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
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    async downloadUrl(key) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: PROFILE_PHOTO_URL_TTL_SECONDS },
      );
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
