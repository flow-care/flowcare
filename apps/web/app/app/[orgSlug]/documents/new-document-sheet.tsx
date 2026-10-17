"use client";

import {
  ActivityIcon,
  AlertCircleIcon,
  ArrowLeftIcon,
  EyeIcon,
  FileCheckIcon,
  FileTextIcon,
  PillIcon,
  SearchIcon,
  SparklesIcon,
  UserIcon,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
  DOCUMENT_CREATION_TYPE_CONFIGS,
  type DocumentCreationType,
  isDocumentFormDirty,
  isValidDocumentCreationType,
  resolveTemplateVariables,
  VALID_DOCUMENT_CREATION_TYPES,
} from "@/lib/documents";
import { maskCpf } from "@/lib/patient-formatters";
import type { DocumentTemplateItem } from "@/server/documents";
import type { PatientItem } from "@/server/patients";
import {
  createDocumentAction,
  getDocumentTemplatesAction,
  searchPatientsAction,
} from "./actions";

interface NewDocumentSheetProps {
  isOpen: boolean;
  onClose: () => void;
  orgSlug: string;
  initialType?: string | null;
  doctorName?: string;
  onSuccess?: (documentId: string) => void;
}

const TYPE_ICONS: Record<
  DocumentCreationType,
  React.ComponentType<{ className?: string }>
> = {
  prescription: PillIcon,
  report: FileTextIcon,
  certificate: FileCheckIcon,
  exam: ActivityIcon,
  custom: SparklesIcon,
};

export function NewDocumentSheet({
  isOpen,
  onClose,
  orgSlug,
  initialType,
  doctorName,
  onSuccess,
}: NewDocumentSheetProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Selected document creation type
  const [selectedType, setSelectedType] = useState<DocumentCreationType | null>(
    () => {
      const paramType = searchParams.get("type") || initialType;
      return isValidDocumentCreationType(paramType)
        ? (paramType.toLowerCase() as DocumentCreationType)
        : null;
    },
  );

  // Form Fields
  const [selectedPatient, setSelectedPatient] = useState<PatientItem | null>(
    null,
  );
  const [patientSearchTerm, setPatientSearchTerm] = useState("");
  const [patientSearchResults, setPatientSearchResults] = useState<
    PatientItem[]
  >([]);
  const [isSearchingPatients, setIsSearchingPatients] = useState(false);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [availableTemplates, setAvailableTemplates] = useState<
    DocumentTemplateItem[]
  >([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  // Validation & UI states
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `doc_${Date.now()}`,
  );

  const patientSearchId = useId();
  const titleId = useId();
  const contentId = useId();
  const notesId = useId();
  const templateSelectId = useId();

  const typeConfig = selectedType
    ? DOCUMENT_CREATION_TYPE_CONFIGS[selectedType]
    : null;

  const defaultTitle = typeConfig?.defaultTitle || "";

  const todayFormatted = useMemo(() => {
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "America/Sao_Paulo",
    }).format(new Date());
  }, []);

  // Form dirty state check
  const isDirty = useMemo(() => {
    return isDocumentFormDirty({
      patientId: selectedPatient?.id,
      title,
      defaultTitle,
      content,
      notes,
    });
  }, [selectedPatient, title, defaultTitle, content, notes]);

  const resetForm = useCallback(() => {
    setSelectedPatient(null);
    setPatientSearchTerm("");
    setPatientSearchResults([]);
    setTitle("");
    setContent("");
    setNotes("");
    setSelectedTemplateId(null);
    setErrors({});
    setGeneralError(null);
    setIsSubmitting(false);
    setIsPreviewOpen(false);
    setShowDiscardConfirm(false);
    setIdempotencyKey(
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `doc_${Date.now()}`,
    );
  }, []);

  // Sync selected type when query param changes or sheet opens
  useEffect(() => {
    if (isOpen) {
      const paramType = searchParams.get("type") || initialType;
      if (isValidDocumentCreationType(paramType)) {
        const nextType = paramType.toLowerCase() as DocumentCreationType;
        setSelectedType(nextType);
        setTitle(DOCUMENT_CREATION_TYPE_CONFIGS[nextType].defaultTitle);
      } else {
        setSelectedType(null);
        setTitle("");
      }
      resetForm();
    }
  }, [isOpen, searchParams, initialType, resetForm]);

  // Fetch available templates whenever selectedType changes
  useEffect(() => {
    if (!isOpen || !selectedType) {
      setAvailableTemplates([]);
      return;
    }

    let isCancelled = false;
    setIsLoadingTemplates(true);

    getDocumentTemplatesAction(orgSlug, selectedType)
      .then((res) => {
        if (!isCancelled) {
          if (res.success) {
            setAvailableTemplates(res.data);
          } else {
            setAvailableTemplates([]);
          }
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setAvailableTemplates([]);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingTemplates(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, selectedType, orgSlug]);

  // Debounced Patient Search
  useEffect(() => {
    if (!patientSearchTerm.trim()) {
      setPatientSearchResults([]);
      setIsSearchingPatients(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearchingPatients(true);
      try {
        const results = await searchPatientsAction(orgSlug, patientSearchTerm);
        setPatientSearchResults(results);
      } catch {
        setPatientSearchResults([]);
      } finally {
        setIsSearchingPatients(false);
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [patientSearchTerm, orgSlug]);

  const handleSelectType = (typeKey: DocumentCreationType) => {
    setSelectedType(typeKey);
    setTitle(DOCUMENT_CREATION_TYPE_CONFIGS[typeKey].defaultTitle);
    const params = new URLSearchParams(searchParams.toString());
    params.set("sheet", "new");
    params.set("type", typeKey);
    router.push(
      `/app/${encodeURIComponent(orgSlug)}/documents?${params.toString()}`,
    );
  };

  const handleBackToTypeSelection = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    setSelectedType(null);
    setTitle("");
    setContent("");
    setNotes("");
    setSelectedPatient(null);
    setSelectedTemplateId(null);
    const params = new URLSearchParams(searchParams.toString());
    params.set("sheet", "new");
    params.delete("type");
    router.push(
      `/app/${encodeURIComponent(orgSlug)}/documents?${params.toString()}`,
    );
  };

  const handleSelectPatient = (pt: PatientItem) => {
    setSelectedPatient(pt);
    setPatientSearchTerm("");
    setPatientSearchResults([]);
    setErrors((prev) => ({ ...prev, patient: "" }));

    if (
      content.includes("{paciente_nome}") ||
      content.includes("{paciente}") ||
      content.includes("{{paciente_nome}}") ||
      content.includes("{{paciente}}")
    ) {
      setContent((prev) =>
        resolveTemplateVariables(prev, { paciente_nome: pt.fullName }),
      );
    }
  };

  const handleClearPatient = () => {
    setSelectedPatient(null);
    setPatientSearchTerm("");
    setPatientSearchResults([]);
  };

  const handleSelectTemplate = (templateId: string) => {
    if (templateId === "none") {
      setSelectedTemplateId(null);
      return;
    }
    const tmpl = availableTemplates.find((t) => t.id === templateId);
    if (!tmpl) return;

    setSelectedTemplateId(tmpl.id);

    if (!title.trim() || title === defaultTitle) {
      setTitle(tmpl.title);
    }

    const resolved = resolveTemplateVariables(tmpl.bodyTemplate, {
      paciente_nome: selectedPatient?.fullName,
      data: todayFormatted,
      medico_nome: doctorName,
    });
    setContent(resolved);
    setErrors((prev) => ({ ...prev, content: "" }));
  };

  const handleRequestClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      resetForm();
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    setShowDiscardConfirm(false);
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const newErrors: Record<string, string> = {};
    if (!selectedPatient) {
      newErrors.patient = "Selecione um paciente para continuar.";
    }
    if (!title.trim()) {
      newErrors.title = "Título do documento é obrigatório.";
    }
    if (!content.trim()) {
      newErrors.content = "Conteúdo do documento é obrigatório.";
    }

    if (!selectedPatient || !selectedType) {
      return;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    setGeneralError(null);

    try {
      const result = await createDocumentAction(orgSlug, {
        patientId: selectedPatient.id,
        type: selectedType,
        title: title.trim(),
        content: content.trim(),
        notes: notes.trim() || undefined,
        templateId: selectedTemplateId || undefined,
        idempotencyKey,
      });

      if (!result.success || !result.data) {
        setGeneralError(result.error || "Não foi possível criar o documento.");
        toast.error(result.error || "Não foi possível criar o documento.");
        return;
      }

      toast.success("Rascunho de documento salvo com sucesso!");
      resetForm();
      onClose();
      if (onSuccess) {
        onSuccess(result.data.id || result.data.documentId);
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Erro inesperado ao salvar rascunho.";
      setGeneralError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Sheet
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) handleRequestClose();
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-2xl md:max-w-3xl overflow-y-auto bg-card p-6"
        >
          {/* Header */}
          <SheetHeader className="mb-6 space-y-1">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-xl font-semibold tracking-tight text-foreground">
                {selectedType
                  ? "Novo Documento Clínico"
                  : "Selecionar Tipo de Documento"}
              </SheetTitle>
              {typeConfig && (
                <Badge variant="outline" className="border-border font-medium">
                  {typeConfig.badgeLabel}
                </Badge>
              )}
            </div>
            <SheetDescription className="text-sm text-muted-foreground">
              {selectedType
                ? "Preencha as informações do documento. O documento será salvo inicialmente como rascunho."
                : "Escolha o tipo de documento clínico que deseja emitir para prosseguir com a criação."}
            </SheetDescription>
          </SheetHeader>

          {/* VIEW 1: Type Selection Grid (When type is missing or invalid) */}
          {!selectedType ? (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tipos disponíveis no prontuário
              </p>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                {VALID_DOCUMENT_CREATION_TYPES.map((typeKey) => {
                  const cfg = DOCUMENT_CREATION_TYPE_CONFIGS[typeKey];
                  const Icon = TYPE_ICONS[typeKey];
                  return (
                    <button
                      key={typeKey}
                      type="button"
                      onClick={() => handleSelectType(typeKey)}
                      className="group flex flex-col items-start rounded-xl border border-border bg-background p-4 text-left transition-all hover:border-primary hover:bg-accent/40 hover:shadow-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon className="size-5" />
                      </div>
                      <span className="font-medium text-foreground group-hover:text-primary">
                        {cfg.label}
                      </span>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                        {cfg.shortDescription}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            /* VIEW 2: Document Creation Form */
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Back to Type Selection Bar */}
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
                <button
                  type="button"
                  onClick={handleBackToTypeSelection}
                  className="flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeftIcon className="size-3.5" />
                  Trocar tipo de documento
                </button>
                <span className="font-semibold text-foreground">
                  {typeConfig?.label}
                </span>
              </div>

              {/* General error message */}
              {generalError && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircleIcon className="size-4 shrink-0" />
                  <span>{generalError}</span>
                </div>
              )}

              {/* Patient Selector */}
              <div className="space-y-2">
                <Label htmlFor={patientSearchId} className="text-foreground">
                  Paciente <span className="text-destructive">*</span>
                </Label>

                {!selectedPatient ? (
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id={patientSearchId}
                      type="search"
                      placeholder="Buscar paciente por nome ou CPF..."
                      value={patientSearchTerm}
                      onChange={(e) => setPatientSearchTerm(e.target.value)}
                      className="border-border bg-background pl-9 text-foreground"
                      autoComplete="off"
                    />
                    {isSearchingPatients && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Spinner className="size-4" />
                      </div>
                    )}

                    {/* Patient Search Results Popover */}
                    {patientSearchTerm.trim().length > 0 && (
                      <div className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
                        {isSearchingPatients ? (
                          <div className="flex items-center justify-center p-3 text-xs text-muted-foreground">
                            Buscando pacientes...
                          </div>
                        ) : patientSearchResults.length === 0 ? (
                          <div className="p-3 text-center text-xs text-muted-foreground">
                            Nenhum paciente encontrado para "{patientSearchTerm}
                            ".
                          </div>
                        ) : (
                          patientSearchResults.map((pt) => (
                            <button
                              key={pt.id}
                              type="button"
                              onClick={() => handleSelectPatient(pt)}
                              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                            >
                              <div>
                                <p className="font-medium text-foreground">
                                  {pt.fullName}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  CPF: {maskCpf(pt.cpf || "")}
                                  {pt.phone ? ` • Tel: ${pt.phone}` : ""}
                                </p>
                              </div>
                              <span className="text-xs font-medium text-primary">
                                Selecionar
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  /* Selected Patient Card */
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <UserIcon className="size-4" />
                      </div>
                      <div>
                        <p className="font-medium text-foreground text-sm">
                          {selectedPatient.fullName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          CPF: {maskCpf(selectedPatient.cpf || "")}
                          {selectedPatient.phone
                            ? ` • Tel: ${selectedPatient.phone}`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleClearPatient}
                      className="text-muted-foreground hover:text-foreground text-xs"
                    >
                      Trocar paciente
                    </Button>
                  </div>
                )}

                {errors.patient && (
                  <p className="text-xs font-medium text-destructive">
                    {errors.patient}
                  </p>
                )}
              </div>

              {/* Title & Template Selector */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Document Title */}
                <div className="space-y-2">
                  <Label htmlFor={titleId} className="text-foreground">
                    Título do documento{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id={titleId}
                    type="text"
                    placeholder="Ex: Receita Médica, Atestado de Comparecimento"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      if (errors.title) {
                        setErrors((prev) => ({ ...prev, title: "" }));
                      }
                    }}
                    className="border-border bg-background text-foreground"
                  />
                  {errors.title && (
                    <p className="text-xs font-medium text-destructive">
                      {errors.title}
                    </p>
                  )}
                </div>

                {/* Template Selector */}
                <div className="space-y-2">
                  <Label htmlFor={templateSelectId} className="text-foreground">
                    Modelo de documento
                  </Label>
                  <Select
                    value={selectedTemplateId || "none"}
                    onValueChange={handleSelectTemplate}
                    disabled={isLoadingTemplates}
                  >
                    <SelectTrigger
                      id={templateSelectId}
                      className="w-full border-border bg-background text-foreground"
                    >
                      <SelectValue placeholder="Selecione um modelo (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        Em branco (sem modelo)
                      </SelectItem>
                      {availableTemplates.map((tmpl) => (
                        <SelectItem key={tmpl.id} value={tmpl.id}>
                          {tmpl.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-2xs text-muted-foreground">
                    Preenche o texto e resolve variáveis como{" "}
                    {"{paciente_nome}"}, {"{data}"}.
                  </p>
                </div>
              </div>

              {/* Content Editor */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={contentId} className="text-foreground">
                    Conteúdo do documento{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsPreviewOpen(true)}
                    className="h-7 text-xs border-border"
                  >
                    <EyeIcon className="mr-1.5 size-3.5" />
                    Prévia
                  </Button>
                </div>
                <Textarea
                  id={contentId}
                  rows={8}
                  placeholder="Escreva as instruções, medicações, posologias ou laudo..."
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    if (errors.content) {
                      setErrors((prev) => ({ ...prev, content: "" }));
                    }
                  }}
                  className="min-h-[200px] border-border bg-background font-sans leading-relaxed text-foreground"
                />
                {errors.content && (
                  <p className="text-xs font-medium text-destructive">
                    {errors.content}
                  </p>
                )}
              </div>

              {/* Private Notes */}
              <div className="space-y-2">
                <Label htmlFor={notesId} className="text-foreground">
                  Observações internas (opcional)
                </Label>
                <Textarea
                  id={notesId}
                  rows={3}
                  placeholder="Anotações privadas para o prontuário. Não serão impressas no documento final."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="border-border bg-background text-xs leading-relaxed text-foreground"
                />
                <p className="text-2xs text-muted-foreground">
                  Visível apenas internamente pela equipe médica da clínica.
                </p>
              </div>

              {/* Actions Footer */}
              <div className="flex flex-col-reverse gap-3 pt-3 sm:flex-row sm:items-center sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRequestClose}
                  disabled={isSubmitting}
                  className="border-border"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsPreviewOpen(true)}
                  disabled={isSubmitting}
                >
                  <EyeIcon className="mr-2 size-4" />
                  Visualizar prévia
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Spinner className="mr-2 size-4" />
                      Salvando rascunho...
                    </>
                  ) : (
                    "Salvar rascunho"
                  )}
                </Button>
              </div>
            </form>
          )}
        </SheetContent>
      </Sheet>

      {/* Live Preview Modal */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-card p-6">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-lg font-semibold text-foreground">
                Prévia do Documento Clínico
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {typeConfig?.badgeLabel || "Documento"}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  RASCUNHO
                </Badge>
              </div>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              Esta é uma visualização preliminar de como o documento será
              registrado.
            </DialogDescription>
          </DialogHeader>

          {/* Document Sheet Paper Representation */}
          <div className="rounded-lg border border-border bg-background p-6 shadow-xs space-y-4">
            <div className="text-center space-y-1 border-b border-border pb-4">
              <h2 className="text-lg font-bold tracking-tight text-foreground">
                {title || "Documento Clínico Sem Título"}
              </h2>
              <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                <span>
                  <strong>Paciente:</strong>{" "}
                  {selectedPatient?.fullName || "(Paciente não selecionado)"}
                </span>
                <span>•</span>
                <span>
                  <strong>Data:</strong> {todayFormatted}
                </span>
              </div>
            </div>

            <div className="min-h-[140px] whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground py-2">
              {content || (
                <span className="italic text-muted-foreground">
                  (Nenhum conteúdo digitado para o documento)
                </span>
              )}
            </div>

            {notes.trim().length > 0 && (
              <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  Observações internas da clínica:
                </span>{" "}
                {notes}
              </div>
            )}
          </div>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsPreviewOpen(false)}
            >
              Fechar prévia
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard Changes Alert Dialog */}
      <AlertDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
      >
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              Descartar alterações?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Você possui alterações não salvas no documento. Se fechar agora,
              todos os dados preenchidos serão perdidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDiscard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Descartar documento
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
