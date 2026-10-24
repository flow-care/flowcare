"use client";

import { AlertCircleIcon, SearchIcon, UserPlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  APPOINTMENT_DURATION_OPTIONS,
  getDefaultAppointmentTime,
  getTodayDateString,
  zonedDateTimeToUtc,
} from "@/lib/appointments";
import { maskCpf } from "@/lib/patient-formatters";
import {
  isServerActionMissingError,
  recoverFromStaleBuild,
  STALE_BUILD_MESSAGE,
} from "@/lib/stale-build";
import type {
  PatientSearchResultItem,
  ProfessionalItem,
} from "@/server/appointments";
import { createAppointment, searchPatients } from "./actions";

interface NewAppointmentSheetProps {
  isOpen: boolean;
  onClose: () => void;
  orgSlug: string;
  timeZone?: string;
  initialDate?: string;
  initialTime?: string;
  professionals: ProfessionalItem[];
  onSuccess?: () => void;
}

export function NewAppointmentSheet({
  isOpen,
  onClose,
  orgSlug,
  timeZone = "America/Sao_Paulo",
  initialDate,
  initialTime,
  professionals,
  onSuccess,
}: NewAppointmentSheetProps) {
  const [date, setDate] = useState(() => initialDate || getTodayDateString());
  const [time, setTime] = useState(
    () => initialTime || getDefaultAppointmentTime(),
  );
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [notes, setNotes] = useState("");
  const [professionalId, setProfessionalId] = useState(() =>
    professionals.length === 1 ? professionals[0].id : "",
  );

  // Patient Autocomplete State
  const [selectedPatient, setSelectedPatient] =
    useState<PatientSearchResultItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<PatientSearchResultItem[]>(
    [],
  );
  const [isSearching, setIsSearching] = useState(false);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [scheduleNotConfigured, setScheduleNotConfigured] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `appt_${Date.now()}`,
  );

  // Reset form when sheet opens
  useEffect(() => {
    if (isOpen) {
      setDate(initialDate || getTodayDateString());
      setTime(initialTime || getDefaultAppointmentTime());
      setDurationMinutes(30);
      setNotes("");
      setSelectedPatient(null);
      setSearchTerm("");
      setSearchResults([]);
      setConflictWarning(null);
      setGeneralError(null);
      if (professionals.length === 1) {
        setProfessionalId(professionals[0].id);
      }
      setIdempotencyKey(
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `appt_${Date.now()}`,
      );
    }
  }, [isOpen, initialDate, initialTime, professionals]);

  // Debounced Patient Search
  useEffect(() => {
    if (!searchTerm.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchPatients(orgSlug, searchTerm);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchTerm, orgSlug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!selectedPatient) {
      setGeneralError("Selecione um paciente para continuar.");
      return;
    }

    if (!professionalId) {
      setGeneralError("Selecione um profissional responsável.");
      return;
    }

    if (!date || !time) {
      setGeneralError("Informe a data e o horário do agendamento.");
      return;
    }

    setIsSubmitting(true);
    setConflictWarning(null);
    setGeneralError(null);
    setScheduleNotConfigured(false);

    try {
      const scheduledAtUtc = zonedDateTimeToUtc(date, time, timeZone);

      await createAppointment(orgSlug, {
        patientId: selectedPatient.id,
        professionalId,
        scheduledAt: scheduledAtUtc,
        durationMinutes,
        notes: notes.trim() || null,
        idempotencyKey,
      });

      toast.success("Agendamento criado com sucesso!");
      onClose();
      onSuccess?.();
    } catch (err) {
      if (isServerActionMissingError(err)) {
        setGeneralError(STALE_BUILD_MESSAGE);
        recoverFromStaleBuild();
        return;
      }

      const error = err as { code?: string; message?: string };
      if (error?.code === "SCHEDULE_NOT_CONFIGURED") {
        setScheduleNotConfigured(true);
        setGeneralError(
          error.message ||
            "A clínica ainda não tem horário de atendimento configurado.",
        );
      } else if (error?.code === "SLOT_CONFLICT") {
        setConflictWarning(
          error.message ||
            "O horário selecionado conflita com outro agendamento do profissional.",
        );
      } else {
        setGeneralError(
          error?.message ||
            "Não foi possível salvar o agendamento. Tente novamente.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-6 flex flex-col gap-6 overflow-y-auto"
      >
        <SheetHeader className="gap-1.5 text-left">
          <SheetTitle className="text-xl font-semibold text-foreground">
            Novo Agendamento
          </SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            Preencha os dados abaixo para reservar um horário na agenda.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5 flex-1">
          {/* Patient Selection Field */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="patient-search" className="text-foreground">
                Paciente *
              </Label>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs text-primary font-medium"
                asChild
              >
                <Link
                  href={`/app/${encodeURIComponent(orgSlug)}/patients?sheet=new`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <UserPlusIcon className="mr-1 size-3.5" />
                  Novo paciente
                </Link>
              </Button>
            </div>

            {selectedPatient ? (
              <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground text-sm">
                    {selectedPatient.fullName}
                  </span>
                  {selectedPatient.cpf && (
                    <span className="text-xs text-muted-foreground font-mono">
                      CPF: {maskCpf(selectedPatient.cpf)}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedPatient(null);
                    setSearchTerm("");
                  }}
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                >
                  Alterar
                </Button>
              </div>
            ) : (
              <div className="relative">
                <InputGroup className="border-border">
                  <InputGroupAddon align="inline-start">
                    <SearchIcon className="size-4 text-muted-foreground" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="patient-search"
                    type="search"
                    placeholder="Buscar por nome ou CPF..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoComplete="off"
                    aria-label="Buscar paciente"
                  />
                  {isSearching ? (
                    <InputGroupAddon align="inline-end">
                      <Spinner className="size-4 text-muted-foreground" />
                    </InputGroupAddon>
                  ) : searchTerm ? (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton
                        type="button"
                        size="icon-xs"
                        onClick={() => setSearchTerm("")}
                        aria-label="Limpar busca"
                      >
                        <XIcon className="size-3.5" />
                      </InputGroupButton>
                    </InputGroupAddon>
                  ) : null}
                </InputGroup>

                {/* Dropdown Results */}
                {searchResults.length > 0 ? (
                  <div className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-lg p-1 flex flex-col gap-0.5">
                    {searchResults.map((patient) => (
                      <button
                        key={patient.id}
                        type="button"
                        onClick={() => {
                          setSelectedPatient(patient);
                          setSearchTerm("");
                          setSearchResults([]);
                        }}
                        className="w-full text-left p-2.5 rounded-md hover:bg-muted text-sm flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <span className="font-medium text-foreground">
                          {patient.fullName}
                        </span>
                        {patient.cpf && (
                          <span className="text-xs text-muted-foreground font-mono">
                            {maskCpf(patient.cpf)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ) : searchTerm.trim().length >= 2 && !isSearching ? (
                  <div className="absolute z-10 left-0 right-0 mt-1 p-3 rounded-lg border border-border bg-card text-center text-xs text-muted-foreground flex flex-col items-center gap-2 shadow-lg">
                    <span>Nenhum paciente encontrado.</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      asChild
                    >
                      <Link
                        href={`/app/${encodeURIComponent(orgSlug)}/patients?sheet=new`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <UserPlusIcon className="mr-1 size-3.5" />
                        Cadastrar paciente
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Professional Selection */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="professional-select" className="text-foreground">
              Profissional *
            </Label>
            <Select
              value={professionalId}
              onValueChange={(val) => {
                setProfessionalId(val);
                setConflictWarning(null);
              }}
            >
              <SelectTrigger
                id="professional-select"
                className="w-full border-border"
              >
                <SelectValue placeholder="Selecione um profissional" />
              </SelectTrigger>
              <SelectContent>
                {professionals.length === 0 ? (
                  <SelectItem value="none" disabled>
                    Nenhum profissional disponível
                  </SelectItem>
                ) : (
                  professionals.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Date and Time Row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="appointment-date" className="text-foreground">
                Data *
              </Label>
              <Input
                id="appointment-date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setConflictWarning(null);
                }}
                className="border-border"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="appointment-time" className="text-foreground">
                Horário *
              </Label>
              <Input
                id="appointment-time"
                type="time"
                value={time}
                onChange={(e) => {
                  setTime(e.target.value);
                  setConflictWarning(null);
                }}
                className="border-border"
                required
              />
            </div>
          </div>

          {/* Duration Selector */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="appointment-duration" className="text-foreground">
              Duração *
            </Label>
            <Select
              value={String(durationMinutes)}
              onValueChange={(val) => {
                setDurationMinutes(Number(val));
                setConflictWarning(null);
              }}
            >
              <SelectTrigger
                id="appointment-duration"
                className="w-full border-border"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {APPOINTMENT_DURATION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes Field */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="appointment-notes" className="text-foreground">
              Observações
            </Label>
            <Textarea
              id="appointment-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Motivo da consulta ou observações adicionais (opcional)"
              rows={3}
              className="border-border"
              maxLength={2000}
            />
          </div>

          {/* Conflict Warning (409 SLOT_CONFLICT) */}
          {conflictWarning && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2.5"
            >
              <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-xs uppercase tracking-wide">
                  Conflito de Horário
                </span>
                <span className="text-xs opacity-90">{conflictWarning}</span>
              </div>
            </div>
          )}

          {/* General Error */}
          {generalError && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2.5"
            >
              <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
              <span className="text-xs">{generalError}</span>
              {scheduleNotConfigured && (
                <Link
                  href={`/app/${orgSlug}/settings/schedules`}
                  className="ml-auto shrink-0 text-xs font-medium underline underline-offset-2"
                >
                  Configurar horários
                </Link>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-border mt-auto">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={
                isSubmitting ||
                !selectedPatient ||
                !professionalId ||
                !date ||
                !time
              }
            >
              {isSubmitting ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  Salvando...
                </>
              ) : (
                "Criar agendamento"
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
