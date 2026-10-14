import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canOpenSection } from "@/lib/app-navigation";
import { getAvailableOrganizations } from "@/server/organizations";
import { getPatients, type ListPatientsResponse } from "@/server/patients";
import { PatientsView } from "./patients-view";

export const metadata: Metadata = {
  title: "Pacientes | Flowcare",
};

export default async function PatientsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{
    search?: string;
    cursor?: string;
    page?: string;
    sheet?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const { search = "", cursor, page, sheet } = await searchParams;

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find((org) => org.slug === orgSlug);

  if (!current || !canOpenSection(current.role, "patients")) {
    notFound();
  }

  const currentPage = page ? Math.max(1, Number.parseInt(page, 10) || 1) : 1;

  let patientsResponse: ListPatientsResponse | null = null;
  let hasError = false;
  let errorMessage: string | null = null;

  try {
    patientsResponse = await getPatients(orgSlug, {
      search: search.trim() || undefined,
      cursor: cursor || undefined,
      limit: 10,
    });
  } catch (err) {
    hasError = true;
    errorMessage =
      err instanceof Error
        ? err.message
        : "Ocorreu um erro ao carregar os pacientes.";
  }

  return (
    <PatientsView
      orgSlug={orgSlug}
      initialSearch={search}
      currentPage={currentPage}
      patientsResponse={patientsResponse}
      hasError={hasError}
      errorMessage={errorMessage}
      sheet={sheet}
    />
  );
}
