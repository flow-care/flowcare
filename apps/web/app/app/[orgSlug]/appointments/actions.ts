"use server";

import { revalidatePath } from "next/cache";
import {
  type ConfirmationDecisionOrigin,
  type ManualConfirmationDecision,
  recordManualConfirmation,
} from "@/server/confirmations";

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
