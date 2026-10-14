import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import {
  ConsultationAudioService,
  validateAudio,
} from "../src/modules/consultations/audio-service";
import type { ConsultationAudioStore } from "../src/services/consultation-audio-store";

const org = "11111111-1111-4111-8111-111111111111";
const otherOrg = "22222222-2222-4222-8222-222222222222";
const consultationId = "33333333-3333-4333-8333-333333333333";
const professionalId = "44444444-4444-4444-8444-444444444444";
const otherProfessional = "55555555-5555-4555-8555-555555555555";
const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01]);

function fixture() {
  const objects = new Map<string, Uint8Array>();
  const audios: Array<Record<string, unknown>> = [];
  const jobs: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  let failPut = false;
  let failJob = false;

  const store: ConsultationAudioStore = {
    async put(key, bytes) {
      if (failPut) throw new Error("R2 failed");
      objects.set(key, bytes);
    },
    async read(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("Missing object");
      return bytes;
    },
    async delete(key) {
      objects.delete(key);
    },
    async signedUploadUrl(key) {
      return `https://private.example/${key}?expires=600`;
    },
  };

  const prisma = {
    consultation: {
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string };
      }) =>
        where.id === consultationId && where.organizationId === org
          ? { id: consultationId, professionalId, status: "IN_PROGRESS" }
          : null,
    },
    consultationAudio: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const record = { id: crypto.randomUUID(), ...data };
        audios.push(record);
        return record;
      },
      findFirst: async ({
        where,
      }: {
        where: { id: string; organizationId: string; consultationId: string };
      }) =>
        audios.find(
          (audio) =>
            audio.id === where.id &&
            audio.organizationId === where.organizationId &&
            audio.consultationId === where.consultationId,
        ) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status: string };
        data: Record<string, unknown>;
      }) => {
        const record = audios.find(
          (audio) => audio.id === where.id && audio.status === where.status,
        );
        if (!record) return { count: 0 };
        Object.assign(record, data);
        return { count: 1 };
      },
    },
    audioProcessing: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (failJob) throw new Error("DB failed");
        jobs.push(data);
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
      },
    },
    $transaction: async <T>(callback: (tx: unknown) => Promise<T>) => {
      const before = audios.length;
      try {
        return await callback(prisma);
      } catch (error) {
        audios.splice(before);
        throw error;
      }
    },
  } as unknown as PrismaClient;
  return {
    service: new ConsultationAudioService(prisma, store),
    objects,
    audios,
    jobs,
    audits,
    setFailPut(value: boolean) {
      failPut = value;
    },
    setFailJob(value: boolean) {
      failJob = value;
    },
  };
}

describe("consultation audio consent and private upload", () => {
  test("rejects missing consent before storing or processing", async () => {
    const f = fixture();
    const file = new File([webm], "audio.webm", { type: "audio/webm" });
    await expect(
      f.service.upload(org, consultationId, professionalId, {
        audioFile: file,
        consentConfirmed: false,
      }),
    ).rejects.toMatchObject({
      code: "BUSINESS_RULE_VIOLATION",
      httpStatus: 422,
    });
    expect(f.objects.size).toBe(0);
    expect(f.jobs).toHaveLength(0);
  });

  test("enforces clinic and assigned professional", async () => {
    const f = fixture();
    const file = new File([webm], "audio.webm", { type: "audio/webm" });
    await expect(
      f.service.upload(otherOrg, consultationId, professionalId, {
        audioFile: file,
        consentConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      f.service.upload(org, consultationId, otherProfessional, {
        audioFile: file,
        consentConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.objects.size).toBe(0);
  });

  test("rejects disguised content and incorrect size", () => {
    expect(() =>
      validateAudio(new TextEncoder().encode("not audio"), "audio/webm"),
    ).toThrow(ApiError);
    expect(() => validateAudio(webm, "audio/mpeg")).toThrow(ApiError);
    expect(() => validateAudio(webm, "audio/webm", webm.length + 1)).toThrow(
      ApiError,
    );
  });

  test("upload failure and transaction failure leave no processing or object", async () => {
    const f = fixture();
    const body = {
      audioFile: new File([webm], "audio.webm", { type: "audio/webm" }),
      consentConfirmed: true,
    };
    f.setFailPut(true);
    await expect(
      f.service.upload(org, consultationId, professionalId, body),
    ).rejects.toThrow("R2 failed");
    f.setFailPut(false);
    f.setFailJob(true);
    await expect(
      f.service.upload(org, consultationId, professionalId, body),
    ).rejects.toThrow("DB failed");
    expect(f.objects.size).toBe(0);
    expect(f.audios).toHaveLength(0);
    expect(f.jobs).toHaveLength(0);
  });

  test("signed flow creates processing only after validating uploaded bytes", async () => {
    const f = fixture();
    const prepared = await f.service.prepare(
      org,
      consultationId,
      professionalId,
      {
        contentType: "audio/webm",
        sizeBytes: webm.length,
        consentConfirmed: true,
      },
    );
    expect(prepared.expiresInSeconds).toBe(600);
    expect(f.jobs).toHaveLength(0);
    await expect(
      f.service.finalize(org, consultationId, prepared.audioId, professionalId),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
    const key = f.audios[0]?.objectKey as string;
    f.objects.set(key, new TextEncoder().encode("not audio"));
    await expect(
      f.service.finalize(org, consultationId, prepared.audioId, professionalId),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(f.jobs).toHaveLength(0);
    f.objects.set(key, webm);
    await f.service.finalize(
      org,
      consultationId,
      prepared.audioId,
      professionalId,
    );
    const privateKey = f.audios[0]?.objectKey as string;
    expect(privateKey).not.toBe(key);
    expect(f.objects.has(privateKey)).toBe(true);
    f.objects.set(
      key,
      new TextEncoder().encode("re-uploaded after completion"),
    );
    await f.service.finalize(
      org,
      consultationId,
      prepared.audioId,
      professionalId,
    );
    expect(f.jobs).toHaveLength(1);
    expect(
      f.audits.filter(
        (audit) => audit.action === "CONSULTATION_AUDIO_UPLOADED",
      ),
    ).toHaveLength(1);
  });

  test("expired link and copy failure never enqueue processing", async () => {
    const f = fixture();
    const expired = await f.service.prepare(
      org,
      consultationId,
      professionalId,
      {
        contentType: "audio/webm",
        sizeBytes: webm.length,
        consentConfirmed: true,
      },
    );
    const record = f.audios[0];
    if (!record) throw new Error("Expected pending audio");
    record.uploadExpiresAt = new Date(Date.now() - 1000);
    f.objects.set(record.objectKey as string, webm);
    await expect(
      f.service.finalize(org, consultationId, expired.audioId, professionalId),
    ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
    expect(f.jobs).toHaveLength(0);

    record.uploadExpiresAt = new Date(Date.now() + 600_000);
    f.setFailPut(true);
    await expect(
      f.service.finalize(org, consultationId, expired.audioId, professionalId),
    ).rejects.toThrow("R2 failed");
    expect(record.status).toBe("PENDING_UPLOAD");
    expect(f.jobs).toHaveLength(0);
  });
});
