"use client";

import {
  CalendarIcon,
  CheckCircle2,
  Clock,
  HelpCircle,
  Info,
  Loader2,
  MicOff,
  ShieldCheck,
  Stethoscope,
  User,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type ClinicUsageResponse,
  calculateUsagePercentage,
  EXPLANATORY_USAGE_NOTICE,
  formatConsultationsCount,
  formatFailedAttemptsCount,
  formatMonthLabel,
  formatPercentage,
  formatUsageDuration,
  getRecentMonthOptions,
  resolveProfessionalSpecialty,
} from "@/lib/usage";

export interface UsageViewProps {
  orgSlug: string;
  data: ClinicUsageResponse;
}

export function UsageView({ orgSlug, data }: UsageViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const baseOptions = useMemo(() => getRecentMonthOptions(), []);
  const monthOptions = useMemo(() => {
    if (data.month && !baseOptions.some((opt) => opt.value === data.month)) {
      return [
        { value: data.month, label: formatMonthLabel(data.month) },
        ...baseOptions,
      ];
    }
    return baseOptions;
  }, [data.month, baseOptions]);

  const handleMonthChange = useCallback(
    (newMonth: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newMonth) {
        params.set("month", newMonth);
      } else {
        params.delete("month");
      }
      const qs = params.toString();
      startTransition(() => {
        router.push(
          `/app/${encodeURIComponent(orgSlug)}/settings/usage${qs ? `?${qs}` : ""}`,
        );
      });
    },
    [router, searchParams, orgSlug],
  );

  const hasActivity =
    data.processedSeconds > 0 ||
    data.transcribedConsultations > 0 ||
    data.successfulAudioCount > 0 ||
    data.failedAudioCount > 0 ||
    data.byProfessional.length > 0;

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Consumo de Transcrições
              </h1>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Informações sobre cálculo de consumo"
                  >
                    <HelpCircle className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-sm">
                  <p>{EXPLANATORY_USAGE_NOTICE}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <p className="text-sm text-muted-foreground">
              Acompanhamento de minutos processados por inteligência artificial
            </p>
          </div>

          {/* Month/Year Selector */}
          <div className="flex items-center gap-3">
            {isPending && (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            )}
            <div className="w-[200px]">
              <Select
                value={data.month}
                onValueChange={handleMonthChange}
                disabled={isPending}
              >
                <SelectTrigger
                  id="month-selector"
                  aria-label="Selecionar mês de referência"
                  className="w-full h-10 border-border bg-card shadow-2xs font-normal text-sm"
                >
                  <div className="flex items-center gap-2 truncate">
                    <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder="Selecione o mês" />
                  </div>
                </SelectTrigger>
                <SelectContent align="end">
                  {monthOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* KPI Summary Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* KPI 1: Minutos Totais */}
          <Card className="border-border bg-card shadow-2xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Minutos Totais
              </CardTitle>
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Clock className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight text-foreground">
                {formatUsageDuration(data.processedSeconds)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.processedMinutes.toLocaleString("pt-BR", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 2,
                })}{" "}
                minutos processados no período
              </p>
            </CardContent>
          </Card>

          {/* KPI 2: Consultas Transcritas */}
          <Card className="border-border bg-card shadow-2xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Consultas Transcritas
              </CardTitle>
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CheckCircle2 className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight text-foreground">
                {formatConsultationsCount(data.transcribedConsultations)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.successfulAudioCount}{" "}
                {data.successfulAudioCount === 1
                  ? "áudio concluído com sucesso"
                  : "áudios concluídos com sucesso"}
              </p>
            </CardContent>
          </Card>

          {/* KPI 3: Falhas Isentas */}
          <Card className="border-border bg-card shadow-2xs">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Falhas Isentas
              </CardTitle>
              <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <ShieldCheck className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight text-foreground">
                {formatFailedAttemptsCount(data.failedAudioCount)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Isenção total para interrupções técnicas
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Explanatory Banner Card */}
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card/60 p-4 shadow-2xs text-sm">
          <Info className="size-5 shrink-0 text-primary mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-medium text-foreground">
              Critério de Contabilização
            </p>
            <p className="text-muted-foreground text-xs sm:text-sm">
              {EXPLANATORY_USAGE_NOTICE}
            </p>
          </div>
        </div>

        {/* Breakdown by Doctor / Professional Table */}
        <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
          <div className="p-5 border-b border-border">
            <h2 className="text-base font-semibold tracking-tight text-foreground">
              Detalhamento por profissional
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Distribuição dos minutos e consultas processadas entre os
              profissionais da clínica
            </p>
          </div>

          {!hasActivity || data.byProfessional.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <MicOff className="size-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-medium text-foreground">
                Nenhum processamento de áudio registrado neste período
              </h3>
              <p className="mt-1 max-w-sm text-xs sm:text-sm text-muted-foreground">
                Quando consultas forem gravadas e transcritas pela inteligência
                artificial neste mês, o consumo detalhado será exibido aqui.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[40%] font-medium">
                      Profissional
                    </TableHead>
                    <TableHead className="w-[35%] font-medium">
                      Minutos Utilizados (% do total)
                    </TableHead>
                    <TableHead className="w-[25%] text-right font-medium">
                      Atendimentos Transcritos
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byProfessional.map((prof) => {
                    const pct = calculateUsagePercentage(
                      prof.processedSeconds,
                      data.processedSeconds,
                    );
                    const specialty = resolveProfessionalSpecialty(prof);

                    return (
                      <TableRow
                        key={prof.professionalId}
                        className="hover:bg-muted/40"
                      >
                        <TableCell className="py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                              {prof.professionalId === "unassigned" ? (
                                <User className="size-4" />
                              ) : (
                                <Stethoscope className="size-4" />
                              )}
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-medium text-foreground truncate">
                                {prof.professionalName}
                              </span>
                              <span className="text-xs text-muted-foreground truncate">
                                {specialty}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3">
                          <div className="flex flex-col gap-1.5 max-w-xs">
                            <div className="flex items-center justify-between text-xs font-medium">
                              <span className="text-foreground">
                                {prof.processedMinutes.toLocaleString("pt-BR", {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 2,
                                })}{" "}
                                min
                              </span>
                              <span className="text-muted-foreground">
                                {formatPercentage(pct)}
                              </span>
                            </div>
                            <Progress
                              value={pct}
                              className="h-1.5 w-full bg-muted"
                            />
                          </div>
                        </TableCell>
                        <TableCell className="py-3 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Badge
                              variant="secondary"
                              className="font-normal text-xs"
                            >
                              {prof.successfulAudioCount}{" "}
                              {prof.successfulAudioCount === 1
                                ? "atendimento"
                                : "atendimentos"}
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
