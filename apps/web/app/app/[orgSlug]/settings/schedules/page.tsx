import { AlertCircle, RefreshCw, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ScheduleExceptionsResponse,
  ScheduleProfessional,
  WeeklyScheduleResponse,
} from "@/lib/schedules";
import { getAvailableOrganizations } from "@/server/organizations";
import {
  getScheduleExceptions,
  getScheduleProfessionals,
  getWeeklySchedule,
  ScheduleApiError,
} from "@/server/schedules";
import { SchedulesView } from "./schedules-view";

export const metadata: Metadata = {
  title: "Horários de Atendimento e Bloqueios | Flowcare",
};

function SchedulesForbidden({ orgSlug }: { orgSlug: string }) {
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
        Acesso restrito a administradores e profissionais
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Apenas administradores e profissionais de saúde possuem permissão para
        consultar e configurar a grade de funcionamento e os bloqueios de agenda
        da clínica.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/dashboard`}>
          Voltar ao Dashboard
        </Link>
      </Button>
    </div>
  );
}

function SchedulesError({
  orgSlug,
  errorMessage,
}: {
  orgSlug: string;
  errorMessage?: string | null;
}) {
  return (
    <div className="my-8 mx-6 flex flex-col items-center justify-center gap-4 rounded-2xl border border-destructive/20 bg-destructive/5 p-12 text-center text-card-foreground">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-6" />
      </div>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-lg font-semibold text-foreground">
          Não foi possível carregar os horários e bloqueios
        </h2>
        <p className="text-sm text-muted-foreground">
          {errorMessage ||
            "Ocorreu uma falha ao consultar os horários e recessos da clínica. Verifique sua conexão e tente novamente."}
        </p>
      </div>
      <Button asChild variant="outline" className="mt-2 gap-2">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/settings/schedules`}>
          <RefreshCw className="size-4" />
          Tentar novamente
        </Link>
      </Button>
    </div>
  );
}

export default async function SchedulesSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams?: Promise<{
    tab?: string;
    sheet?: string;
    scheduleId?: string;
    professionalId?: string;
  }>;
}) {
  const { orgSlug } = await params;
  const query = (await searchParams) ?? {};

  const organizations = await getAvailableOrganizations();
  const current = organizations?.find((org) => org.slug === orgSlug);

  if (!current) {
    notFound();
  }

  // Role check: Only ADMIN and ADMIN_PROFESSIONAL have access.
  if (current.role !== "ADMIN" && current.role !== "ADMIN_PROFESSIONAL") {
    return <SchedulesForbidden orgSlug={orgSlug} />;
  }

  let weeklySchedule: WeeklyScheduleResponse | null = null;
  let exceptionsData: ScheduleExceptionsResponse | null = null;
  let professionals: ScheduleProfessional[] = [];
  let hasError = false;
  let errorMessage: string | null = null;

  try {
    const [weeklyResult, exceptionsResult, profsResult] = await Promise.all([
      getWeeklySchedule(orgSlug),
      getScheduleExceptions(orgSlug),
      getScheduleProfessionals(orgSlug),
    ]);

    weeklySchedule = weeklyResult;
    exceptionsData = exceptionsResult;
    professionals = profsResult;
  } catch (err) {
    hasError = true;
    if (err instanceof ScheduleApiError && err.code === "FORBIDDEN") {
      return <SchedulesForbidden orgSlug={orgSlug} />;
    }
    errorMessage =
      err instanceof Error
        ? err.message
        : "Ocorreu um erro ao carregar os horários da clínica.";
  }

  if (hasError || !weeklySchedule || !exceptionsData) {
    return <SchedulesError orgSlug={orgSlug} errorMessage={errorMessage} />;
  }

  return (
    <SchedulesView
      orgSlug={orgSlug}
      weeklySchedule={weeklySchedule}
      exceptionsData={exceptionsData}
      professionals={professionals}
      initialTab={query.tab}
      initialSheet={query.sheet}
      initialScheduleId={query.scheduleId}
      initialProfessional={query.professionalId}
    />
  );
}
