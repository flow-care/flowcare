"use client";

import {
  ActivityIcon,
  CalendarIcon,
  ClockIcon,
  FileCheckIcon,
  FileTextIcon,
  LockIcon,
  PaperclipIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  UserIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  PatientTimelineResult,
  TimelineEventItem,
} from "@/server/patients";

export type TimelineBadgeType =
  | "CONSULTATION"
  | "PRESCRIPTION"
  | "CERTIFICATE"
  | "EXAM"
  | "ATTACHMENT"
  | "APPOINTMENT";

export type TimelineCategory =
  | "all"
  | "consultations"
  | "documents"
  | "exams"
  | "appointments";

export interface CategoryOption {
  key: TimelineCategory;
  label: string;
}

export const TIMELINE_CATEGORIES: CategoryOption[] = [
  { key: "all", label: "Todos" },
  { key: "consultations", label: "Consultas" },
  { key: "documents", label: "Documentos" },
  { key: "exams", label: "Exames" },
  { key: "appointments", label: "Agendamentos" },
];

export const EVENT_BADGE_CONFIG: Record<
  TimelineBadgeType,
  {
    label: string;
    variant: "default" | "secondary" | "outline" | "destructive";
    icon: typeof StethoscopeIcon;
  }
> = {
  CONSULTATION: {
    label: "Consulta",
    variant: "default",
    icon: StethoscopeIcon,
  },
  PRESCRIPTION: {
    label: "Prescrição",
    variant: "secondary",
    icon: FileTextIcon,
  },
  CERTIFICATE: {
    label: "Atestado",
    variant: "outline",
    icon: FileCheckIcon,
  },
  EXAM: {
    label: "Exame",
    variant: "secondary",
    icon: ActivityIcon,
  },
  ATTACHMENT: {
    label: "Anexo",
    variant: "outline",
    icon: PaperclipIcon,
  },
  APPOINTMENT: {
    label: "Agendamento",
    variant: "outline",
    icon: ClockIcon,
  },
};

export function resolveEventBadgeType(
  event: TimelineEventItem,
): TimelineBadgeType {
  const type = (event.eventType ?? "").toUpperCase();

  if (type === "CONSULTATION") return "CONSULTATION";
  if (type === "APPOINTMENT") return "APPOINTMENT";
  if (type === "PRESCRIPTION") return "PRESCRIPTION";
  if (type === "CERTIFICATE") return "CERTIFICATE";
  if (type === "EXAM") return "EXAM";

  const docType = String(event.metadata?.documentType ?? "").toUpperCase();
  if (docType === "PRESCRIPTION") return "PRESCRIPTION";
  if (docType === "CERTIFICATE") return "CERTIFICATE";
  if (docType === "EXAM_REQUEST" || docType === "EXAM") return "EXAM";

  const cat = String(event.metadata?.category ?? "").toLowerCase();
  const summary = String(event.summary ?? "").toLowerCase();

  if (type === "ATTACHMENT") {
    if (
      cat.includes("exame") ||
      summary.includes("exame") ||
      cat.includes("laudo")
    ) {
      return "EXAM";
    }
    return "ATTACHMENT";
  }

  if (type === "DOCUMENT") {
    if (summary.includes("receita") || summary.includes("prescriç")) {
      return "PRESCRIPTION";
    }
    if (summary.includes("atestado")) {
      return "CERTIFICATE";
    }
    if (summary.includes("exame") || summary.includes("laudo")) {
      return "EXAM";
    }
    return "CERTIFICATE";
  }

  return "CONSULTATION";
}

export function matchesCategory(
  event: TimelineEventItem,
  category: TimelineCategory,
): boolean {
  if (category === "all") return true;

  const badgeType = resolveEventBadgeType(event);

  if (category === "consultations") {
    return badgeType === "CONSULTATION";
  }

  if (category === "documents") {
    return badgeType === "PRESCRIPTION" || badgeType === "CERTIFICATE";
  }

  if (category === "exams") {
    return badgeType === "EXAM";
  }

  if (category === "appointments") {
    return badgeType === "APPOINTMENT";
  }

  return true;
}

export function sortTimelineEventsDescending(
  events: TimelineEventItem[],
): TimelineEventItem[] {
  return [...events].sort((a, b) => {
    const timeA = new Date(a.timestamp).getTime();
    const timeB = new Date(b.timestamp).getTime();
    if (timeB !== timeA) {
      return timeB - timeA;
    }
    return (b.id ?? "").localeCompare(a.id ?? "");
  });
}

export function filterEventsByCategory(
  events: TimelineEventItem[],
  category: string,
): TimelineEventItem[] {
  const cat = (category || "all").toLowerCase() as TimelineCategory;
  return sortTimelineEventsDescending(
    events.filter((item) => matchesCategory(item, cat)),
  );
}

export function formatTimelineDateTime(timestamp: string): string {
  try {
    const [datePart, timePart] = timestamp.split("T");
    if (datePart && timePart) {
      const [year, month, day] = datePart.split("-");
      const [hour, minute] = timePart.split(":");
      if (year && month && day && hour !== undefined && minute !== undefined) {
        return `${day}/${month}/${year} às ${hour}:${minute}`;
      }
    }
    const d = new Date(timestamp);
    if (Number.isNaN(d.getTime())) return timestamp;
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return timestamp;
  }
}

export function PatientRecordsTimelineSkeleton() {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
        <div className="flex flex-wrap gap-2 pt-3">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-28" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
          {[1, 2, 3].map((i) => (
            <div key={i} className="relative">
              <span className="absolute -left-6 top-3 size-4 rounded-full bg-muted border-2 border-border" />
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-24" />
                    <Skeleton className="h-5 w-16" />
                  </div>
                  <Skeleton className="h-4 w-28" />
                </div>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export interface PatientRecordsTimelineProps {
  timeline: PatientTimelineResult;
  isClinical?: boolean;
  isRestricted?: boolean;
  isLoading?: boolean;
  orgSlug?: string;
  patientId?: string;
  className?: string;
}

export function PatientRecordsTimeline({
  timeline,
  isClinical = true,
  isRestricted = false,
  isLoading = false,
  className,
}: PatientRecordsTimelineProps) {
  const [activeCategory, setActiveCategory] = useState<TimelineCategory>("all");
  const [selectedEvent, setSelectedEvent] = useState<TimelineEventItem | null>(
    null,
  );

  const restricted = !isClinical || timeline.isRestricted || isRestricted;

  const allSortedEvents = useMemo(() => {
    return sortTimelineEventsDescending(timeline.data ?? []);
  }, [timeline.data]);

  const filteredEvents = useMemo(() => {
    return allSortedEvents.filter((item) =>
      matchesCategory(item, activeCategory),
    );
  }, [allSortedEvents, activeCategory]);

  if (restricted) {
    return (
      <Card className={cn("border-border bg-card", className)}>
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LockIcon className="size-6" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">
            Acesso restrito à equipe clínica
          </h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            O prontuário e o histórico clínico deste paciente são restritos a
            profissionais de saúde autorizados da equipe clínica.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <PatientRecordsTimelineSkeleton />;
  }

  const selectedBadgeType = selectedEvent
    ? resolveEventBadgeType(selectedEvent)
    : null;
  const selectedConfig = selectedBadgeType
    ? EVENT_BADGE_CONFIG[selectedBadgeType]
    : null;
  const SelectedIcon = selectedConfig?.icon;

  return (
    <>
      <Card className={cn("border-border bg-card", className)}>
        <CardHeader className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-base font-semibold text-foreground">
                Histórico e Prontuário Clínico
              </CardTitle>
              <CardDescription>
                Linha do tempo cronológica de atendimentos, evoluções, exames e
                documentos
              </CardDescription>
            </div>
            <Badge variant="secondary" className="w-fit">
              {allSortedEvents.length} registro(s)
            </Badge>
          </div>

          {/* Category Filter Tabs/Buttons */}
          <div
            role="toolbar"
            aria-label="Filtros de categoria de prontuário"
            className="flex flex-wrap items-center gap-2 pt-1 border-t border-border"
          >
            {TIMELINE_CATEGORIES.map((cat) => {
              const isSelected = activeCategory === cat.key;
              const count =
                cat.key === "all"
                  ? allSortedEvents.length
                  : allSortedEvents.filter((e) => matchesCategory(e, cat.key))
                      .length;

              return (
                <Button
                  key={cat.key}
                  type="button"
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                  onClick={() => setActiveCategory(cat.key)}
                  className="h-8 gap-1.5 text-xs font-medium"
                >
                  <span>{cat.label}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.2 text-[10px]",
                      isSelected
                        ? "bg-primary-foreground/20 text-primary-foreground font-semibold"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                </Button>
              );
            })}
          </div>
        </CardHeader>

        <CardContent>
          {allSortedEvents.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Nenhum registro clínico encontrado no histórico deste paciente.
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground space-y-2">
              <p>Nenhum registro clínico encontrado nesta categoria.</p>
              <Button
                variant="link"
                size="sm"
                onClick={() => setActiveCategory("all")}
                className="text-xs"
              >
                Ver todos os registros
              </Button>
            </div>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
              {filteredEvents.map((event) => {
                const badgeType = resolveEventBadgeType(event);
                const config = EVENT_BADGE_CONFIG[badgeType];
                const Icon = config.icon;
                const formattedDate = formatTimelineDateTime(event.timestamp);

                return (
                  <div key={event.id} className="relative group">
                    {/* Timeline dot */}
                    <span
                      className="absolute -left-6 top-3 flex size-4 items-center justify-center rounded-full bg-background border-2 border-primary shadow-2xs transition-transform group-hover:scale-110"
                      aria-hidden="true"
                    />

                    {/* Timeline Card */}
                    <button
                      type="button"
                      onClick={() => setSelectedEvent(event)}
                      className="w-full text-left cursor-pointer rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:border-primary/40 hover:shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* Header row: badge + date */}
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={config.variant}
                            data-event-type={badgeType}
                            className="gap-1 font-medium"
                          >
                            <Icon className="size-3" />
                            <span>{config.label}</span>
                            <span className="text-[10px] uppercase font-mono opacity-80">
                              ({badgeType})
                            </span>
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {event.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CalendarIcon className="size-3.5" />
                          <time dateTime={event.timestamp}>
                            {formattedDate}
                          </time>
                        </div>
                      </div>

                      {/* Clinical summary text */}
                      <p className="text-sm font-medium text-foreground mb-2">
                        {event.summary}
                      </p>

                      {/* Professional name and registration / specialty */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <UserIcon className="size-3.5 text-primary shrink-0" />
                          <span>
                            {event.professional ? (
                              <>
                                <strong className="font-medium text-foreground">
                                  {event.professional.name}
                                </strong>
                                {(event.professional.registrationNumber ||
                                  event.professional.professionalTitle) && (
                                  <span className="text-muted-foreground ml-1">
                                    (
                                    {[
                                      event.professional.registrationNumber,
                                      event.professional.professionalTitle,
                                    ]
                                      .filter(Boolean)
                                      .join(" • ")}
                                    )
                                  </span>
                                )}
                              </>
                            ) : (
                              <span>Profissional não especificado</span>
                            )}
                          </span>
                        </div>

                        <span className="text-xs font-medium text-primary inline-flex items-center gap-1 group-hover:underline">
                          Ver detalhes
                        </span>
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Read-Only Event Detail Dialog */}
      {selectedEvent && selectedConfig && SelectedIcon && (
        <Dialog
          open={Boolean(selectedEvent)}
          onOpenChange={(open) => !open && setSelectedEvent(null)}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <div className="flex items-center gap-2 mb-1">
                <Badge
                  variant={selectedConfig.variant}
                  data-event-type={selectedBadgeType}
                  className="gap-1"
                >
                  <SelectedIcon className="size-3" />
                  <span>{selectedConfig.label}</span>
                  <span className="text-[10px] uppercase font-mono opacity-80">
                    ({selectedBadgeType})
                  </span>
                </Badge>
                <Badge variant="outline">{selectedEvent.status}</Badge>
              </div>
              <DialogTitle className="text-lg font-semibold text-foreground">
                {selectedEvent.summary}
              </DialogTitle>
              <DialogDescription>
                Registro clínico do prontuário eletrônico do paciente
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Date & Professional */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-border bg-muted/20 p-3 text-xs">
                <div>
                  <span className="text-muted-foreground block mb-0.5">
                    Data e Hora
                  </span>
                  <span className="font-medium text-foreground">
                    {formatTimelineDateTime(selectedEvent.timestamp)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block mb-0.5">
                    Profissional Responsável
                  </span>
                  <span className="font-medium text-foreground">
                    {selectedEvent.professional?.name ?? "Não informado"}
                  </span>
                  {selectedEvent.professional?.registrationNumber && (
                    <span className="text-muted-foreground block mt-0.5">
                      {selectedEvent.professional.registrationNumber}
                      {selectedEvent.professional.professionalTitle
                        ? ` • ${selectedEvent.professional.professionalTitle}`
                        : ""}
                    </span>
                  )}
                </div>
              </div>

              {/* Clinical summary / description */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  Evolução / Descrição Clínica
                </h4>
                <div className="rounded-lg border border-border bg-card p-3 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {selectedEvent.summary}
                </div>
              </div>

              {/* Additional Metadata breakdown (read-only) */}
              {selectedEvent.metadata &&
                Object.keys(selectedEvent.metadata).length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Dados Adicionais
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs rounded-lg border border-border bg-muted/20 p-3">
                      {selectedEvent.metadata.documentType ? (
                        <div>
                          <span className="text-muted-foreground block">
                            Tipo de Documento:
                          </span>
                          <span className="font-medium">
                            {String(selectedEvent.metadata.documentType)}
                          </span>
                        </div>
                      ) : null}
                      {selectedEvent.metadata.fileName ? (
                        <div className="col-span-2">
                          <span className="text-muted-foreground block">
                            Arquivo:
                          </span>
                          <span className="font-medium font-mono">
                            {String(selectedEvent.metadata.fileName)}
                          </span>
                        </div>
                      ) : null}
                      {selectedEvent.metadata.durationMinutes !== undefined &&
                      selectedEvent.metadata.durationMinutes !== null ? (
                        <div>
                          <span className="text-muted-foreground block">
                            Duração:
                          </span>
                          <span className="font-medium">
                            {String(selectedEvent.metadata.durationMinutes)}{" "}
                            minutos
                          </span>
                        </div>
                      ) : null}
                      {selectedEvent.metadata.anamnesisStatus ? (
                        <div>
                          <span className="text-muted-foreground block">
                            Anamnese:
                          </span>
                          <span className="font-medium">
                            {String(selectedEvent.metadata.anamnesisStatus)}
                          </span>
                        </div>
                      ) : null}
                      {selectedEvent.metadata.startedAt ? (
                        <div>
                          <span className="text-muted-foreground block">
                            Início:
                          </span>
                          <span className="font-medium">
                            {formatTimelineDateTime(
                              String(selectedEvent.metadata.startedAt),
                            )}
                          </span>
                        </div>
                      ) : null}
                      {selectedEvent.metadata.completedAt ? (
                        <div>
                          <span className="text-muted-foreground block">
                            Conclusão:
                          </span>
                          <span className="font-medium">
                            {formatTimelineDateTime(
                              String(selectedEvent.metadata.completedAt),
                            )}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}

              {/* Strictly Read-Only Callout */}
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                <ShieldCheckIcon className="size-4 shrink-0 text-primary" />
                <span>
                  Registro clínico autenticado e imutável. Modo estritamente
                  para consulta e leitura.
                </span>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSelectedEvent(null)}>
                Fechar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
