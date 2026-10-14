import { cn } from "cn";
import {
  AlertTriangle,
  CalendarDays,
  CalendarX2,
  CheckCircle2,
  Stethoscope,
  Users,
  UserX,
  XCircle,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  type DashboardMetrics,
  type DashboardPeriod,
  getDashboardMetrics,
} from "@/server/dashboard";
import { RetryButton } from "./retry-button";

export const metadata: Metadata = { title: "Dashboard | Flowcare" };

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Mês" },
];

function formatNoShowRate(rate: number | null): string {
  if (rate === null || Number.isNaN(rate)) {
    return "0%";
  }
  const percentage = rate * 100;
  if (Number.isInteger(percentage)) {
    return `${percentage}%`;
  }
  return `${percentage.toFixed(1).replace(".", ",")}%`;
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { orgSlug } = await params;
  const { period: rawPeriod } = await searchParams;

  const selectedPeriod: DashboardPeriod =
    rawPeriod === "week" || rawPeriod === "month" ? rawPeriod : "today";

  let metrics: DashboardMetrics | null = null;
  let fetchError: string | null = null;

  try {
    metrics = await getDashboardMetrics(orgSlug, selectedPeriod);
  } catch (error) {
    fetchError =
      error instanceof Error
        ? error.message
        : "Não foi possível carregar os dados do dashboard.";
  }

  const quickActions = [
    {
      title: "Agenda",
      description: "Gerencie a grade de horários e os agendamentos da clínica.",
      href: `/app/${encodeURIComponent(orgSlug)}/appointments`,
      icon: CalendarDays,
    },
    {
      title: "Pacientes",
      description: "Consulte o cadastro, histórico de prontuários e contatos.",
      href: `/app/${encodeURIComponent(orgSlug)}/patients`,
      icon: Users,
    },
    {
      title: "Consultas",
      description: "Acesse atendimentos em andamento e registros clínicos.",
      href: `/app/${encodeURIComponent(orgSlug)}/consultations`,
      icon: Stethoscope,
    },
  ];

  return (
    <div className="flex-1 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Visão geral operacional da clínica.
        </p>
      </div>

      {/* Period selector */}
      <div
        role="tablist"
        aria-label="Selecionar período do painel"
        className="inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground"
      >
        {PERIODS.map((item) => {
          const isActive = selectedPeriod === item.value;
          return (
            <Link
              key={item.value}
              href={`/app/${encodeURIComponent(orgSlug)}/dashboard?period=${item.value}`}
              role="tab"
              aria-selected={isActive}
              className={cn(
                "inline-flex items-center justify-center rounded-md px-3 py-1 text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Error state */}
      {fetchError && (
        <div
          role="alert"
          className="flex flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center"
        >
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <h2 className="text-base font-semibold text-foreground">
            Erro ao carregar indicadores
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            {fetchError}
          </p>
          <RetryButton className="mt-4" />
        </div>
      )}

      {/* Indicators */}
      {metrics && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Total de Agendamentos
                </CardTitle>
                <CalendarDays className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {metrics.totalAppointments}
                </div>
                <p className="text-xs text-muted-foreground">
                  {metrics.scheduledAppointments} agendados no período
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Atendimentos Concluídos
                </CardTitle>
                <CheckCircle2 className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {metrics.completedAppointments}
                </div>
                <p className="text-xs text-muted-foreground">
                  Consultas finalizadas
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Cancelamentos
                </CardTitle>
                <XCircle className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {metrics.cancelledAppointments}
                </div>
                <p className="text-xs text-muted-foreground">
                  Agendamentos cancelados
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Faltas / Taxa de Não Comparecimento
                </CardTitle>
                <UserX className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {formatNoShowRate(metrics.noShowRate)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {metrics.noShowAppointments}{" "}
                  {metrics.noShowAppointments === 1
                    ? "falta registrada"
                    : "faltas registradas"}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Empty state when no appointments */}
          {metrics.totalAppointments === 0 && (
            <Empty className="rounded-xl border border-dashed border-border bg-card/40 py-8">
              <EmptyMedia variant="icon">
                <CalendarX2 className="size-5 text-muted-foreground" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>Nenhum agendamento no período</EmptyTitle>
                <EmptyDescription>
                  Não encontramos consultas ou agendamentos cadastrados para o
                  período selecionado.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/app/${encodeURIComponent(orgSlug)}/appointments`}
                  >
                    Acessar agenda
                  </Link>
                </Button>
              </EmptyContent>
            </Empty>
          )}
        </>
      )}

      {/* Quick actions */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">
          Ações rápidas
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.title}
                href={action.href}
                className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/30">
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-base font-medium group-hover:text-primary">
                      {action.title}
                    </CardTitle>
                    <Icon className="size-5 text-muted-foreground transition-colors group-hover:text-primary" />
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {action.description}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
