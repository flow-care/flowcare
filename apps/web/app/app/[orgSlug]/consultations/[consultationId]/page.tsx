import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConsultationDetailView } from "@/components/flowcare/consultations/consultation-detail-view";
import { ConsultationsForbidden } from "@/components/flowcare/consultations/consultations-forbidden";
import { canOpenSection } from "@/lib/app-navigation";
import {
  type ConsultationDetail,
  ConsultationsApiError,
  getConsultationDetails,
} from "@/server/consultations";
import { getAvailableOrganizations } from "@/server/organizations";
import { getPatientOverview, type PatientOverview } from "@/server/patients";

export const metadata: Metadata = {
  title: "Atendimento Clínico | Flowcare",
};

export default async function ConsultationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; consultationId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { orgSlug, consultationId } = await params;
  const { tab } = await searchParams;

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );

  if (!current) {
    notFound();
  }

  // Role check: Clinical roles (ADMIN_PROFESSIONAL, PROFESSIONAL) only.
  // Non-clinical roles see clean 403 / "Acesso restrito à equipe clínica".
  if (!canOpenSection(current.role, "consultations")) {
    return <ConsultationsForbidden orgSlug={orgSlug} />;
  }

  let consultation: ConsultationDetail;
  try {
    consultation = await getConsultationDetails(orgSlug, consultationId);
  } catch (error) {
    if (error instanceof ConsultationsApiError) {
      if (error.code === "FORBIDDEN") {
        return <ConsultationsForbidden orgSlug={orgSlug} />;
      }
      if (error.code === "NOT_FOUND") {
        notFound();
      }
    }
    throw error;
  }

  // Fetch patient overview if available to enrich patient summary card (age, allergies, alerts, insurance)
  let patientOverview: PatientOverview | null = null;
  if (consultation.patientId) {
    try {
      patientOverview = await getPatientOverview(
        orgSlug,
        consultation.patientId,
      );
    } catch {
      patientOverview = null;
    }
  }

  return (
    <ConsultationDetailView
      orgSlug={orgSlug}
      consultation={consultation}
      patientOverview={patientOverview}
      activeTab={tab}
      userRole={current.role}
    />
  );
}
