"use server";

import { revalidatePath } from "next/cache";
import {
  type ApproveAnamnesisResponse,
  type AudioPresignedUrlResponse,
  approveAnamnesis,
  type ConsultationDetail,
  ConsultationsApiError,
  completeAudioUpload,
  getAudioPresignedUrl,
  getTranscriptionStatus,
  startTranscriptionJob,
  type TranscriptionJobResponse,
  type TranscriptionStatusResult,
  updateAnamnesisDraft,
} from "@/server/consultations";

export interface StartTranscriptionActionResult {
  success: boolean;
  data?: TranscriptionJobResponse;
  error?: string;
  code?: string;
}

export async function startTranscriptionAction(
  orgSlug: string,
  consultationId: string,
  payload: {
    audioUrl?: string;
    storageKey?: string;
    consentConfirmed: boolean;
    idempotencyKey?: string;
  },
): Promise<StartTranscriptionActionResult> {
  try {
    const result = await startTranscriptionJob(
      orgSlug,
      consultationId,
      payload,
    );
    revalidatePath(`/app/${orgSlug}/consultations/${consultationId}`);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof ConsultationsApiError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível iniciar o processamento da transcrição.",
    };
  }
}

export interface AudioPresignedUrlActionResult {
  success: boolean;
  data?: AudioPresignedUrlResponse;
  error?: string;
  code?: string;
}

export async function getAudioPresignedUrlAction(
  orgSlug: string,
  consultationId: string,
  body: { fileName: string; contentType: string; sizeBytes: number },
): Promise<AudioPresignedUrlActionResult> {
  try {
    const result = await getAudioPresignedUrl(orgSlug, consultationId, body);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof ConsultationsApiError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível obter a URL para upload do áudio.",
    };
  }
}

export interface CompleteAudioUploadActionResult {
  success: boolean;
  data?: { audioId: string; status: "UPLOADED" };
  error?: string;
  code?: string;
}

export async function completeAudioUploadAction(
  orgSlug: string,
  consultationId: string,
  audioId: string,
): Promise<CompleteAudioUploadActionResult> {
  try {
    const result = await completeAudioUpload(orgSlug, consultationId, audioId);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof ConsultationsApiError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível concluir o upload do áudio.",
    };
  }
}

export interface TranscriptionStatusActionResult {
  success: boolean;
  data?: TranscriptionStatusResult;
  error?: string;
  code?: string;
}

export async function getTranscriptionStatusAction(
  orgSlug: string,
  consultationId: string,
): Promise<TranscriptionStatusActionResult> {
  try {
    const result = await getTranscriptionStatus(orgSlug, consultationId);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof ConsultationsApiError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível verificar o status da transcrição.",
    };
  }
}

export interface UpdateAnamnesisDraftActionResult {
  success: boolean;
  data?: ConsultationDetail;
  error?: string;
  code?: string;
}

export async function updateAnamnesisDraftAction(
  orgSlug: string,
  consultationId: string,
  payload: {
    content: Record<string, string> | string;
    version: number;
    chiefComplaint?: string;
    clinicalNotes?: string;
  },
): Promise<UpdateAnamnesisDraftActionResult> {
  try {
    const result = await updateAnamnesisDraft(orgSlug, consultationId, payload);
    revalidatePath(`/app/${orgSlug}/consultations/${consultationId}`);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof ConsultationsApiError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível salvar o rascunho da anamnese.",
    };
  }
}

export interface ApproveAnamnesisActionResult {
  success: boolean;
  data?: ApproveAnamnesisResponse;
  error?: string;
  code?: string;
}

export async function approveAnamnesisAction(
  orgSlug: string,
  consultationId: string,
  payload: {
    version: number;
    content?: Record<string, string> | string;
    chiefComplaint?: string;
    clinicalNotes?: string;
  },
): Promise<ApproveAnamnesisActionResult> {
  try {
    const result = await approveAnamnesis(orgSlug, consultationId, payload);
    revalidatePath(`/app/${orgSlug}/consultations/${consultationId}`);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    if (error instanceof ConsultationsApiError) {
      return {
        success: false,
        error: error.message,
        code: error.code,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível aprovar a anamnese.",
    };
  }
}
