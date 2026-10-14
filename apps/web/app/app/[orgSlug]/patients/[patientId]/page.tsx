import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canOpenSection, isClinicalRole } from "@/lib/app-navigation";
import { getAvailableOrganizations } from "@/server/organizations";
import {
  getPatientAttachments,
  getPatientOverview,
  getPatientTimeline,
  type PatientOverviewData,
  PatientsApiError,
} from "@/server/patients";
import { PatientProfileView } from "./patient-profile-view";

export const metadata: Metadata = {
  title: "Perfil do Paciente | Flowcare",
};

export default async function PatientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; patientId: string }>;
  searchParams: Promise<{ tab?: string; sheet?: string }>;
}) {
  const { orgSlug, patientId } = await params;
  const { tab = "overview", sheet } = await searchParams;

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find((org) => org.slug === orgSlug);

  if (!current || !canOpenSection(current.role, "patients")) {
    notFound();
  }

  let overview: PatientOverviewData;
  try {
    overview = await getPatientOverview(orgSlug, patientId);
  } catch (err) {
    if (
      err instanceof PatientsApiError &&
      (err.code === "NOT_FOUND" || err.code === "FORBIDDEN")
    ) {
      notFound();
    }
    if (
      err instanceof Error &&
      (err.message.includes("não encontrado") || err.message.includes("404"))
    ) {
      notFound();
    }
    throw err;
  }

  const clinicalUser = isClinicalRole(current.role) && !overview.isRestricted;

  const [timeline, attachments] = await Promise.all([
    clinicalUser
      ? getPatientTimeline(orgSlug, patientId)
      : Promise.resolve({
          data: [],
          pageInfo: { limit: 0, hasNextPage: false, nextCursor: null },
          isRestricted: true,
        }),
    clinicalUser
      ? getPatientAttachments(orgSlug, patientId)
      : Promise.resolve({ data: [], isRestricted: true }),
  ]);

  return (
    <PatientProfileView
      orgSlug={orgSlug}
      userRole={current.role}
      overview={overview}
      timeline={timeline}
      attachments={attachments}
      initialTab={tab}
      initialSheet={sheet}
    />
  );
}
