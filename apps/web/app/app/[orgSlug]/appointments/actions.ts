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
