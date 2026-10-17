"use client";

import {
  CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Eye,
  FilterX,
  Lock,
  RotateCcw,
  Search,
  ShieldCheck,
  User,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AUDIT_CATEGORIES,
  type AuditCategory,
  type AuditLogItem,
  type AuditPageInfo,
  extractMaskedIp,
  formatAuditAction,
  formatAuditActor,
  formatAuditDate,
  formatAuditTarget,
  getAuditCategory,
  matchesAuditFilter,
  sanitizeMetadataForDisplay,
} from "@/lib/audit";

export interface AuditLogsViewProps {
  orgSlug: string;
  initialEvents: AuditLogItem[];
  pagination?: AuditPageInfo;
  currentFilters: {
    startDate?: string;
    endDate?: string;
    category?: string;
    actor?: string;
    action?: string;
    page?: number;
    limit?: number;
  };
}

export function AuditLogsView({
  orgSlug,
  initialEvents,
  pagination,
  currentFilters,
}: AuditLogsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Local state for filters
  const [startDate, setStartDate] = useState(currentFilters.startDate ?? "");
  const [endDate, setEndDate] = useState(currentFilters.endDate ?? "");
  const [selectedCategory, setSelectedCategory] = useState<AuditCategory>(
    (currentFilters.category as AuditCategory) ?? "all",
  );
  const [actorQuery, setActorQuery] = useState(currentFilters.actor ?? "");
  const [actionQuery, setActionQuery] = useState(currentFilters.action ?? "");

  // Modal inspection state
  const [inspectingEvent, setInspectingEvent] = useState<AuditLogItem | null>(
    null,
  );

  const navigateWithParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === "all" || value.trim() === "") {
          params.delete(key);
        } else {
          params.set(key, value.trim());
        }
      }
      const qs = params.toString();
      startTransition(() => {
        router.push(
          `/app/${encodeURIComponent(orgSlug)}/settings/audit${qs ? `?${qs}` : ""}`,
          { scroll: false },
        );
      });
    },
    [searchParams, orgSlug, router],
  );

  const handleCategorySelect = (category: AuditCategory) => {
    setSelectedCategory(category);
    navigateWithParams({
      category: category === "all" ? null : category,
      page: "1",
    });
  };

  const handleApplyDateFilter = (newStart: string, newEnd: string) => {
    setStartDate(newStart);
    setEndDate(newEnd);
    navigateWithParams({
      startDate: newStart || null,
      endDate: newEnd || null,
      page: "1",
    });
  };

  const handleApplySearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigateWithParams({
      actor: actorQuery || null,
      action: actionQuery || null,
      page: "1",
    });
  };

  const handleClearFilters = () => {
    setStartDate("");
    setEndDate("");
    setSelectedCategory("all");
    setActorQuery("");
    setActionQuery("");
    navigateWithParams({
      startDate: null,
      endDate: null,
      category: null,
      actor: null,
      action: null,
      page: "1",
    });
  };

  const isFilterActive =
    Boolean(startDate) ||
    Boolean(endDate) ||
    selectedCategory !== "all" ||
    Boolean(actorQuery.trim()) ||
    Boolean(actionQuery.trim());

  // Filter events (local refinement combined with server-filtered events)
  const displayedEvents = useMemo(() => {
    return initialEvents.filter((item) =>
      matchesAuditFilter(item, {
        category: selectedCategory,
        actor: actorQuery,
        action: actionQuery,
      }),
    );
  }, [initialEvents, selectedCategory, actorQuery, actionQuery]);

  const currentPage = pagination?.page ?? currentFilters.page ?? 1;
  const totalPages = pagination?.totalPages ?? 1;
  const totalCount = pagination?.totalCount ?? displayedEvents.length;
  const hasNextPage = pagination?.hasNextPage ?? false;
  const hasPreviousPage = pagination?.hasPreviousPage ?? false;

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || (pagination && newPage > totalPages)) return;
    navigateWithParams({ page: String(newPage) });
  };

  const sanitizedMetadata = useMemo(() => {
    return inspectingEvent
      ? sanitizeMetadataForDisplay(inspectingEvent.metadata)
      : [];
  }, [inspectingEvent]);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Trilha de Auditoria
            </h1>
            <Badge
              variant="outline"
              className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            >
              <ShieldCheck className="size-3.5" />
              Trilha Imutável (LGPD)
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Histórico imutável de ações e acessos sensíveis da clínica para
            conformidade com a LGPD
          </p>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
        <div className="flex flex-col gap-4">
          {/* Category Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-3">
            <span className="mr-2 text-xs font-medium text-muted-foreground">
              Categoria:
            </span>
            {AUDIT_CATEGORIES.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => handleCategorySelect(cat.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    isSelected
                      ? "bg-primary text-primary-foreground shadow-2xs"
                      : "bg-secondary text-secondary-foreground hover:bg-muted"
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Date Range, Search & Actor Filters */}
          <form
            onSubmit={handleApplySearch}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            {/* Start Date */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="audit-start-date"
                className="text-xs font-medium text-muted-foreground"
              >
                Data inicial
              </label>
              <div className="relative">
                <Input
                  id="audit-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setStartDate(val);
                    handleApplyDateFilter(val, endDate);
                  }}
                  className="w-full text-xs"
                />
              </div>
            </div>

            {/* End Date */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="audit-end-date"
                className="text-xs font-medium text-muted-foreground"
              >
                Data final
              </label>
              <div className="relative">
                <Input
                  id="audit-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEndDate(val);
                    handleApplyDateFilter(startDate, val);
                  }}
                  className="w-full text-xs"
                />
              </div>
            </div>

            {/* Actor Search */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="audit-actor-search"
                className="text-xs font-medium text-muted-foreground"
              >
                Filtrar por Usuário / Autor
              </label>
              <div className="relative">
                <User className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  id="audit-actor-search"
                  placeholder="Nome, e-mail ou ID..."
                  value={actorQuery}
                  onChange={(e) => setActorQuery(e.target.value)}
                  onBlur={() =>
                    navigateWithParams({
                      actor: actorQuery || null,
                      page: "1",
                    })
                  }
                  className="pl-8 text-xs"
                />
              </div>
            </div>

            {/* Action Search */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="audit-action-search"
                className="text-xs font-medium text-muted-foreground"
              >
                Tipo de Ação
              </label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  id="audit-action-search"
                  placeholder="Ex: Prontuário, Receita, Login..."
                  value={actionQuery}
                  onChange={(e) => setActionQuery(e.target.value)}
                  onBlur={() =>
                    navigateWithParams({
                      action: actionQuery || null,
                      page: "1",
                    })
                  }
                  className="pl-8 text-xs"
                />
              </div>
            </div>

            {/* Actions Toolbar */}
            <div className="flex items-end gap-2">
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                className="w-full text-xs font-medium"
              >
                Buscar
              </Button>
              {isFilterActive && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClearFilters}
                  className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  title="Limpar todos os filtros ativos"
                >
                  <FilterX className="size-3.5" />
                  Limpar
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Events Table / Chronological List */}
      <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
        {displayedEvents.length === 0 ? (
          <div className="flex min-h-[300px] flex-col items-center justify-center p-8 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CalendarIcon className="size-6 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold text-foreground">
              Nenhum evento registrado no período
            </h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {isFilterActive
                ? "Nenhum registro de auditoria corresponde aos filtros aplicados. Tente ajustar os parâmetros ou limpar os filtros."
                : "Ainda não existem registros de ações para esta clínica."}
            </p>
            {isFilterActive && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="mt-4 gap-2 text-xs"
              >
                <RotateCcw className="size-3.5" />
                Limpar filtros
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[170px]">Data e Hora</TableHead>
                <TableHead className="w-[120px]">Categoria</TableHead>
                <TableHead>Ação Realizada</TableHead>
                <TableHead>Recurso / Alvo</TableHead>
                <TableHead>Autor (Usuário)</TableHead>
                <TableHead className="w-[140px]">IP Mascarado</TableHead>
                <TableHead className="w-[90px] text-right">Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedEvents.map((event) => {
                const category = getAuditCategory(event.action);
                const actionLabel = formatAuditAction(event.action);
                const targetLabel = formatAuditTarget(
                  event.targetType,
                  event.targetId,
                  event.metadata,
                );
                const actor = formatAuditActor(
                  event.actorUserId,
                  event.actorUser,
                  event.actorName,
                );
                const maskedIp = extractMaskedIp(event.metadata);
                const formattedDate = formatAuditDate(event.createdAt);

                return (
                  <TableRow
                    key={event.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => setInspectingEvent(event)}
                  >
                    {/* Timestamp */}
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {formattedDate}
                    </TableCell>

                    {/* Category Badge */}
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[11px] font-medium ${category.badgeClassName}`}
                      >
                        {category.label}
                      </Badge>
                    </TableCell>

                    {/* Executed Action */}
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground text-xs">
                          {actionLabel}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground/80">
                          {event.action}
                        </span>
                      </div>
                    </TableCell>

                    {/* Target / Resource */}
                    <TableCell className="text-xs text-foreground font-medium">
                      {targetLabel}
                    </TableCell>

                    {/* Actor */}
                    <TableCell className="text-xs">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {actor.label}
                        </span>
                        {actor.email && (
                          <span className="text-[11px] text-muted-foreground">
                            {actor.email}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Masked IP Address */}
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {maskedIp}
                    </TableCell>

                    {/* Details Trigger */}
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setInspectingEvent(event);
                        }}
                        aria-label={`Ver detalhes do evento ${event.id}`}
                        title="Ver detalhes do registro"
                      >
                        <Eye className="size-4 text-muted-foreground hover:text-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Pagination Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
        <p className="text-xs text-muted-foreground">
          Mostrando{" "}
          <span className="font-medium text-foreground">
            {displayedEvents.length}
          </span>{" "}
          de <span className="font-medium text-foreground">{totalCount}</span>{" "}
          registro{totalCount === 1 ? "" : "s"}
          {pagination && pagination.totalPages > 1 && (
            <span>
              {" "}
              (Página {currentPage} de {totalPages})
            </span>
          )}
        </p>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPreviousPage || isPending}
            onClick={() => handlePageChange(currentPage - 1)}
            className="gap-1 text-xs"
          >
            <ChevronLeft className="size-3.5" />
            Anterior
          </Button>
          <span className="px-2 text-xs font-medium text-muted-foreground">
            {currentPage} / {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage || isPending}
            onClick={() => handlePageChange(currentPage + 1)}
            className="gap-1 text-xs"
          >
            Próximo
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Event Details Dialog (Modal) */}
      <Dialog
        open={Boolean(inspectingEvent)}
        onOpenChange={(open) => {
          if (!open) setInspectingEvent(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {inspectingEvent && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-lg">
                    Detalhes do Registro de Auditoria
                  </DialogTitle>
                  <Badge
                    variant="outline"
                    className="gap-1 text-[11px] border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  >
                    <Lock className="size-3" />
                    Imutável
                  </Badge>
                </div>
                <DialogDescription>
                  Registro verificado e preservado em conformidade com a LGPD e
                  resoluções do CFM.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2">
                {/* Event Overview Card */}
                <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-2 text-xs">
                  <div>
                    <span className="font-medium text-muted-foreground">
                      Identificador do Evento:
                    </span>
                    <p className="font-mono text-foreground mt-0.5">
                      {inspectingEvent.id}
                    </p>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">
                      Data e Hora:
                    </span>
                    <p className="text-foreground mt-0.5">
                      {formatAuditDate(inspectingEvent.createdAt)}
                    </p>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">
                      Categoria:
                    </span>
                    <div className="mt-0.5">
                      <Badge
                        variant="outline"
                        className={
                          getAuditCategory(inspectingEvent.action)
                            .badgeClassName
                        }
                      >
                        {getAuditCategory(inspectingEvent.action).label}
                      </Badge>
                    </div>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">
                      Ação Executada:
                    </span>
                    <p className="text-foreground font-medium mt-0.5">
                      {formatAuditAction(inspectingEvent.action)}
                    </p>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {inspectingEvent.action}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">
                      Autor da Ação:
                    </span>
                    <p className="text-foreground font-medium mt-0.5">
                      {
                        formatAuditActor(
                          inspectingEvent.actorUserId,
                          inspectingEvent.actorUser,
                          inspectingEvent.actorName,
                        ).label
                      }
                    </p>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      ID: {inspectingEvent.actorUserId}
                    </span>
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">
                      Endereço IP (Mascarado):
                    </span>
                    <p className="font-mono text-foreground mt-0.5">
                      {extractMaskedIp(inspectingEvent.metadata)}
                    </p>
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-medium text-muted-foreground">
                      Recurso Afetado:
                    </span>
                    <p className="text-foreground mt-0.5 font-medium">
                      {formatAuditTarget(
                        inspectingEvent.targetType,
                        inspectingEvent.targetId,
                        inspectingEvent.metadata,
                      )}
                    </p>
                  </div>
                </div>

                {/* Structured Metadata (with strict sensitive data protection) */}
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Metadados da Operação (Segurança & LGPD)
                  </h4>
                  {sanitizedMetadata.length === 0 ? (
                    <p className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
                      Nenhum metadado adicional associado a este evento.
                    </p>
                  ) : (
                    <div className="rounded-lg border border-border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="w-[180px] text-xs">
                              Parâmetro
                            </TableHead>
                            <TableHead className="text-xs">
                              Valor Registrado
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sanitizedMetadata.map((entry) => (
                            <TableRow key={entry.key}>
                              <TableCell className="font-mono text-xs font-medium text-muted-foreground">
                                {entry.label}
                              </TableCell>
                              <TableCell className="font-mono text-xs text-foreground break-all">
                                {entry.value}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Immutability & Privacy Assurance */}
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-muted-foreground flex items-start gap-2">
                  <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <p>
                    Este registro é estritamente imutável e auditado. Senhas,
                    chaves de acesso e credenciais protegidas são omitidas por
                    padrão, e identificadores são anonimizados conforme a LGPD.
                  </p>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
