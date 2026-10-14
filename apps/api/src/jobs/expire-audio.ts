import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadEnv } from "../config/env";
import type { ConsultationAudio } from "../generated/prisma/client";
import { createPrismaClient } from "../services/db";

const RETENTION_DAYS = 30;
const BATCH_SIZE = 100;

async function main() {
  const env = loadEnv();
  if (
    !env.storageEndpoint ||
    !env.storageBucket ||
    !env.storageAccessKeyId ||
    !env.storageSecretAccessKey
  ) {
    throw new Error("STORAGE_* configuration is required for audio expiry");
  }

  const apply = process.argv.includes("--apply");
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const prisma = createPrismaClient(env.databaseUrl);
  const client = new S3Client({
    endpoint: env.storageEndpoint,
    region: env.storageRegion ?? "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.storageAccessKeyId,
      secretAccessKey: env.storageSecretAccessKey,
    },
  });

  let examined = 0;
  let deleted = 0;
  let clinicalExamined = 0;
  let clinicalDeleted = 0;
  let stagingExamined = 0;
  let stagingDeleted = 0;
  let cursor: string | undefined;
  try {
    while (true) {
      const objects = await prisma.storageObject.findMany({
        where: {
          category: "audio",
          createdAt: { lt: cutoff },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: BATCH_SIZE,
      });
      if (objects.length === 0) break;
      for (const object of objects) {
        examined++;
        const expectedPrefix = `organizations/${object.organizationId}/audio/`;
        if (!object.objectKey.startsWith(expectedPrefix)) {
          throw new Error("Unexpected audio object key prefix; expiry stopped");
        }
        if (apply) {
          await client.send(
            new DeleteObjectCommand({
              Bucket: env.storageBucket,
              Key: object.objectKey,
            }),
          );
          await prisma.storageObject.delete({ where: { id: object.id } });
          deleted++;
        }
        cursor = object.id;
      }
      if (objects.length < BATCH_SIZE) break;
    }
    cursor = undefined;
    const pendingCutoff = new Date(Date.now() - 60 * 60 * 1000);
    while (true) {
      const audios: ConsultationAudio[] =
        await prisma.consultationAudio.findMany({
          where: {
            OR: [
              {
                status: "PENDING_UPLOAD",
                uploadExpiresAt: { lt: pendingCutoff },
              },
              {
                status: "UPLOADED",
                createdAt: { lt: cutoff },
                objectDeletedAt: null,
              },
            ],
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: "asc" },
          take: BATCH_SIZE,
        });
      if (audios.length === 0) break;
      for (const audio of audios) {
        clinicalExamined++;
        if (
          !audio.objectKey.startsWith(
            `organizations/${audio.organizationId}/audio/`,
          )
        ) {
          throw new Error(
            "Unexpected consultation audio object key prefix; expiry stopped",
          );
        }
        if (apply) {
          await client.send(
            new DeleteObjectCommand({
              Bucket: env.storageBucket,
              Key: audio.objectKey,
            }),
          );
          if (audio.status === "PENDING_UPLOAD") {
            await prisma.consultationAudio.deleteMany({
              where: { id: audio.id, status: "PENDING_UPLOAD" },
            });
          } else {
            await prisma.consultationAudio.updateMany({
              where: {
                id: audio.id,
                status: "UPLOADED",
                objectDeletedAt: null,
              },
              data: { objectDeletedAt: new Date() },
            });
          }
          clinicalDeleted++;
        }
        cursor = audio.id;
      }
      if (audios.length < BATCH_SIZE) break;
    }
    cursor = undefined;
    while (true) {
      const audios: ConsultationAudio[] =
        await prisma.consultationAudio.findMany({
          where: {
            stagingObjectKey: { not: null },
            uploadExpiresAt: { lt: pendingCutoff },
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          orderBy: { id: "asc" },
          take: BATCH_SIZE,
        });
      if (!audios.length) break;
      for (const audio of audios) {
        stagingExamined++;
        if (
          !audio.stagingObjectKey?.startsWith(
            `organizations/${audio.organizationId}/audio/`,
          )
        ) {
          throw new Error(
            "Unexpected consultation audio staging key prefix; expiry stopped",
          );
        }
        if (apply) {
          await client.send(
            new DeleteObjectCommand({
              Bucket: env.storageBucket,
              Key: audio.stagingObjectKey,
            }),
          );
          await prisma.consultationAudio.updateMany({
            where: { id: audio.id, stagingObjectKey: audio.stagingObjectKey },
            data: { stagingObjectKey: null },
          });
          stagingDeleted++;
        }
        cursor = audio.id;
      }
      if (audios.length < BATCH_SIZE) break;
    }
    console.log(
      JSON.stringify({
        job: "expire-audio",
        mode: apply ? "apply" : "dry-run",
        cutoff: cutoff.toISOString(),
        examined,
        deleted,
        clinicalExamined,
        clinicalDeleted,
        stagingExamined,
        stagingDeleted,
      }),
    );
  } finally {
    client.destroy();
    await prisma.$disconnect();
  }
}

await main();
