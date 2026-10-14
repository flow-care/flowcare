"use client";

import {
  AlertCircleIcon,
  ChevronRightIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  SearchXIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBirthDateAndAge, maskCpf } from "@/lib/patient-formatters";
import { formatPhoneWithAreaCode } from "@/lib/phone";
import { cn } from "@/lib/utils";
import type { ListPatientsResponse } from "@/server/patients";
import { NewPatientSheet } from "./new-patient-sheet";

interface PatientsViewProps {
  orgSlug: string;
  initialSearch: string;
  currentPage: number;
  patientsResponse: ListPatientsResponse | null;
  hasError: boolean;
  errorMessage: string | null;
  sheet?: string;
}

export function PatientsView({
  orgSlug,
  initialSearch,
  currentPage,
  patientsResponse,
  hasError,
  errorMessage,
  sheet,
}: PatientsViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(initialSearch);
  const [isPending, startTransition] = useTransition();

  const isNewPatientSheetOpen = (searchParams.get("sheet") ?? sheet) === "new";

  const handleCloseNewPatientSheet = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("sheet");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const handleNewPatientSuccess = (patientId: string) => {
    router.push(`/app/${orgSlug}/patients/${patientId}`);
  };

  const newPatientHref = (() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sheet", "new");
    return `${pathname}?${params.toString()}`;
  })();

  // Track cursor history across pages for going backwards
  const [cursorHistory, setCursorHistory] = useState<
    Record<number, string | null>
  >({
    1: null,
  });

  // Keep search term in sync if URL changes externally
  const urlSearch = searchParams.get("search") ?? "";
  useEffect(() => {
    setSearchTerm(urlSearch);
  }, [urlSearch]);

  // Save the next cursor for the following page whenever we receive new page data
  const nextCursor = patientsResponse?.pageInfo?.nextCursor ?? null;
  const hasNextPage = patientsResponse?.pageInfo?.hasNextPage ?? false;

  useEffect(() => {
    if (nextCursor) {
      setCursorHistory((prev) => ({
        ...prev,
        [currentPage + 1]: nextCursor,
      }));
    }
  }, [nextCursor, currentPage]);

  // Debounced search handling (350ms >= 300ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      const currentUrlSearch = searchParams.get("search") ?? "";
      if (searchTerm.trim() === currentUrlSearch.trim()) {
        return;
      }

      startTransition(() => {
        const params = new URLSearchParams(searchParams.toString());
        if (searchTerm.trim()) {
          params.set("search", searchTerm.trim());
        } else {
          params.delete("search");
        }
        params.delete("cursor");
        params.delete("page");

        // Reset cursor history on new search
        setCursorHistory({ 1: null });

        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname);
      });
    }, 350);

    return () => {
      clearTimeout(handler);
    };
  }, [searchTerm, pathname, router, searchParams]);

  const handleClearSearch = () => {
    setSearchTerm("");
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("search");
      params.delete("cursor");
      params.delete("page");
      setCursorHistory({ 1: null });
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname);
    });
  };

  const handleNextPage = () => {
    if (!hasNextPage || !nextCursor || isPending) return;
    const nextPage = currentPage + 1;
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("page", String(nextPage));
      params.set("cursor", nextCursor);
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const handlePrevPage = () => {
    if (currentPage <= 1 || isPending) return;
    const prevPage = currentPage - 1;
    const prevCursor = cursorHistory[prevPage];
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (prevPage <= 1) {
        params.delete("page");
        params.delete("cursor");
      } else {
        params.set("page", String(prevPage));
        if (prevCursor) {
          params.set("cursor", prevCursor);
        } else {
          params.delete("cursor");
        }
      }
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  const patients = patientsResponse?.data ?? [];
  const isSearchActive = Boolean(initialSearch.trim());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Pacientes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gerencie o cadastro, localize prontuários e visualize os dados dos
            pacientes.
          </p>
        </div>
        <Button asChild>
          <Link href={newPatientHref}>
            <PlusIcon className="mr-2 size-4" />
            Novo paciente
          </Link>
        </Button>
      </div>

      {/* Search Input Bar */}
      <div className="flex items-center">
        <InputGroup className="w-full max-w-md border-border bg-card">
          <InputGroupAddon align="inline-start">
            <SearchIcon className="size-4 text-muted-foreground" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="Buscar por nome, CPF ou telefone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Buscar pacientes por nome, CPF ou telefone"
          />
          {isPending ? (
            <InputGroupAddon align="inline-end">
              <Spinner className="size-4 text-muted-foreground" />
            </InputGroupAddon>
          ) : searchTerm ? (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                onClick={handleClearSearch}
                aria-label="Limpar busca"
              >
                <XIcon className="size-3.5" />
              </InputGroupButton>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </div>

      {/* Error State */}
      {hasError ? (
        <div className="flex min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-destructive/30 bg-card p-12 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertCircleIcon className="size-6" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">
            Erro ao carregar pacientes
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {errorMessage ||
              "Não foi possível carregar a lista de pacientes. Verifique sua conexão e tente novamente."}
          </p>
          <Button
            type="button"
            onClick={() => {
              startTransition(() => {
                router.refresh();
              });
            }}
            variant="outline"
            className="mt-6"
          >
            <RotateCcwIcon className="mr-2 size-4" />
            Tentar novamente
          </Button>
        </div>
      ) : patients.length === 0 ? (
        /* Empty State */
        isSearchActive ? (
          <Empty className="border border-dashed border-border bg-card py-16">
            <EmptyMedia variant="icon">
              <SearchXIcon className="size-6 text-muted-foreground" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>Nenhum paciente encontrado</EmptyTitle>
              <EmptyDescription>
                Não encontramos pacientes correspondentes a &ldquo;
                {initialSearch}&rdquo;. Verifique o termo digitado ou limpe a
                busca.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                type="button"
                variant="outline"
                onClick={handleClearSearch}
              >
                Limpar busca
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <Empty className="border border-dashed border-border bg-card py-16">
            <EmptyMedia variant="icon">
              <UsersIcon className="size-6 text-muted-foreground" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>Nenhum paciente cadastrado</EmptyTitle>
              <EmptyDescription>
                Sua clínica ainda não possui pacientes cadastrados. Cadastre o
                primeiro paciente para começar a gerenciar os atendimentos.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button asChild>
                <Link href={newPatientHref}>
                  <UserPlusIcon className="mr-2 size-4" />
                  Novo paciente
                </Link>
              </Button>
            </EmptyContent>
          </Empty>
        )
      ) : (
        /* Populated State with Table */
        <div className="space-y-4">
          <div
            className={cn(
              "overflow-hidden rounded-lg border border-border bg-card transition-opacity",
              isPending && "opacity-60",
            )}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%]">Nome completo</TableHead>
                  <TableHead className="w-[18%]">CPF</TableHead>
                  <TableHead className="w-[18%]">Telefone</TableHead>
                  <TableHead className="w-[20%]">Idade / Nascimento</TableHead>
                  <TableHead className="w-[14%] text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {patients.map((patient) => {
                  const { ageText, birthDateFormatted } = formatBirthDateAndAge(
                    patient.birthDate,
                  );
                  return (
                    <TableRow
                      key={patient.id}
                      tabIndex={0}
                      role="button"
                      aria-label={`Ver detalhes de ${patient.fullName}`}
                      className="cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50"
                      onClick={() => {
                        router.push(`/app/${orgSlug}/patients/${patient.id}`);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(`/app/${orgSlug}/patients/${patient.id}`);
                        }
                      }}
                    >
                      <TableCell className="font-medium text-foreground">
                        <div className="flex flex-col">
                          <span>{patient.fullName}</span>
                          {patient.email ? (
                            <span className="text-xs font-normal text-muted-foreground">
                              {patient.email}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {maskCpf(patient.cpf)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatPhoneWithAreaCode(patient.phone) || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-foreground">
                            {ageText}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {birthDateFormatted}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button variant="ghost" size="sm" asChild>
                          <Link
                            href={`/app/${orgSlug}/patients/${patient.id}`}
                            aria-label={`Ver perfil de ${patient.fullName}`}
                          >
                            <span>Ver perfil</span>
                            <ChevronRightIcon className="ml-1 size-4" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between py-2">
            <p className="text-sm text-muted-foreground">
              Mostrando{" "}
              <span className="font-medium text-foreground">
                {patients.length}
              </span>{" "}
              paciente{patients.length === 1 ? "" : "s"}
              {isSearchActive ? " encontrado(s)" : ""}
            </p>

            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    text="Anterior"
                    role="button"
                    tabIndex={currentPage <= 1 || isPending ? -1 : 0}
                    aria-disabled={currentPage <= 1 || isPending}
                    className={cn(
                      "cursor-pointer",
                      (currentPage <= 1 || isPending) &&
                        "pointer-events-none opacity-50",
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      handlePrevPage();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handlePrevPage();
                      }
                    }}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="flex h-9 items-center px-3 text-sm font-medium text-muted-foreground select-none">
                    Página {currentPage}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    text="Próximo"
                    role="button"
                    tabIndex={!hasNextPage || isPending ? -1 : 0}
                    aria-disabled={!hasNextPage || isPending}
                    className={cn(
                      "cursor-pointer",
                      (!hasNextPage || isPending) &&
                        "pointer-events-none opacity-50",
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      handleNextPage();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleNextPage();
                      }
                    }}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </div>
      )}

      {/* New Patient Registration Sheet */}
      <NewPatientSheet
        isOpen={isNewPatientSheetOpen}
        onClose={handleCloseNewPatientSheet}
        orgSlug={orgSlug}
        onSuccess={handleNewPatientSuccess}
      />
    </div>
  );
}
