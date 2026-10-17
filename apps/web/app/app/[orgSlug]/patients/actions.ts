"use server";

import { revalidatePath } from "next/cache";
import {
  archivePatientAttachment,
  type CreatePatientInput,
  type CreatePatientResponse,
  checkPatientDuplicates as checkPatientDuplicatesServer,
  createPatient as createPatientServer,
  getAttachmentDownloadUrl,
  getPatientOverview as getPatientOverviewServer,
  getPatientTimeline as getPatientTimelineServer,
  type PatientAttachmentItem,
  type PatientOverviewData,
  PatientsApiError,
  type PatientTimelineFilters,
  type PatientTimelineResult,
  type UpdatePatientInput,
  type UpdatePatientResponse,
  updatePatient as updatePatientServer,
  uploadPatientAttachment,
} from "@/server/patients";

export interface CreatePatientActionResult {
  success: boolean;
  data?: CreatePatientResponse["patient"];
  error?: string;
  code?: string;
  existingPatientId?: string;
  conflictField?: string;
}

export async function createPatientAction(
  orgSlug: string,
  input: CreatePatientInput,
): Promise<CreatePatientActionResult> {
  try {
    const result = await createPatientServer(orgSlug, input);
    revalidatePath(`/app/${orgSlug}/patients`);
    return {
      success: true,
      data: result.patient,
    };
  } catch (error) {
    if (error instanceof PatientsApiError) {
      const details = error.details as
        | { existingPatientId?: string; matchedOn?: string }
        | undefined;
      return {
        success: false,
        error: error.message,
        code: error.code,
        existingPatientId: details?.existingPatientId,
        conflictField: details?.matchedOn,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível cadastrar o paciente.",
    };
  }
}

export interface CheckDuplicatesActionResult {
  success: boolean;
  isDuplicate: boolean;
  existingPatientId?: string | null;
  conflictField?: string | null;
  error?: string;
}

export async function checkPatientDuplicatesAction(
  orgSlug: string,
  query: { document?: string; phone?: string },
): Promise<CheckDuplicatesActionResult> {
  try {
    const result = await checkPatientDuplicatesServer(orgSlug, query);
    return {
      success: true,
      isDuplicate: result.isDuplicate,
      existingPatientId: result.existingPatientId ?? null,
      conflictField: result.conflictField ?? null,
    };
  } catch (error) {
    return {
      success: false,
      isDuplicate: false,
      error:
        error instanceof Error
          ? error.message
          : "Erro ao verificar duplicidade.",
    };
  }
}

export interface PatientTimelineActionResult extends PatientTimelineResult {
  success: boolean;
  error?: string;
}

export async function getPatientTimelineAction(
  orgSlug: string,
  patientId: string,
  filters?: PatientTimelineFilters,
): Promise<PatientTimelineActionResult> {
  try {
    const result = await getPatientTimelineServer(orgSlug, patientId, filters);
    return {
      success: true,
      data: result.data,
      pageInfo: result.pageInfo,
      isRestricted: result.isRestricted,
    };
  } catch (error) {
    if (error instanceof PatientsApiError) {
      return {
        success: false,
        error: error.message,
        data: [],
        pageInfo: { limit: 0, hasNextPage: false, nextCursor: null },
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível carregar o prontuário do paciente.",
      data: [],
      pageInfo: { limit: 0, hasNextPage: false, nextCursor: null },
    };
  }
}

export interface ArchivePatientAttachmentActionResult {
  success: boolean;
  error?: string;
  code?: string;
  attachmentId?: string;
}

export async function archivePatientAttachmentAction(
  orgSlug: string,
  patientId: string,
  attachmentId: string,
  reason?: string,
): Promise<ArchivePatientAttachmentActionResult> {
  try {
    await archivePatientAttachment(orgSlug, patientId, attachmentId, reason);
    revalidatePath(`/app/${orgSlug}/patients/${patientId}`);
    return {
      success: true,
      attachmentId,
    };
  } catch (error) {
    if (error instanceof PatientsApiError) {
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
          : "Não foi possível arquivar o anexo.",
    };
  }
}

export interface UploadPatientAttachmentActionResult {
  success: boolean;
  error?: string;
  code?: string;
  attachment?: PatientAttachmentItem;
}

export async function uploadPatientAttachmentAction(
  orgSlug: string,
  patientId: string,
  formData: FormData,
): Promise<UploadPatientAttachmentActionResult> {
  try {
    const result = await uploadPatientAttachment(orgSlug, patientId, formData);
    revalidatePath(`/app/${orgSlug}/patients/${patientId}`);
    return {
      success: true,
      attachment: result.attachment,
    };
  } catch (error) {
    if (error instanceof PatientsApiError) {
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
          : "Não foi possível enviar o anexo.",
    };
  }
}

export interface GetAttachmentDownloadUrlActionResult {
  success: boolean;
  downloadUrl?: string;
  error?: string;
  code?: string;
}

export async function getAttachmentDownloadUrlAction(
  orgSlug: string,
  patientId: string,
  attachmentId: string,
): Promise<GetAttachmentDownloadUrlActionResult> {
  try {
    const result = await getAttachmentDownloadUrl(
      orgSlug,
      patientId,
      attachmentId,
    );
    return {
      success: true,
      downloadUrl: result.downloadUrl,
    };
  } catch (error) {
    if (error instanceof PatientsApiError) {
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
          : "Não foi possível obter o link de download.",
    };
  }
}

export interface UpdatePatientActionResult {
  success: boolean;
  data?: UpdatePatientResponse["patient"];
  error?: string;
  code?: string;
  existingPatientId?: string;
  conflictField?: string;
}

export async function updatePatientAction(
  orgSlug: string,
  patientId: string,
  input: UpdatePatientInput,
): Promise<UpdatePatientActionResult> {
  try {
    const result = await updatePatientServer(orgSlug, patientId, input);
    revalidatePath(`/app/${orgSlug}/patients`);
    revalidatePath(`/app/${orgSlug}/patients/${patientId}`);
    return {
      success: true,
      data: result.patient,
    };
  } catch (error) {
    if (error instanceof PatientsApiError) {
      const details = error.details as
        | { existingPatientId?: string; matchedOn?: string }
        | undefined;
      return {
        success: false,
        error: error.message,
        code: error.code,
        existingPatientId: details?.existingPatientId,
        conflictField: details?.matchedOn,
      };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o paciente.",
    };
  }
}

export interface GetPatientOverviewActionResult {
  success: boolean;
  data?: PatientOverviewData;
  error?: string;
  code?: string;
}

export async function getPatientOverviewAction(
  orgSlug: string,
  patientId: string,
): Promise<GetPatientOverviewActionResult> {
  try {
    const overview = await getPatientOverviewServer(orgSlug, patientId);
    return {
      success: true,
      data: overview,
    };
  } catch (error) {
    if (error instanceof PatientsApiError) {
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
          : "Não foi possível carregar os dados atualizados do paciente.",
    };
  }
}
