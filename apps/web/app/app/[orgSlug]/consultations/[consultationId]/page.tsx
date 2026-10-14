import { ChevronLeft, Stethoscope } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsultationsForbidden } from "@/components/flowcare/consultations/consultations-forbidden";
import { Button } from "@/components/ui/button";
import { canOpenSection } from "@/lib/app-navigation";
import { getAvailableOrganizations } from "@/server/organizations";

export const metadata: Metadata = {
  title: "Atendimento Clínico | Flowcare",
};

export default async function ConsultationDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; consultationId: string }>;
}) {
  const { orgSlug, consultationId } = await params;
  const organizations = await getAvailableOrganizations();
  const current = organizations?.find(
    (organization) => organization.slug === orgSlug,
  );

  if (!current) {
    notFound();
  }

  if (!canOpenSection(current.role, "consultations")) {
    return <ConsultationsForbidden orgSlug={orgSlug} />;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="-ml-2 mb-4 text-muted-foreground hover:text-foreground"
        >
          <Link href={`/app/${encodeURIComponent(orgSlug)}/consultations`}>
            <ChevronLeft className="mr-1 size-4" />
            Voltar para atendimentos
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Stethoscope className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Atendimento Clínico
            </h1>
            <p className="text-sm text-muted-foreground">
              Identificador: {consultationId}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
