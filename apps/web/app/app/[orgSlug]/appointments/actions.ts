"use server";

import { revalidatePath } from "next/cache";
import {
  AppointmentsApiError,
  type AvailabilityResponse,
  type CreateAppointmentInput,
  type CreateAppointmentResponse,
  checkAvailability as checkAvailabilityServer,
  createAppointment as createAppointmentServer,
  getProfessionals as getProfessionalsServer,
  type PatientSearchResultItem,
  type ProfessionalItem,
  searchPatients as searchPatientsServer,
  type UpdateAppointmentInput,
  type UpdateAppointmentResponse,
  updateAppointment as updateAppointmentServer,
} from "@/server/appointments";
import {
  type ConfirmationDecisionOrigin,
  type ManualConfirmationDecision,
  recordManualConfirmation,
} from "@/server/confirmations";
import {
  getReceptionQueue,
  type ReceptionQueueItem,
  type ReceptionQueueTargetStatus,
  updateReceptionQueueStatus,
} from "@/server/reception";

export interface RecordConfirmationActionResult {
  success: boolean;
  error?: string;
}

export async function recordConfirmationAction(
  orgSlug: string,
  appointmentId: string,
  decision: ManualConfirmationDecision,
  notes?: string,
  origin?: ConfirmationDecisionOrigin,
): Promise<RecordConfirmationActionResult> {
  try {
    await recordManualConfirmation(
      orgSlug,
      appointmentId,
      decision,
      notes,
      origin,
    );
    revalidatePath(`/app/${orgSlug}/appointments`);
    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Ocorreu um erro ao registrar a confirmação.";
    return { success: false, error: message };
  }
}

export async function searchPatients(
  orgSlug: string,
  term = "",
): Promise<PatientSearchResultItem[]> {
  return searchPatientsServer(orgSlug, term);
}

export async function getProfessionals(
  orgSlug: string,
): Promise<ProfessionalItem[]> {
  return getProfessionalsServer(orgSlug);
}

export async function createAppointment(
  orgSlug: string,
  input: CreateAppointmentInput,
): Promise<CreateAppointmentResponse> {
  return createAppointmentServer(orgSlug, input);
}

export async function updateAppointmentAction(
  orgSlug: string,
  appointmentId: string,
  input: UpdateAppointmentInput,
): Promise<
  | { success: true; data: UpdateAppointmentResponse }
  | { success: false; error: string; code?: string }
> {
  try {
    const result = await updateAppointmentServer(orgSlug, appointmentId, input);
    revalidatePath(`/app/${orgSlug}/appointments`);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof AppointmentsApiError) {
      return { success: false, error: error.message, code: error.code };
    }
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o agendamento.",
    };
  }
}

export async function updateAppointment(
  orgSlug: string,
  appointmentId: string,
  input: UpdateAppointmentInput,
): Promise<UpdateAppointmentResponse> {
  return updateAppointmentServer(orgSlug, appointmentId, input);
}

export async function checkAvailability(
  orgSlug: string,
  query: { date: string; professionalId: string },
): Promise<AvailabilityResponse> {
  return checkAvailabilityServer(orgSlug, query);
}

export async function getReceptionQueueAction(
  orgSlug: string,
  date?: string,
): Promise<
  | { success: true; data: ReceptionQueueItem[] }
  | { success: false; error: string }
> {
  try {
    const result = await getReceptionQueue(orgSlug, date);
    return { success: true, data: result.queue ?? result };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível carregar a fila da recepção.",
    };
  }
}

export async function updateReceptionQueueStatusAction(
  orgSlug: string,
  appointmentId: string,
  targetStatus: ReceptionQueueTargetStatus,
  version?: number,
): Promise<
  | { success: true; data: ReceptionQueueItem }
  | { success: false; error: string }
> {
  try {
    const updated = await updateReceptionQueueStatus(
      orgSlug,
      appointmentId,
      targetStatus,
      version,
    );
    return { success: true, data: updated };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível atualizar o status da fila.",
    };
  }
}
