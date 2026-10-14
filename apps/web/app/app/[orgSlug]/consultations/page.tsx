import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConsultationsForbidden } from "@/components/flowcare/consultations/consultations-forbidden";
import { ConsultationsView } from "@/components/flowcare/consultations/consultations-view";
import { canOpenSection } from "@/lib/app-navigation";
import {
  ConsultationsApiError,
  getConsultations,
  type ListConsultationsResponse,
} from "@/server/consultations";
import { getAvailableOrganizations } from "@/server/organizations";

export const metadata: Metadata = {
  title: "Atendimentos Clínicos | Flowcare",
};

export default async function ConsultationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    period?: string;
    status?: string;
    page?: string;
    cursor?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const sp = await searchParams;

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );

  if (!current) {
    notFound();
  }

  // Role check: Only ADMIN_PROFESSIONAL and PROFESSIONAL have clinical access.
  // If role is RECEPTIONIST or non-clinical ADMIN, render clean 403 / "Acesso restrito à equipe clínica" message.
  if (!canOpenSection(current.role, "consultations")) {
    return <ConsultationsForbidden orgSlug={orgSlug} />;
  }

  let data: ListConsultationsResponse | null = null;
  let errorMessage: string | null = null;

  try {
    data = await getConsultations(orgSlug, {
      period: sp.period,
      status: sp.status,
      page: sp.page ? Math.max(1, Number(sp.page) || 1) : undefined,
      cursor: sp.cursor,
    });
  } catch (error) {
    if (error instanceof ConsultationsApiError && error.code === "FORBIDDEN") {
      return <ConsultationsForbidden orgSlug={orgSlug} />;
    }
    errorMessage =
      error instanceof Error
        ? error.message
        : "Não foi possível carregar os atendimentos.";
  }

  return (
    <ConsultationsView
      orgSlug={orgSlug}
      data={data}
      errorMessage={errorMessage}
      selectedPeriod={sp.period}
      selectedStatus={sp.status}
    />
  );
}
