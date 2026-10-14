"use server";

import {
  type AvailabilityResponse,
  type CreateAppointmentInput,
  type CreateAppointmentResponse,
  checkAvailability as checkAvailabilityServer,
  createAppointment as createAppointmentServer,
  getProfessionals as getProfessionalsServer,
  type PatientSearchResultItem,
  type ProfessionalItem,
  searchPatients as searchPatientsServer,
} from "@/server/appointments";
import {
  getReceptionQueue,
  type ReceptionQueueItem,
  type ReceptionQueueTargetStatus,
  updateReceptionQueueStatus,
} from "@/server/reception";

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
