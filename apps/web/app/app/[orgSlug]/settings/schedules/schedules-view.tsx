"use client";

import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CalendarOff,
  Clock,
  Clock3,
  Edit2,
  Filter,
  Globe,
  Plus,
  Stethoscope,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewScheduleSheet } from "./new-schedule-sheet";
import {
  type DayScheduleGroup,
  filterExceptions,
  formatExceptionDateRange,
  formatTimezoneCallout,
  groupScheduleRulesByDay,
  type ScheduleExceptionsResponse,
  type ScheduleProfessional,
  type WeeklyScheduleResponse,
} from "@/lib/schedules";

export interface SchedulesViewProps {
  orgSlug: string;
  weeklySchedule: WeeklyScheduleResponse;
  exceptionsData: ScheduleExceptionsResponse;
  professionals: ScheduleProfessional[];
  initialTab?: string;
  initialSheet?: string;
  initialScheduleId?: string;
  initialProfessional?: string;
}

export function SchedulesView({
  orgSlug,
  weeklySchedule,
  exceptionsData,
  professionals,
  initialTab,
  initialSheet,
  initialScheduleId,
  initialProfessional,
}: SchedulesViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL state synchronization
  const currentTabParam = searchParams.get("tab") || initialTab || "weekly";
  const currentSheetParam = searchParams.get("sheet") || initialSheet || null;
  const currentScheduleId =
    searchParams.get("scheduleId") || initialScheduleId || null;
  const currentProfParam =
    searchParams.get("professionalId") || initialProfessional || "all";

  const [activeTab, setActiveTab] = useState<string>(currentTabParam);
  const [selectedProfessional, setSelectedProfessional] =
    useState<string>(currentProfParam);

  // Map of professionals for name lookup
  const professionalsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of professionals) {
      map.set(p.id, p.name);
    }
    return map;
  }, [professionals]);

  // Grouped weekly rules by day
  const dayGroups: DayScheduleGroup[] = useMemo(() => {
    return groupScheduleRulesByDay(weeklySchedule.rules);
  }, [weeklySchedule.rules]);

  // Total active weekly rules
  const totalWeeklyRules = useMemo(() => {
    return weeklySchedule.rules.length;
  }, [weeklySchedule.rules]);

  // Filtered exceptions list
  const filteredExceptions = useMemo(() => {
    const list = filterExceptions(
      exceptionsData.exceptions,
      selectedProfessional,
    );
    return [...list].sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
  }, [exceptionsData.exceptions, selectedProfessional]);

  // Update URL helper
  const updateQuery = (params: Record<string, string | null>) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    for (const [key, val] of Object.entries(params)) {
      if (
        val === null ||
        val === "" ||
        (key === "professionalId" && val === "all")
      ) {
        nextParams.delete(key);
      } else {
        nextParams.set(key, val);
      }
    }
    const queryString = nextParams.toString();
    const targetUrl = `/app/${encodeURIComponent(orgSlug)}/settings/schedules${queryString ? `?${queryString}` : ""}`;
    router.replace(targetUrl);
  };

  const handleTabChange = (val: string) => {
    setActiveTab(val);
    updateQuery({ tab: val === "weekly" ? null : val });
  };

  const handleProfessionalChange = (profId: string) => {
    setSelectedProfessional(profId);
    updateQuery({ professionalId: profId });
  };

  const closeSheet = () => {
    updateQuery({ sheet: null, scheduleId: null });
  };

  const isSheetOpen = Boolean(currentSheetParam);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-7xl mx-auto w-full">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Horários de Atendimento e Bloqueios
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulte a grade semanal de funcionamento da clínica e os bloqueios
            pontuais de agenda para feriados, férias e recessos.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button asChild className="gap-2 shrink-0">
            <Link
              href={`/app/${encodeURIComponent(orgSlug)}/settings/schedules?sheet=new`}
            >
              <Plus className="size-4" />
              Novo horário / bloqueio
            </Link>
          </Button>
        </div>
      </div>

      {/* Prominent Timezone Callout */}
      <div className="flex items-start sm:items-center gap-3.5 rounded-xl border border-border bg-card p-4 shadow-xs text-card-foreground">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Globe className="size-5" />
        </div>
        <div className="flex-1 space-y-0.5">
          <p className="text-sm font-semibold text-foreground">
            {formatTimezoneCallout(
              weeklySchedule.timezone || exceptionsData.timezone,
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Todos os agendamentos, lembretes e consultas respeitam o fuso
            horário oficial configurado para esta clínica.
          </p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Filter className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            Profissional:
          </span>
          <Select
            value={selectedProfessional}
            onValueChange={handleProfessionalChange}
          >
            <SelectTrigger className="w-[240px] h-9 text-sm">
              <SelectValue placeholder="Filtrar por profissional" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                Toda a clínica e profissionais
              </SelectItem>
              <SelectItem value="clinic">Toda a clínica</SelectItem>
              {professionals.map((prof) => (
                <SelectItem key={prof.id} value={prof.id}>
                  {prof.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedProfessional !== "all" && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleProfessionalChange("all")}
            className="h-8 text-xs text-muted-foreground hover:text-foreground self-start sm:self-auto"
          >
            Limpar filtro
          </Button>
        )}
      </div>

      {/* Main Content Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="w-full space-y-6"
      >
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="weekly" className="gap-2">
            <Clock3 className="size-4" />
            <span>Grade Semanal</span>
            <Badge
              variant="secondary"
              className="ml-1 text-[11px] px-1.5 py-0 font-normal"
            >
              {totalWeeklyRules}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="exceptions" className="gap-2">
            <CalendarOff className="size-4" />
            <span>Bloqueios e Recessos</span>
            <Badge
              variant="secondary"
              className="ml-1 text-[11px] px-1.5 py-0 font-normal"
            >
              {filteredExceptions.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Grade Semanal */}
        <TabsContent value="weekly" className="space-y-4">
          {totalWeeklyRules === 0 ? (
            <Empty className="border border-dashed border-border bg-card my-6">
              <EmptyMedia variant="icon">
                <CalendarDays className="size-6 text-muted-foreground" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>Nenhum horário cadastrado</EmptyTitle>
                <EmptyDescription>
                  A clínica ainda não possui uma grade de horários de
                  atendimento semanal configurada.
                </EmptyDescription>
              </EmptyHeader>
              <Button asChild variant="outline" className="mt-4 gap-2">
                <Link
                  href={`/app/${encodeURIComponent(orgSlug)}/settings/schedules?sheet=new`}
                >
                  <Plus className="size-4" />
                  Configurar horários
                </Link>
              </Button>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {dayGroups.map((day) => {
                const isClosed = day.rules.length === 0;

                return (
                  <Card
                    key={day.dayOfWeek}
                    className={`flex flex-col justify-between transition-colors ${
                      isClosed
                        ? "bg-muted/30 border-dashed"
                        : "bg-card border-border hover:border-primary/40"
                    }`}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-semibold text-foreground">
                          {day.label}
                        </CardTitle>
                        {isClosed ? (
                          <Badge
                            variant="secondary"
                            className="font-normal text-xs text-muted-foreground bg-muted"
                          >
                            Sem atendimento
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-xs font-normal border-primary/20 text-primary"
                          >
                            {day.totalIntervals}{" "}
                            {day.totalIntervals === 1
                              ? "intervalo"
                              : "intervalos"}
                          </Badge>
                        )}
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-3 flex-1 flex flex-col justify-between">
                      {isClosed ? (
                        <p className="text-xs text-muted-foreground italic">
                          Nenhum horário de atendimento agendado para este dia.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          <div className="space-y-1.5">
                            {day.rules.map((rule) => {
                              const ruleKey = `${rule.dayOfWeek}-${rule.startTime}-${rule.endTime}-${rule.slotDurationMinutes}`;
                              return (
                                <div
                                  key={ruleKey}
                                  className="flex items-center justify-between text-sm rounded-md bg-muted/50 px-2.5 py-1.5"
                                >
                                  <span className="font-medium text-foreground">
                                    {rule.startTime} - {rule.endTime}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                    {rule.slotDurationMinutes} min
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {/* Conflict / Overlap warning indicator */}
                          {day.hasOverlap && (
                            <div className="flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                              <AlertTriangle className="size-3.5 shrink-0" />
                              <span>
                                Atenção: Há horários sobrepostos neste dia
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="pt-2 border-t border-border/50 flex justify-end">
                        <Button
                          asChild
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                          <Link
                            href={`/app/${encodeURIComponent(orgSlug)}/settings/schedules?sheet=edit&scheduleId=${encodeURIComponent(day.dayOfWeek)}`}
                          >
                            <Edit2 className="size-3.5" />
                            Editar
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Tab 2: Bloqueios e Recessos */}
        <TabsContent value="exceptions" className="space-y-4">
          {filteredExceptions.length === 0 ? (
            <Empty className="border border-dashed border-border bg-card my-6">
              <EmptyMedia variant="icon">
                <CalendarOff className="size-6 text-muted-foreground" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>Nenhum bloqueio ou recesso registrado</EmptyTitle>
                <EmptyDescription>
                  {selectedProfessional !== "all"
                    ? "Não há bloqueios de agenda para o profissional selecionado."
                    : "Não existem bloqueios, recessos ou feriados programados no momento."}
                </EmptyDescription>
              </EmptyHeader>
              <Button asChild variant="outline" className="mt-4 gap-2">
                <Link
                  href={`/app/${encodeURIComponent(orgSlug)}/settings/schedules?sheet=new`}
                >
                  <Plus className="size-4" />
                  Novo bloqueio
                </Link>
              </Button>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredExceptions.map((item) => {
                const affectedName = item.professionalId
                  ? professionalsMap.get(item.professionalId) ||
                    "Profissional específico"
                  : "Toda a clínica";
                const isClinicWide = item.professionalId === null;

                return (
                  <div
                    key={item.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 shadow-xs text-card-foreground"
                  >
                    <div className="flex items-start gap-3.5">
                      <div
                        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
                          isClinicWide
                            ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                            : "bg-blue-500/10 text-blue-700 dark:text-blue-400"
                        }`}
                      >
                        {isClinicWide ? (
                          <Building2 className="size-5" />
                        ) : (
                          <Stethoscope className="size-5" />
                        )}
                      </div>

                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground text-sm sm:text-base">
                            {item.reason || "Bloqueio de agenda"}
                          </h3>
                          <Badge
                            variant={isClinicWide ? "secondary" : "outline"}
                            className="text-xs font-normal"
                          >
                            {isClinicWide ? "Toda a clínica" : affectedName}
                          </Badge>
                        </div>

                        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                          <Clock className="size-3.5" />
                          <span>
                            {formatExceptionDateRange(
                              item.startsAt,
                              item.endsAt,
                              item.timezone || weeklySchedule.timezone,
                            )}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs"
                      >
                        <Link
                          href={`/app/${encodeURIComponent(orgSlug)}/settings/schedules?sheet=edit&scheduleId=${encodeURIComponent(item.id)}`}
                        >
                          <Edit2 className="size-3.5" />
                          Editar
                        </Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Interactive Sheet for New Schedule/Exception (?sheet=new) */}
      <NewScheduleSheet
        orgSlug={orgSlug}
        isOpen={currentSheetParam === "new"}
        onClose={closeSheet}
        weeklySchedule={weeklySchedule}
        professionals={professionals}
      />

      {/* Sheet Modal for Edit (?sheet=edit&scheduleId=...) */}
      <Sheet
        open={currentSheetParam === "edit"}
        onOpenChange={(open) => !open && closeSheet()}
      >
        <SheetContent side="right" className="sm:max-w-md w-full">
          <SheetHeader className="space-y-1">
            <SheetTitle>Editar Horário / Bloqueio</SheetTitle>
            <SheetDescription>
              Gerenciamento do item selecionado (
              {currentScheduleId || "configuração"}).
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4 text-sm text-foreground">
            <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Identificador do item
                </span>
                <p className="font-mono text-xs bg-muted px-2 py-1 rounded text-foreground">
                  {currentScheduleId || "—"}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Para alterar este registro, utilize os fluxos dedicados de
                gerenciamento ou entre em contato com o suporte caso precise
                de uma auditoria avançada.
              </p>
            </div>

            <div className="pt-4 flex justify-end gap-2 border-t border-border">
              <Button variant="outline" onClick={closeSheet}>
                Fechar
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
