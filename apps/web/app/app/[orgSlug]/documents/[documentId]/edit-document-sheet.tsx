"use client";

import { AlertCircleIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
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
import { formatDocumentType } from "@/lib/documents";
import type { DocumentDetail, DocumentTemplateItem } from "@/server/documents";
import { getDocumentTemplatesAction, updateDocumentAction } from "../actions";

interface EditDocumentSheetProps {
  isOpen: boolean;
  onClose: () => void;
  orgSlug: string;
  document: DocumentDetail;
  onSuccess?: () => void;
}

export function EditDocumentSheet({
  isOpen,
  onClose,
  orgSlug,
  document,
  onSuccess,
}: EditDocumentSheetProps) {
  const [title, setTitle] = useState(document.title);
  const [content, setContent] = useState(document.content);
  const [notes, setNotes] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    document.templateId ?? null,
  );
  const [availableTemplates, setAvailableTemplates] = useState<
    DocumentTemplateItem[]
  >([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const titleId = useId();
  const contentId = useId();
  const notesId = useId();
  const templateSelectId = useId();

  // Reset form when document changes or sheet opens
  useEffect(() => {
    if (isOpen) {
      setTitle(document.title);
      setContent(document.content);
      setSelectedTemplateId(document.templateId ?? null);
      setErrors({});
      setGeneralError(null);
      setIsSubmitting(false);
      setShowDiscardConfirm(false);
    }
  }, [isOpen, document]);

  // Load templates of document type
  useEffect(() => {
    if (!isOpen) return;

    let isCancelled = false;
    setIsLoadingTemplates(true);

    getDocumentTemplatesAction(orgSlug, document.type)
      .then((res) => {
        if (!isCancelled && res.success) {
          setAvailableTemplates(res.data);
        }
      })
      .catch(() => {
        if (!isCancelled) setAvailableTemplates([]);
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingTemplates(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, orgSlug, document.type]);

  const isDirty = useMemo(() => {
    return (
      title.trim() !== document.title.trim() ||
      content.trim() !== document.content.trim() ||
      notes.trim().length > 0 ||
      selectedTemplateId !== (document.templateId ?? null)
    );
  }, [title, content, notes, selectedTemplateId, document]);

  const handleRequestClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    setShowDiscardConfirm(false);
    setTitle(document.title);
    setContent(document.content);
    onClose();
  };

  const handleSelectTemplate = (templateId: string) => {
    if (templateId === "none") {
      setSelectedTemplateId(null);
      return;
    }
    const tmpl = availableTemplates.find((t) => t.id === templateId);
    if (!tmpl) return;

    setSelectedTemplateId(tmpl.id);
    if (tmpl.bodyTemplate) {
      setContent(tmpl.bodyTemplate);
      setErrors((prev) => ({ ...prev, content: "" }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const newErrors: Record<string, string> = {};
    if (!title.trim()) {
      newErrors.title = "Título do documento é obrigatório.";
    }
    if (!content.trim()) {
      newErrors.content = "Conteúdo do documento é obrigatório.";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsSubmitting(true);
    setGeneralError(null);

    try {
      const result = await updateDocumentAction(orgSlug, document.id, {
        version: document.version,
        title: title.trim(),
        content: content.trim(),
        notes: notes.trim() || undefined,
        templateId: selectedTemplateId || undefined,
      });

      if (!result.success) {
        setGeneralError(result.error || "Não foi possível salvar alterações.");
        toast.error(result.error || "Não foi possível salvar alterações.");
        return;
      }

      toast.success("Rascunho atualizado com sucesso!");
      onClose();
      if (onSuccess) {
        onSuccess();
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "Erro inesperado ao salvar alterações.";
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
          <SheetHeader className="mb-6 space-y-1">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-xl font-semibold tracking-tight text-foreground">
                Editar Rascunho
              </SheetTitle>
              <Badge variant="outline" className="border-border font-medium">
                {formatDocumentType(document.type)}
              </Badge>
            </div>
            <SheetDescription className="text-sm text-muted-foreground">
              Altere o conteúdo e metadados do documento antes de emitir a
              versão final oficial.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="space-y-6">
            {generalError && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircleIcon className="size-4 shrink-0" />
                <span>{generalError}</span>
              </div>
            )}

            {/* Patient Read-only card */}
            <div className="rounded-lg border border-border bg-background p-3">
              <span className="text-xs text-muted-foreground block">
                Paciente vinculado
              </span>
              <p className="text-sm font-medium text-foreground">
                {document.patient.fullName}
              </p>
            </div>

            {/* Title & Template Selector */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={titleId} className="text-foreground">
                  Título do documento{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id={titleId}
                  type="text"
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
                    <SelectItem value="none">Manter texto atual</SelectItem>
                    {availableTemplates.map((tmpl) => (
                      <SelectItem key={tmpl.id} value={tmpl.id}>
                        {tmpl.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Content Editor */}
            <div className="space-y-2">
              <Label htmlFor={contentId} className="text-foreground">
                Conteúdo do documento{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id={contentId}
                rows={10}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  if (errors.content) {
                    setErrors((prev) => ({ ...prev, content: "" }));
                  }
                }}
                className="min-h-[220px] border-border bg-background font-sans leading-relaxed text-foreground"
              />
              {errors.content && (
                <p className="text-xs font-medium text-destructive">
                  {errors.content}
                </p>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor={notesId} className="text-foreground">
                Observações internas (opcional)
              </Label>
              <Textarea
                id={notesId}
                rows={3}
                placeholder="Anotações privadas para o prontuário..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="border-border bg-background text-xs leading-relaxed text-foreground"
              />
            </div>

            {/* Footer */}
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
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Spinner className="mr-2 size-4" />
                    Salvando alterações...
                  </>
                ) : (
                  "Salvar alterações"
                )}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* Discard confirmation dialog */}
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
              Você tem modificações não salvas neste rascunho. Se fechar agora,
              as alterações serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border">
              Continuar editando
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDiscard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
