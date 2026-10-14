"use client";

import { FileTextIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
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
  formatDocumentDate,
  formatDocumentStatus,
  formatDocumentType,
} from "@/lib/documents";
import type { DocumentListItem, DocumentPageInfo } from "@/server/documents";

export interface DocumentsViewProps {
  orgSlug: string;
  documents: DocumentListItem[];
  pageInfo: DocumentPageInfo;
  currentFilters: {
    type?: string;
    status?: string;
    search?: string;
    patientId?: string;
    page?: number;
  };
}

export function DocumentsView({
  orgSlug,
  documents,
  pageInfo,
  currentFilters,
}: DocumentsViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [searchValue, setSearchValue] = useState(currentFilters.search ?? "");

  const hasActiveFilters = Boolean(
    currentFilters.type ||
      currentFilters.status ||
      currentFilters.search ||
      currentFilters.patientId,
  );

  const sheetHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sheet", "new");
    return `/app/${encodeURIComponent(orgSlug)}/documents?${params.toString()}`;
  }, [searchParams, orgSlug]);

  function navigateWithParams(updatedParams: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updatedParams)) {
      if (value === null || value === "" || value === "ALL") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    const queryString = params.toString();
    router.push(
      `/app/${encodeURIComponent(orgSlug)}/documents${queryString ? `?${queryString}` : ""}`,
    );
  }

  function handleTypeChange(val: string) {
    navigateWithParams({ type: val, page: null, cursor: null });
  }

  function handleStatusChange(val: string) {
    navigateWithParams({ status: val, page: null, cursor: null });
  }

  function handleSearchSubmit(e: FormEvent) {
    e.preventDefault();
    navigateWithParams({
      search: searchValue.trim() || null,
      page: null,
      cursor: null,
    });
  }

  function handleClearFilters() {
    setSearchValue("");
    const params = new URLSearchParams();
    if (searchParams.get("sheet")) {
      params.set("sheet", searchParams.get("sheet") as string);
    }
    const queryString = params.toString();
    router.push(
      `/app/${encodeURIComponent(orgSlug)}/documents${queryString ? `?${queryString}` : ""}`,
    );
  }

  function handlePageChange(targetPage: number) {
    navigateWithParams({ page: String(targetPage) });
  }

  const currentPage = pageInfo.page;
  const totalPages = Math.max(
    1,
    Math.ceil(pageInfo.totalCount / pageInfo.limit),
  );

  function getPageHref(targetPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(targetPage));
    return `/app/${encodeURIComponent(orgSlug)}/documents?${params.toString()}`;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Documentos Clínicos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulte e filtre todos os documentos clínicos emitidos e em
            rascunho.
          </p>
        </div>
        <Button asChild>
          <Link href={sheetHref}>
            <PlusIcon className="mr-2 size-4" />
            Novo documento
          </Link>
        </Button>
      </div>

      {/* Filters bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        {/* Tipo filter */}
        <div className="w-full md:w-56">
          <Select
            value={currentFilters.type || "ALL"}
            onValueChange={handleTypeChange}
          >
            <SelectTrigger className="w-full border-border bg-card">
              <SelectValue placeholder="Tipo de documento" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os tipos</SelectItem>
              <SelectItem value="PRESCRIPTION">Receita</SelectItem>
              <SelectItem value="CERTIFICATE">Atestado</SelectItem>
              <SelectItem value="REPORT">Laudo</SelectItem>
              <SelectItem value="EXAM_REQUEST">
                Solicitação de exames
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Situação filter */}
        <div className="w-full md:w-52">
          <Select
            value={currentFilters.status || "ALL"}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger className="w-full border-border bg-card">
              <SelectValue placeholder="Situação" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todas as situações</SelectItem>
              <SelectItem value="DRAFT">Rascunho</SelectItem>
              <SelectItem value="ISSUED">Emitido</SelectItem>
              <SelectItem value="VOIDED">Anulado</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Search input form */}
        <form
          onSubmit={handleSearchSubmit}
          className="relative flex flex-1 items-center gap-2"
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Buscar por paciente ou título..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="border-border bg-card pl-9"
            />
          </div>
          <Button type="submit" variant="secondary" size="default">
            Buscar
          </Button>
        </form>

        {/* Clear filters button */}
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            onClick={handleClearFilters}
            className="text-muted-foreground hover:text-foreground"
          >
            <XIcon className="mr-1.5 size-4" />
            Limpar filtros
          </Button>
        )}
      </div>

      {/* Content: Empty state or Table */}
      {documents.length === 0 ? (
        <Empty className="my-8 border border-dashed py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileTextIcon className="size-6 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>Nenhum documento clínico encontrado</EmptyTitle>
            <EmptyDescription>
              {hasActiveFilters
                ? "Nenhum documento clínico corresponde aos filtros aplicados. Tente ajustar ou limpar os filtros de busca."
                : "Nenhum documento clínico foi emitido ou criado nesta clínica até o momento."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {hasActiveFilters ? (
              <Button variant="outline" size="sm" onClick={handleClearFilters}>
                Limpar filtros
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href={sheetHref}>
                  <PlusIcon className="mr-1.5 size-4" />
                  Novo documento
                </Link>
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[170px]">Tipo</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Médico emissor</TableHead>
                  <TableHead className="w-[190px]">
                    Data de emissão/criação
                  </TableHead>
                  <TableHead className="w-[130px] text-right">
                    Situação
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow
                    key={doc.id}
                    className="cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 outline-none"
                    onClick={() =>
                      router.push(
                        `/app/${encodeURIComponent(orgSlug)}/documents/${encodeURIComponent(doc.id)}`,
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(
                          `/app/${encodeURIComponent(orgSlug)}/documents/${encodeURIComponent(doc.id)}`,
                        );
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Ver documento ${doc.title || doc.patient.fullName}`}
                  >
                    <TableCell>
                      <Badge variant="outline" className="font-normal">
                        {formatDocumentType(doc.type)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <Link
                          href={`/app/${encodeURIComponent(orgSlug)}/documents/${encodeURIComponent(doc.id)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-foreground hover:underline focus-visible:outline-none"
                        >
                          {doc.patient.fullName}
                        </Link>
                        {doc.title && (
                          <span className="max-w-[320px] truncate text-xs text-muted-foreground">
                            {doc.title}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {doc.author.fullName}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col text-sm">
                        <span>
                          {formatDocumentDate(doc.issuedAt ?? doc.createdAt)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {doc.issuedAt ? "Emissão" : "Criação"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {doc.status === "ISSUED" && (
                        <Badge
                          variant="outline"
                          className="border-emerald-600/30 bg-emerald-50 font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400"
                        >
                          {formatDocumentStatus(doc.status)}
                        </Badge>
                      )}
                      {doc.status === "DRAFT" && (
                        <Badge
                          variant="secondary"
                          className="font-medium text-muted-foreground"
                        >
                          {formatDocumentStatus(doc.status)}
                        </Badge>
                      )}
                      {doc.status === "VOIDED" && (
                        <Badge variant="destructive" className="font-medium">
                          {formatDocumentStatus(doc.status)}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Footer info and Pagination */}
          <div className="flex flex-col items-center justify-between gap-4 py-2 sm:flex-row">
            <span className="text-xs text-muted-foreground">
              Exibindo {documents.length} de {pageInfo.totalCount}{" "}
              {pageInfo.totalCount === 1 ? "documento" : "documentos"}
            </span>

            {totalPages > 1 && (
              <Pagination className="mx-0 w-auto">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      text="Anterior"
                      href={getPageHref(currentPage - 1)}
                      aria-disabled={currentPage <= 1}
                      className={
                        currentPage <= 1
                          ? "pointer-events-none opacity-50"
                          : undefined
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        if (currentPage > 1) {
                          handlePageChange(currentPage - 1);
                        }
                      }}
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="px-3 text-sm text-muted-foreground">
                      Página {currentPage} de {totalPages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      text="Próxima"
                      href={getPageHref(currentPage + 1)}
                      aria-disabled={
                        currentPage >= totalPages || !pageInfo.hasNextPage
                      }
                      className={
                        currentPage >= totalPages || !pageInfo.hasNextPage
                          ? "pointer-events-none opacity-50"
                          : undefined
                      }
                      onClick={(e) => {
                        e.preventDefault();
                        if (currentPage < totalPages && pageInfo.hasNextPage) {
                          handlePageChange(currentPage + 1);
                        }
                      }}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
