"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  EditIcon,
  FileTextIcon,
  GridIcon,
  ListIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  extractTemplateVariables,
  formatTemplateDate,
  formatTemplateStatus,
  formatTemplateType,
  matchesTemplateSearch,
  TEMPLATE_STATUS_FILTER_OPTIONS,
  TEMPLATE_TYPE_FILTER_OPTIONS,
} from "@/lib/templates";
import type { TemplateItem } from "@/server/templates";
import { archiveTemplateAction, unarchiveTemplateAction } from "./actions";

export interface TemplatesViewProps {
  orgSlug: string;
  templates: TemplateItem[];
  pageInfo?: {
    nextCursor: string | null;
    hasNextPage: boolean;
  };
  currentFilters: {
    type?: string;
    status?: string;
    search?: string;
  };
}

export function TemplatesView({
  orgSlug,
  templates,
  currentFilters,
}: TemplatesViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [searchValue, setSearchValue] = useState(currentFilters.search ?? "");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");
  const [templateToArchive, setTemplateToArchive] =
    useState<TemplateItem | null>(null);
  const [templateToUnarchive, setTemplateToUnarchive] =
    useState<TemplateItem | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);

  // Sync internal search input with URL search param
  useEffect(() => {
    setSearchValue(currentFilters.search ?? "");
  }, [currentFilters.search]);

  const navigateWithParams = useCallback(
    (updatedParams: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updatedParams)) {
        if (value === null || value === "" || value === "all") {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const queryString = params.toString();
      startTransition(() => {
        router.push(
          `/app/${encodeURIComponent(orgSlug)}/templates${queryString ? `?${queryString}` : ""}`,
        );
      });
    },
    [searchParams, orgSlug, router],
  );

  // Debounced search sync to URL (>= 250ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      const currentParam = currentFilters.search ?? "";
      const trimmed = searchValue.trim();
      if (trimmed !== currentParam) {
        navigateWithParams({ search: trimmed || null });
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [searchValue, currentFilters.search, navigateWithParams]);

  function handleTypeChange(val: string) {
    navigateWithParams({ type: val });
  }

  function handleStatusChange(val: string) {
    navigateWithParams({ status: val });
  }

  function handleClearFilters() {
    setSearchValue("");
    const params = new URLSearchParams();
    if (searchParams.get("sheet")) {
      params.set("sheet", searchParams.get("sheet") as string);
    }
    const queryString = params.toString();
    startTransition(() => {
      router.push(
        `/app/${encodeURIComponent(orgSlug)}/templates${queryString ? `?${queryString}` : ""}`,
      );
    });
  }

  async function handleConfirmArchive() {
    if (!templateToArchive) return;
    setIsActionLoading(true);
    try {
      const result = await archiveTemplateAction(orgSlug, templateToArchive.id);
      if (result.success) {
        toast.success("Modelo arquivado com sucesso.");
        setTemplateToArchive(null);
        router.refresh();
      } else {
        toast.error(result.error || "Não foi possível arquivar o modelo.");
      }
    } catch {
      toast.error("Ocorreu um erro ao tentar arquivar o modelo.");
    } finally {
      setIsActionLoading(false);
    }
  }

  async function handleConfirmUnarchive() {
    if (!templateToUnarchive) return;
    setIsActionLoading(true);
    try {
      const result = await unarchiveTemplateAction(
        orgSlug,
        templateToUnarchive.id,
      );
      if (result.success) {
        toast.success("Modelo restaurado com sucesso.");
        setTemplateToUnarchive(null);
        router.refresh();
      } else {
        toast.error(result.error || "Não foi possível restaurar o modelo.");
      }
    } catch {
      toast.error("Ocorreu um erro ao tentar restaurar o modelo.");
    } finally {
      setIsActionLoading(false);
    }
  }

  const hasActiveFilters = Boolean(
    (currentFilters.type && currentFilters.type !== "all") ||
      (currentFilters.status && currentFilters.status !== "active") ||
      searchValue.trim().length > 0,
  );

  const newTemplateHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sheet", "new");
    return `/app/${encodeURIComponent(orgSlug)}/templates?${params.toString()}`;
  }, [searchParams, orgSlug]);

  function getEditTemplateHref(templateId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sheet", "edit");
    params.set("templateId", templateId);
    return `/app/${encodeURIComponent(orgSlug)}/templates?${params.toString()}`;
  }

  // Filter templates locally as well if search input changed before server response
  const displayedTemplates = useMemo(() => {
    if (!searchValue.trim()) return templates;
    return templates.filter((template) =>
      matchesTemplateSearch(template, searchValue),
    );
  }, [templates, searchValue]);

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Modelos de Documentos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gerencie e organize os modelos de receitas, atestados e laudos da
            clínica.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild className="gap-2">
            <Link href={newTemplateHref}>
              <PlusIcon className="size-4" />
              Novo modelo
            </Link>
          </Button>
        </div>
      </div>

      {/* 2. Filters & Search Toolbar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Type tabs filter */}
        <div className="overflow-x-auto pb-1 lg:pb-0">
          <Tabs
            value={currentFilters.type ?? "all"}
            onValueChange={handleTypeChange}
            className="w-full sm:w-auto"
          >
            <TabsList className="bg-muted">
              {TEMPLATE_TYPE_FILTER_OPTIONS.map((opt) => (
                <TabsTrigger
                  key={opt.value}
                  value={opt.value}
                  className="text-xs sm:text-sm"
                >
                  {opt.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {/* Right side: Status filter, Search, and View Mode Toggle */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Status selector */}
          <div className="w-full sm:w-36">
            <Select
              value={currentFilters.status ?? "active"}
              onValueChange={handleStatusChange}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_STATUS_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search Input with Debounce */}
          <div className="relative w-full sm:w-64">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar por título ou termo..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="pr-8 pl-8 text-sm"
              aria-label="Buscar modelos por título ou termo"
            />
            {searchValue ? (
              <button
                type="button"
                onClick={() => setSearchValue("")}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Limpar busca"
              >
                <XIcon className="size-4" />
              </button>
            ) : null}
          </div>

          {/* View Mode Toggle: Table or Grid */}
          <div className="hidden items-center rounded-lg border border-border p-0.5 sm:flex">
            <Button
              variant={viewMode === "table" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("table")}
              aria-label="Visualização em tabela"
            >
              <ListIcon className="size-4" />
            </Button>
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2"
              onClick={() => setViewMode("grid")}
              aria-label="Visualização em grade"
            >
              <GridIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Pending transition indicator */}
      {isPending ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          <span>Atualizando modelos...</span>
        </div>
      ) : null}

      {/* 3. Empty States */}
      {displayedTemplates.length === 0 ? (
        hasActiveFilters ? (
          <Empty className="rounded-lg border border-border bg-card p-12">
            <EmptyMedia variant="icon">
              <SearchIcon className="size-6 text-muted-foreground" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>Nenhum modelo encontrado</EmptyTitle>
              <EmptyDescription>
                Nenhum modelo corresponde aos filtros aplicados. Tente ajustar a
                busca ou limpar os filtros.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" onClick={handleClearFilters}>
                Limpar filtros
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Empty className="rounded-lg border border-border bg-card p-12">
            <EmptyMedia variant="icon">
              <FileTextIcon className="size-6 text-muted-foreground" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>Nenhum modelo cadastrado</EmptyTitle>
              <EmptyDescription>
                Cadastre modelos de receitas, atestados e laudos para agilizar
                os atendimentos clínicos da clínica.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href={newTemplateHref}>
                  <PlusIcon className="mr-2 size-4" />
                  Novo modelo
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        )
      ) : viewMode === "table" ? (
        /* 4. Table View */
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30%]">Título</TableHead>
                <TableHead className="w-[15%]">Tipo</TableHead>
                <TableHead className="w-[30%]">Variáveis</TableHead>
                <TableHead className="w-[12%]">Atualizado</TableHead>
                <TableHead className="w-[8%]">Status</TableHead>
                <TableHead className="w-[5%] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedTemplates.map((template) => {
                const variables = extractTemplateVariables(
                  template.bodyTemplate,
                );
                const isArchived = template.status === "ARCHIVED";

                return (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium text-foreground">
                      <Link
                        href={getEditTemplateHref(template.id)}
                        className="hover:underline focus-visible:outline-hidden"
                      >
                        {template.title}
                      </Link>
                      {template.isGlobal ? (
                        <span className="ml-2 inline-flex items-center text-xs text-muted-foreground">
                          (Padrão Global)
                        </span>
                      ) : null}
                    </TableCell>

                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {formatTemplateType(template.type)}
                      </Badge>
                    </TableCell>

                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {variables.length > 0 ? (
                          <>
                            {variables.slice(0, 3).map((v) => (
                              <span
                                key={v}
                                className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground"
                              >
                                {v}
                              </span>
                            ))}
                            {variables.length > 3 ? (
                              <span className="text-[11px] text-muted-foreground">
                                +{variables.length - 3}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Sem variáveis
                          </span>
                        )}
                      </div>
                    </TableCell>

                    <TableCell className="text-xs text-muted-foreground">
                      {formatTemplateDate(template.updatedAt)}
                    </TableCell>

                    <TableCell>
                      <Badge
                        variant={isArchived ? "secondary" : "default"}
                        className={
                          isArchived
                            ? "bg-muted text-muted-foreground"
                            : "bg-emerald-600/10 text-emerald-700 dark:bg-emerald-600/20 dark:text-emerald-400"
                        }
                      >
                        {formatTemplateStatus(template.status)}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="size-8 p-0"
                            aria-label={`Ações do modelo ${template.title}`}
                          >
                            <MoreVerticalIcon className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={getEditTemplateHref(template.id)}>
                              <EditIcon className="mr-2 size-4" />
                              Editar
                            </Link>
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          {!isArchived ? (
                            <DropdownMenuItem
                              onClick={() => setTemplateToArchive(template)}
                              className="text-destructive focus:text-destructive"
                            >
                              <ArchiveIcon className="mr-2 size-4" />
                              Arquivar
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => setTemplateToUnarchive(template)}
                            >
                              <ArchiveRestoreIcon className="mr-2 size-4" />
                              Restaurar
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        /* 5. Grid View */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {displayedTemplates.map((template) => {
            const variables = extractTemplateVariables(template.bodyTemplate);
            const isArchived = template.status === "ARCHIVED";

            return (
              <Card
                key={template.id}
                className="flex flex-col justify-between transition-colors hover:border-ring/50"
              >
                <CardHeader className="space-y-2 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="outline" className="font-normal">
                      {formatTemplateType(template.type)}
                    </Badge>
                    <Badge
                      variant={isArchived ? "secondary" : "default"}
                      className={
                        isArchived
                          ? "bg-muted text-muted-foreground"
                          : "bg-emerald-600/10 text-emerald-700 dark:bg-emerald-600/20 dark:text-emerald-400"
                      }
                    >
                      {formatTemplateStatus(template.status)}
                    </Badge>
                  </div>
                  <CardTitle className="line-clamp-2 text-base font-medium">
                    <Link
                      href={getEditTemplateHref(template.id)}
                      className="hover:underline focus-visible:outline-hidden"
                    >
                      {template.title}
                    </Link>
                  </CardTitle>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {variables.length > 0 ? (
                      <>
                        {variables.slice(0, 3).map((v) => (
                          <span
                            key={v}
                            className="inline-flex items-center rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground"
                          >
                            {v}
                          </span>
                        ))}
                        {variables.length > 3 ? (
                          <span className="text-[11px] text-muted-foreground">
                            +{variables.length - 3}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        Sem variáveis
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                    <span>
                      Atualizado em {formatTemplateDate(template.updatedAt)}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-8 p-0"
                          aria-label={`Ações do modelo ${template.title}`}
                        >
                          <MoreVerticalIcon className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={getEditTemplateHref(template.id)}>
                            <EditIcon className="mr-2 size-4" />
                            Editar
                          </Link>
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        {!isArchived ? (
                          <DropdownMenuItem
                            onClick={() => setTemplateToArchive(template)}
                            className="text-destructive focus:text-destructive"
                          >
                            <ArchiveIcon className="mr-2 size-4" />
                            Arquivar
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => setTemplateToUnarchive(template)}
                          >
                            <ArchiveRestoreIcon className="mr-2 size-4" />
                            Restaurar
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* 6. Archiving Confirmation AlertDialog */}
      <AlertDialog
        open={templateToArchive !== null}
        onOpenChange={(open) => {
          if (!open && !isActionLoading) setTemplateToArchive(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar modelo de documento?</AlertDialogTitle>
            <AlertDialogDescription>
              Este modelo deixará de ser sugerido para a criação de novos
              documentos clínicos. Documentos já emitidos com este modelo
              permanecerão inalterados e preservados no prontuário dos
              pacientes.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {templateToArchive ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <span className="font-medium text-foreground">
                {templateToArchive.title}
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tipo: {formatTemplateType(templateToArchive.type)}
              </p>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmArchive}
              disabled={isActionLoading}
              variant="destructive"
            >
              {isActionLoading ? (
                <>
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                  Arquivando...
                </>
              ) : (
                "Arquivar modelo"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 7. Unarchiving Confirmation AlertDialog */}
      <AlertDialog
        open={templateToUnarchive !== null}
        onOpenChange={(open) => {
          if (!open && !isActionLoading) setTemplateToUnarchive(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar modelo de documento?</AlertDialogTitle>
            <AlertDialogDescription>
              O modelo voltará a ficar ativo e poderá ser selecionado novamente
              para emissão de novos documentos clínicos.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {templateToUnarchive ? (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <span className="font-medium text-foreground">
                {templateToUnarchive.title}
              </span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tipo: {formatTemplateType(templateToUnarchive.type)}
              </p>
            </div>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isActionLoading}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmUnarchive}
              disabled={isActionLoading}
            >
              {isActionLoading ? (
                <>
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                  Restaurando...
                </>
              ) : (
                "Restaurar modelo"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
