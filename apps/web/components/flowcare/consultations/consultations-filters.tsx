"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ConsultationsFilters({
  selectedPeriod,
  selectedStatus,
}: {
  selectedPeriod?: string;
  selectedStatus?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentPeriod = selectedPeriod ?? "all";
  const currentStatus = selectedStatus ?? "all";

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.delete("page");
    params.delete("cursor");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const clearFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("period");
    params.delete("status");
    params.delete("page");
    params.delete("cursor");
    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  };

  const hasFilters =
    (currentPeriod !== "all" && Boolean(currentPeriod)) ||
    (currentStatus !== "all" && Boolean(currentStatus));

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-48">
        <Select
          value={currentPeriod}
          onValueChange={(val) => updateFilter("period", val)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os períodos</SelectItem>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="week">Esta semana</SelectItem>
            <SelectItem value="month">Mês</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="w-48">
        <Select
          value={currentStatus}
          onValueChange={(val) => updateFilter("status", val)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Status da consulta" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="SCHEDULED">Agendada</SelectItem>
            <SelectItem value="IN_PROGRESS">Em andamento</SelectItem>
            <SelectItem value="COMPLETED">Concluída</SelectItem>
            <SelectItem value="CANCELLED">Cancelada</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="mr-1 size-3.5" />
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
