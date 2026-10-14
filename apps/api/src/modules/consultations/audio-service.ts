import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type { ConsultationAudioStore } from "../../services/consultation-audio-store";
import {
  MAX_AUDIO_BYTES,
  type PrepareAudioBody,
  type UploadAudioBody,
} from "./model";

const UPLOAD_TTL_SECONDS = 600;
const AUDIO_TYPES = ["audio/webm", "audio/mpeg", "audio/mp4"] as const;

function actualAudioType(
  bytes: Uint8Array,
): (typeof AUDIO_TYPES)[number] | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  )
    return "audio/webm";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  )
    return "audio/mpeg";
  if (
    bytes.length >= 2 &&
    bytes[0] === 0xff &&
    ((bytes[1] ?? 0) & 0xe0) === 0xe0
  )
    return "audio/mpeg";
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  )
    return "audio/mp4";
  return null;
}

export function validateAudio(
  bytes: Uint8Array,
  declaredType: string,
  expectedSize?: number,
) {
  if (bytes.length > MAX_AUDIO_BYTES) {
    throw new ApiError(
      "FILE_TOO_LARGE",
      413,
      "Áudio excede o limite de 50 MiB.",
    );
  }
  if (
    !bytes.length ||
    (expectedSize !== undefined && bytes.length !== expectedSize)
  ) {
    throw new ApiError("VALIDATION_ERROR", 400, "Tamanho do áudio inválido.");
  }
  if (
    !AUDIO_TYPES.includes(declaredType as (typeof AUDIO_TYPES)[number]) ||
    actualAudioType(bytes) !== declaredType
  ) {
    throw new ApiError("VALIDATION_ERROR", 400, "Conteúdo do áudio inválido.");
  }
}

export class ConsultationAudioService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly store: ConsultationAudioStore | null,
  ) {}

  private async authorize(
    organizationId: string,
    consultationId: string,
    actorUserId: string,
  ) {
    const consultation = await this.prisma.consultation.findFirst({
      where: {
        id: consultationId,
        organizationId,
        patient: { organizationId },
      },
      select: { id: true, professionalId: true, status: true },
    });
    if (!consultation)
      throw new ApiError("NOT_FOUND", 404, "Atendimento não encontrado.");
    if (consultation.professionalId !== actorUserId)
      throw new ApiError(
        "PERMISSION_DENIED",
        403,
        "Profissional não autorizado para este atendimento.",
      );
    if (consultation.status !== "IN_PROGRESS")
      throw new ApiError(
        "BUSINESS_RULE_VIOLATION",
        422,
        "Atendimento não está em andamento.",
      );
  }

  private requireStore() {
    if (!this.store)
      throw new ApiError(
        "STORAGE_UNAVAILABLE",
        503,
        "Armazenamento indisponível.",
      );
    return this.store;
  }

  async upload(
    organizationId: string,
    consultationId: string,
    actorUserId: string,
    body: UploadAudioBody,
  ) {
    if (body.consentConfirmed !== "true" && body.consentConfirmed !== true) {
      throw new ApiError(
        "BUSINESS_RULE_VIOLATION",
        422,
        "Consentimento do paciente é obrigatório.",
      );
    }
    await this.authorize(organizationId, consultationId, actorUserId);
    const store = this.requireStore();
    if (body.audioFile.size > MAX_AUDIO_BYTES) {
      throw new ApiError(
        "FILE_TOO_LARGE",
        413,
        "Áudio excede o limite de 50 MiB.",
      );
    }
    const bytes = new Uint8Array(await body.audioFile.arrayBuffer());
    validateAudio(bytes, body.audioFile.type);
    const objectKey = `organizations/${organizationId}/audio/${crypto.randomUUID()}`;
    await store.put(objectKey, bytes, body.audioFile.type);
    try {
      const audio = await this.prisma.$transaction(async (tx) => {
        const created = await tx.consultationAudio.create({
          data: {
            organizationId,
            consultationId,
            uploadedById: actorUserId,
            objectKey,
            contentType: body.audioFile.type,
            sizeBytes: bytes.length,
            status: "UPLOADED",
            consentConfirmedAt: new Date(),
          },
        });
        await tx.audioProcessing.create({
          data: { audioId: created.id, status: "QUEUED" },
        });
        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId,
            action: "CONSULTATION_AUDIO_UPLOADED",
            targetType: "CONSULTATION_AUDIO",
            targetId: created.id,
            metadata: {
              consultationId,
              consentConfirmed: true,
              contentType: created.contentType,
              sizeBytes: created.sizeBytes,
            },
          },
        });
        return created;
      });
      return { audioId: audio.id, status: "UPLOADED" as const };
    } catch (error) {
      await store.delete(objectKey).catch(() => {});
      throw error;
    }
  }

  async prepare(
    organizationId: string,
    consultationId: string,
    actorUserId: string,
    body: PrepareAudioBody,
  ) {
    if (body.consentConfirmed !== true)
      throw new ApiError(
        "BUSINESS_RULE_VIOLATION",
        422,
        "Consentimento do paciente é obrigatório.",
      );
    await this.authorize(organizationId, consultationId, actorUserId);
    const store = this.requireStore();
    const objectKey = `organizations/${organizationId}/audio/${crypto.randomUUID()}`;
    const uploadUrl = await store.signedUploadUrl(
      objectKey,
      body.contentType,
      body.sizeBytes,
    );
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000);
    const audio = await this.prisma.$transaction(async (tx) => {
      const created = await tx.consultationAudio.create({
        data: {
          organizationId,
          consultationId,
          uploadedById: actorUserId,
          objectKey,
          contentType: body.contentType,
          sizeBytes: body.sizeBytes,
          status: "PENDING_UPLOAD",
          consentConfirmedAt: new Date(),
          uploadExpiresAt: expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId,
          action: "CONSULTATION_AUDIO_CONSENTED",
          targetType: "CONSULTATION_AUDIO",
          targetId: created.id,
          metadata: { consultationId, consentConfirmed: true },
        },
      });
      return created;
    });
    return {
      audioId: audio.id,
      uploadUrl,
      expiresInSeconds: 600 as const,
      status: "PENDING_UPLOAD" as const,
    };
  }

  async finalize(
    organizationId: string,
    consultationId: string,
    audioId: string,
    actorUserId: string,
  ) {
    await this.authorize(organizationId, consultationId, actorUserId);
    const audio = await this.prisma.consultationAudio.findFirst({
      where: { id: audioId, organizationId, consultationId },
    });
    if (!audio) throw new ApiError("NOT_FOUND", 404, "Áudio não encontrado.");
    if (audio.uploadedById !== actorUserId)
      throw new ApiError(
        "PERMISSION_DENIED",
        403,
        "Profissional não autorizado para este áudio.",
      );
    if (audio.status === "UPLOADED")
      return { audioId, status: "UPLOADED" as const };
    if (!audio.uploadExpiresAt || audio.uploadExpiresAt <= new Date()) {
      throw new ApiError(
        "BUSINESS_RULE_VIOLATION",
        422,
        "Link de envio expirado.",
      );
    }
    const store = this.requireStore();
    const stagingKey = audio.objectKey;
    let bytes: Uint8Array;
    try {
      bytes = await store.read(stagingKey);
    } catch {
      throw new ApiError(
        "BUSINESS_RULE_VIOLATION",
        422,
        "Envio do áudio ainda não foi concluído.",
      );
    }
    try {
      validateAudio(bytes, audio.contentType, audio.sizeBytes);
    } catch (error) {
      await store.delete(stagingKey).catch(() => {});
      throw error;
    }
    // A signed PUT can be reused until expiry. Processing reads from a new,
    // private key that was never exposed in an upload URL.
    const finalKey = `organizations/${organizationId}/audio/${crypto.randomUUID()}`;
    await store.put(finalKey, bytes, audio.contentType);
    let committed = false;
    try {
      committed = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.consultationAudio.updateMany({
          where: {
            id: audioId,
            organizationId,
            consultationId,
            status: "PENDING_UPLOAD",
          },
          data: {
            status: "UPLOADED",
            objectKey: finalKey,
            stagingObjectKey: stagingKey,
          },
        });
        if (!updated.count) return false;
        await tx.audioProcessing.create({
          data: { audioId, status: "QUEUED" },
        });
        await tx.auditLog.create({
          data: {
            organizationId,
            actorUserId,
            action: "CONSULTATION_AUDIO_UPLOADED",
            targetType: "CONSULTATION_AUDIO",
            targetId: audioId,
            metadata: {
              consultationId,
              contentType: audio.contentType,
              sizeBytes: audio.sizeBytes,
            },
          },
        });
        return true;
      });
    } catch (error) {
      await store.delete(finalKey).catch(() => {});
      throw error;
    }
    if (!committed) await store.delete(finalKey).catch(() => {});
    else await store.delete(stagingKey).catch(() => {});
    return { audioId, status: "UPLOADED" as const };
  }
}
