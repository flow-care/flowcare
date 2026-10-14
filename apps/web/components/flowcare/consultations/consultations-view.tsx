"use client";

import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Stethoscope,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ListConsultationsResponse } from "@/server/consultations";
import {
  AnamnesisStatusBadge,
  ConsultationStatusBadge,
} from "./consultation-badges";
import { ConsultationsFilters } from "./consultations-filters";
import { formatScheduledAt } from "./format-date";

export function ConsultationsView({
  orgSlug,
  data,
  errorMessage,
  selectedPeriod,
  selectedStatus,
}: {
  orgSlug: string;
  data: ListConsultationsResponse | null;
  errorMessage: string | null;
  selectedPeriod?: string;
  selectedStatus?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleRowClick = (consultationId: string) => {
    router.push(
      `/app/${encodeURIComponent(orgSlug)}/consultations/${encodeURIComponent(consultationId)}`,
    );
  };

  const hasFilters = Boolean(
    (selectedPeriod && selectedPeriod !== "all") ||
      (selectedStatus && selectedStatus !== "all"),
  );

  const clearFilters = () => {
    router.push(pathname);
  };

  const totalPages = data?.pageInfo
    ? Math.max(1, Math.ceil(data.pageInfo.totalCount / data.pageInfo.limit))
    : 1;
  const currentPage = data?.pageInfo?.page ?? 1;
  const hasPrev = currentPage > 1;
  const hasNext = Boolean(
    data?.pageInfo?.hasNextPage || (data?.pageInfo && currentPage < totalPages),
  );

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newPage > 1) {
      params.set("page", String(newPage));
    } else {
      params.delete("page");
    }
    params.delete("cursor");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Atendimentos Clínicos
        </h1>
        <p className="text-sm text-muted-foreground">
          Localize atendimentos realizados, em andamento ou agendados da equipe
          médica.
        </p>
      </div>

      <ConsultationsFilters
        selectedPeriod={selectedPeriod}
        selectedStatus={selectedStatus}
      />

      {errorMessage ? (
        <Empty className="border border-destructive/20 bg-destructive/5 py-12">
          <EmptyMedia
            variant="icon"
            className="bg-destructive/10 text-destructive"
          >
            <AlertCircle className="size-6 text-destructive" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle className="text-destructive">
              Não foi possível carregar os atendimentos
            </EmptyTitle>
            <EmptyDescription>{errorMessage}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={() => {
                router.refresh();
              }}
            >
              <RotateCcw className="mr-2 size-4" />
              Tentar novamente
            </Button>
          </EmptyContent>
        </Empty>
      ) : !data || data.data.length === 0 ? (
        <Empty className="border border-dashed border-border py-12">
          <EmptyMedia variant="icon">
            <Stethoscope className="size-6 text-muted-foreground" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>Nenhum atendimento clínico encontrado</EmptyTitle>
            <EmptyDescription>
              {hasFilters
                ? "Nenhum atendimento encontrado para os filtros selecionados. Tente ajustar o período ou status."
                : "Não há atendimentos clínicos registrados para esta clínica."}
            </EmptyDescription>
          </EmptyHeader>
          {hasFilters && (
            <EmptyContent>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Limpar filtros
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Data/Hora</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Médico Responsável</TableHead>
                  <TableHead className="w-[160px]">
                    Status da Consulta
                  </TableHead>
                  <TableHead className="w-[160px]">
                    Status da Anamnese
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50"
                    tabIndex={0}
                    role="button"
                    aria-label={`Abrir consulta de ${item.patient.fullName}`}
                    onClick={() => handleRowClick(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleRowClick(item.id);
                      }
                    }}
                  >
                    <TableCell className="font-medium text-foreground">
                      {formatScheduledAt(
                        item.scheduledAt,
                        item.localScheduledAt,
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {item.patient.fullName}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {item.professional.fullName}
                        </span>
                        {item.professional.professionalTitle && (
                          <span className="text-xs text-muted-foreground">
                            {item.professional.professionalTitle}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ConsultationStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell>
                      <AnamnesisStatusBadge status={item.anamnesisStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {data.pageInfo && (
            <div className="flex flex-col items-center justify-between gap-4 py-2 sm:flex-row">
              <p className="text-sm text-muted-foreground">
                Mostrando{" "}
                <span className="font-medium text-foreground">
                  {Math.min(
                    (currentPage - 1) * data.pageInfo.limit + 1,
                    data.pageInfo.totalCount,
                  )}
                </span>{" "}
                a{" "}
                <span className="font-medium text-foreground">
                  {Math.min(
                    currentPage * data.pageInfo.limit,
                    data.pageInfo.totalCount,
                  )}
                </span>{" "}
                de{" "}
                <span className="font-medium text-foreground">
                  {data.pageInfo.totalCount}
                </span>{" "}
                atendimentos
              </p>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasPrev}
                  onClick={() => goToPage(currentPage - 1)}
                >
                  <ChevronLeft className="mr-1 size-4" />
                  Anterior
                </Button>

                <span className="px-2 text-sm text-muted-foreground">
                  Página {currentPage} de {totalPages}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasNext}
                  onClick={() => goToPage(currentPage + 1)}
                >
                  Próxima
                  <ChevronRight className="ml-1 size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
