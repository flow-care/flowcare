import { AlertCircle, RefreshCw, ShieldAlert, Stethoscope } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type DoctorAnamnesisTopicsResponse,
  mergeWithDefaultTopics,
} from "@/lib/anamnesis-topics";
import {
  AnamnesisTopicsApiError,
  getDoctorAnamnesisTopics,
} from "@/server/anamnesis-topics";
import { getCurrentUser } from "@/server/invites";
import { getAvailableOrganizations } from "@/server/organizations";
import { getTeamMembersAndInvites } from "@/server/team";
import {
  AnamnesisTopicsForm,
  type ProfessionalOption,
} from "./anamnesis-topics-form";

export const metadata: Metadata = {
  title: "Tópicos de Anamnese por Médico | Flowcare",
};

export function AnamnesisForbidden({ orgSlug }: { orgSlug: string }) {
  return (
    <div className="flex min-h-[420px] w-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldAlert className="size-6 text-muted-foreground" />
      </div>
      <Badge
        variant="outline"
        className="mb-3 text-xs font-semibold text-muted-foreground"
      >
        403 — Acesso Restrito
      </Badge>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Acesso restrito a profissionais clínicos e administradores
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Apenas profissionais médicos e administradores autorizados possuem
        permissão para configurar a estrutura e ordem dos tópicos de anamnese
        clínica orientados por IA.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/dashboard`}>
          Voltar ao Dashboard
        </Link>
      </Button>
    </div>
  );
}

export function AnamnesisError({
  orgSlug,
  errorMessage,
}: {
  orgSlug: string;
  errorMessage?: string | null;
}) {
  return (
    <div className="my-8 mx-auto flex max-w-2xl flex-col items-center justify-center gap-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-12 text-center text-card-foreground">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-6" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">
          Não foi possível carregar as preferências de anamnese
        </h2>
        <p className="text-sm text-muted-foreground">
          {errorMessage ||
            "Ocorreu uma falha ao consultar os tópicos clínicos. Verifique sua conexão e tente novamente."}
        </p>
      </div>
      <Button asChild variant="outline" className="mt-2 gap-2">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/settings/anamnesis`}>
          <RefreshCw className="size-4" />
          Tentar novamente
        </Link>
      </Button>
    </div>
  );
}

export default async function AnamnesisSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams?: Promise<{ professionalId?: string }>;
}) {
  const { orgSlug } = await params;
  const query = (await searchParams) ?? {};

  const [organizations, currentUser] = await Promise.all([
    getAvailableOrganizations(),
    getCurrentUser(),
  ]);

  const current = organizations?.find((org) => org.slug === orgSlug);
  if (!current) {
    notFound();
  }

  // Role check: Clinical roles (ADMIN_PROFESSIONAL, PROFESSIONAL) or ADMIN have access.
  const allowedRoles = ["ADMIN", "ADMIN_PROFESSIONAL", "PROFESSIONAL"];
  if (!allowedRoles.includes(current.role)) {
    return <AnamnesisForbidden orgSlug={orgSlug} />;
  }

  // Fetch team members to identify medical professionals
  let teamMembers: ProfessionalOption[] = [];
  try {
    const teamData = await getTeamMembersAndInvites(orgSlug);
    teamMembers = teamData.members
      .filter(
        (m) =>
          m.status === "ACTIVE" &&
          (m.role === "PROFESSIONAL" || m.role === "ADMIN_PROFESSIONAL"),
      )
      .map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.userName,
        email: m.email,
        role: m.role,
      }));
  } catch {
    // If team fetching fails, fallback to current user if clinical
  }

  const currentUserId = currentUser?.id ?? "";

  // If no doctors are found in team list, but current user is clinical, ensure they appear
  if (
    teamMembers.length === 0 &&
    (current.role === "PROFESSIONAL" ||
      current.role === "ADMIN_PROFESSIONAL") &&
    currentUserId
  ) {
    teamMembers.push({
      id: currentUserId,
      userId: currentUserId,
      name: currentUser?.fullName || "Profissional",
      email: currentUser?.email || "",
      role: current.role,
    });
  }

  // Determine selected professional ID:
  let selectedProfessionalId = "";
  if (
    query.professionalId &&
    teamMembers.some((p) => p.userId === query.professionalId)
  ) {
    selectedProfessionalId = query.professionalId;
  } else if (teamMembers.some((p) => p.userId === currentUserId)) {
    selectedProfessionalId = currentUserId;
  } else if (teamMembers.length > 0 && teamMembers[0]?.userId) {
    selectedProfessionalId = teamMembers[0].userId;
  } else {
    selectedProfessionalId = currentUserId || "default";
  }

  let anamnesisData: DoctorAnamnesisTopicsResponse | null = null;
  let hasError = false;
  let errorMessage: string | null = null;

  try {
    if (selectedProfessionalId && selectedProfessionalId !== "default") {
      anamnesisData = await getDoctorAnamnesisTopics(
        orgSlug,
        selectedProfessionalId,
      );
    } else {
      anamnesisData = {
        professionalId: selectedProfessionalId,
        version: 0,
        revisionId: null,
        topics: mergeWithDefaultTopics([]),
      };
    }
  } catch (err) {
    if (
      err instanceof AnamnesisTopicsApiError &&
      err.code === "PERMISSION_DENIED"
    ) {
      // If permission denied when querying another professional's config, show fallback defaults
      anamnesisData = {
        professionalId: selectedProfessionalId,
        version: 0,
        revisionId: null,
        topics: mergeWithDefaultTopics([]),
      };
    } else {
      hasError = true;
      errorMessage =
        err instanceof Error
          ? err.message
          : "Não foi possível carregar a estrutura de anamnese.";
    }
  }

  if (hasError || !anamnesisData) {
    return <AnamnesisError orgSlug={orgSlug} errorMessage={errorMessage} />;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 p-6 md:p-8">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Stethoscope className="size-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Tópicos de Anamnese por Médico
          </h1>
        </div>
        <p className="text-sm text-muted-foreground md:text-base">
          Configure a ordem e os tópicos clínicos utilizados pela inteligência
          artificial
        </p>
      </div>

      <AnamnesisTopicsForm
        orgSlug={orgSlug}
        professionals={teamMembers}
        selectedProfessionalId={selectedProfessionalId}
        initialTopics={anamnesisData.topics}
        initialVersion={anamnesisData.version}
        currentUserId={currentUserId}
        currentUserRole={current.role}
      />
    </div>
  );
}
