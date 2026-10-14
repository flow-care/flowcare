"use server";

import { revalidatePath } from "next/cache";
import {
  type CreatePatientInput,
  type CreatePatientResponse,
  checkPatientDuplicates as checkPatientDuplicatesServer,
  createPatient as createPatientServer,
  getPatientTimeline as getPatientTimelineServer,
  PatientsApiError,
  type PatientTimelineFilters,
  type PatientTimelineResult,
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
