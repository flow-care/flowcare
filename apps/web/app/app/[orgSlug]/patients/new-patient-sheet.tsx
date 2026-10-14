"use client";

import {
  AlertCircleIcon,
  AlertTriangleIcon,
  ExternalLinkIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatCpf, isValidCpf } from "@/lib/patient-formatters";
import { formatPhoneWithAreaCode } from "@/lib/phone";
import { checkPatientDuplicatesAction, createPatientAction } from "./actions";

interface NewPatientSheetProps {
  isOpen: boolean;
  onClose: () => void;
  orgSlug: string;
  onSuccess?: (patientId: string) => void;
}

export function NewPatientSheet({
  isOpen,
  onClose,
  orgSlug,
  onSuccess,
}: NewPatientSheetProps) {
  const router = useRouter();

  // Form Field States
  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  // Validation States
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Duplicate Check States
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    isDuplicate: boolean;
    conflictField?: string | null;
    existingPatientId?: string | null;
  } | null>(null);

  // Submission States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `pt_${Date.now()}`,
  );

  const fullNameId = useId();
  const cpfId = useId();
  const birthDateId = useId();
  const phoneId = useId();
  const emailId = useId();
  const notesId = useId();

  // Check if form has any unsaved input
  const isDirty = Boolean(
    fullName.trim() ||
      cpf.trim() ||
      birthDate.trim() ||
      phone.trim() ||
      email.trim() ||
      notes.trim(),
  );

  // Reset form when sheet opens
  useEffect(() => {
    if (isOpen) {
      setFullName("");
      setCpf("");
      setBirthDate("");
      setPhone("");
      setEmail("");
      setNotes("");
      setTouched({});
      setErrors({});
      setDuplicateWarning(null);
      setIsCheckingDuplicates(false);
      setGeneralError(null);
      setShowDiscardConfirm(false);
      setIdempotencyKey(
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `pt_${Date.now()}`,
      );
    }
  }, [isOpen]);

  // Field Validation Helper
  const validateField = (name: string, value: string): string | undefined => {
    switch (name) {
      case "fullName": {
        const trimmed = value.trim();
        if (!trimmed) return "Nome completo é obrigatório.";
        if (trimmed.length < 2) return "Nome deve ter pelo menos 2 caracteres.";
        return undefined;
      }
      case "cpf": {
        const digits = value.replace(/\D/g, "");
        if (!digits) return "CPF é obrigatório.";
        if (digits.length !== 11 || !isValidCpf(value))
          return "Informe um CPF válido.";
        return undefined;
      }
      case "birthDate": {
        if (!value.trim()) return "Data de nascimento é obrigatória.";
        const today = new Date().toISOString().slice(0, 10);
        if (value > today) return "Data de nascimento não pode ser futura.";
        if (value < "1900-01-01") return "Data de nascimento inválida.";
        return undefined;
      }
      case "phone": {
        const digits = value.replace(/\D/g, "");
        if (!digits) return "Telefone celular é obrigatório.";
        if (digits.length < 10 || digits.length > 11)
          return "Telefone deve ter 10 ou 11 dígitos com DDD.";
        return undefined;
      }
      case "email": {
        const trimmed = value.trim();
        if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
          return "Informe um e-mail válido.";
        }
        return undefined;
      }
      default:
        return undefined;
    }
  };

  const handleBlur = (field: string, value: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    const error = validateField(field, value);
    setErrors((prev) => ({ ...prev, [field]: error || "" }));
  };

  // Debounced duplicate verification on CPF or Phone
  useEffect(() => {
    const cleanCpf = cpf.replace(/\D/g, "");
    const cleanPhone = phone.replace(/\D/g, "");

    const hasValidCpf = cleanCpf.length === 11 && isValidCpf(cleanCpf);
    const hasValidPhone = cleanPhone.length >= 10 && cleanPhone.length <= 11;

    if (!hasValidCpf && !hasValidPhone) {
      setDuplicateWarning(null);
      setIsCheckingDuplicates(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingDuplicates(true);
      try {
        const res = await checkPatientDuplicatesAction(orgSlug, {
          document: hasValidCpf ? cleanCpf : undefined,
          phone: hasValidPhone ? cleanPhone : undefined,
        });

        if (res.isDuplicate) {
          setDuplicateWarning({
            isDuplicate: true,
            conflictField:
              res.conflictField ?? (hasValidCpf ? "document" : "phone"),
            existingPatientId: res.existingPatientId ?? null,
          });
        } else {
          setDuplicateWarning(null);
        }
      } catch {
        // Fallback gracefully on background check error
      } finally {
        setIsCheckingDuplicates(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [cpf, phone, orgSlug]);

  const handleAttemptClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || duplicateWarning?.isDuplicate) return;

    // Validate all required fields
    const newErrors: Record<string, string> = {};
    const nameErr = validateField("fullName", fullName);
    if (nameErr) newErrors.fullName = nameErr;

    const cpfErr = validateField("cpf", cpf);
    if (cpfErr) newErrors.cpf = cpfErr;

    const birthErr = validateField("birthDate", birthDate);
    if (birthErr) newErrors.birthDate = birthErr;

    const phoneErr = validateField("phone", phone);
    if (phoneErr) newErrors.phone = phoneErr;

    const emailErr = validateField("email", email);
    if (emailErr) newErrors.email = emailErr;

    setTouched({
      fullName: true,
      cpf: true,
      birthDate: true,
      phone: true,
      email: true,
    });
    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    setGeneralError(null);

    try {
      const res = await createPatientAction(orgSlug, {
        fullName: fullName.trim(),
        cpf: cpf.replace(/\D/g, ""),
        birthDate,
        phone: phone.replace(/\D/g, ""),
        email: email.trim() || null,
        notes: notes.trim() || null,
        idempotencyKey,
      });

      if (res.success && res.data) {
        toast.success("Paciente cadastrado com sucesso!");
        onClose();
        if (onSuccess) {
          onSuccess(res.data.id);
        } else {
          router.push(`/app/${orgSlug}/patients/${res.data.id}`);
        }
        return;
      }

      if (res.code === "POSSIBLE_DUPLICATE") {
        setDuplicateWarning({
          isDuplicate: true,
          conflictField: res.conflictField ?? "document",
          existingPatientId: res.existingPatientId ?? null,
        });
        setGeneralError(
          res.error || "Já existe um paciente cadastrado com estes dados.",
        );
        return;
      }

      setGeneralError(
        res.error || "Não foi possível cadastrar o paciente. Tente novamente.",
      );
    } catch (err) {
      setGeneralError(
        err instanceof Error
          ? err.message
          : "Erro inesperado ao cadastrar paciente.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Sheet
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleAttemptClose();
          }
        }}
      >
        <SheetContent
          side="right"
          showCloseButton={false}
          className="w-full sm:max-w-md p-6 flex flex-col gap-6 overflow-y-auto bg-card text-card-foreground border-l border-border"
          onPointerDownOutside={(e) => {
            if (isDirty) {
              e.preventDefault();
              setShowDiscardConfirm(true);
            }
          }}
          onEscapeKeyDown={(e) => {
            if (isDirty) {
              e.preventDefault();
              setShowDiscardConfirm(true);
            }
          }}
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <SheetHeader className="gap-1.5 p-0 text-left">
              <SheetTitle className="text-xl font-semibold text-foreground">
                Novo Paciente
              </SheetTitle>
              <SheetDescription className="text-sm text-muted-foreground">
                Cadastre um novo paciente para iniciar o prontuário e
                atendimentos.
              </SheetDescription>
            </SheetHeader>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleAttemptClose}
              aria-label="Fechar"
              className="text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" />
            </Button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5 flex-1">
            {/* Full Name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={fullNameId} className="text-foreground">
                Nome completo *
              </Label>
              <Input
                id={fullNameId}
                name="fullName"
                type="text"
                placeholder="Ex: Maria Oliveira Silva"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (touched.fullName) {
                    const err = validateField("fullName", e.target.value);
                    setErrors((prev) => ({ ...prev, fullName: err || "" }));
                  }
                }}
                onBlur={(e) => handleBlur("fullName", e.target.value)}
                className="border-border bg-card"
                autoComplete="name"
                required
              />
              {touched.fullName && errors.fullName && (
                <p className="text-xs text-destructive">{errors.fullName}</p>
              )}
            </div>

            {/* CPF Field */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor={cpfId} className="text-foreground">
                  CPF *
                </Label>
                {isCheckingDuplicates && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Spinner className="size-3" />
                    Verificando...
                  </span>
                )}
              </div>
              <Input
                id={cpfId}
                name="cpf"
                type="text"
                inputMode="numeric"
                placeholder="000.000.000-00"
                value={cpf}
                onChange={(e) => {
                  const masked = formatCpf(e.target.value);
                  setCpf(masked);
                  if (touched.cpf) {
                    const err = validateField("cpf", masked);
                    setErrors((prev) => ({ ...prev, cpf: err || "" }));
                  }
                }}
                onBlur={(e) => handleBlur("cpf", e.target.value)}
                className="border-border bg-card font-mono"
                maxLength={14}
                required
              />
              {touched.cpf && errors.cpf && (
                <p className="text-xs text-destructive">{errors.cpf}</p>
              )}
            </div>

            {/* Birth Date */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={birthDateId} className="text-foreground">
                Data de nascimento *
              </Label>
              <Input
                id={birthDateId}
                name="birthDate"
                type="date"
                max={todayStr}
                value={birthDate}
                onChange={(e) => {
                  setBirthDate(e.target.value);
                  if (touched.birthDate) {
                    const err = validateField("birthDate", e.target.value);
                    setErrors((prev) => ({ ...prev, birthDate: err || "" }));
                  }
                }}
                onBlur={(e) => handleBlur("birthDate", e.target.value)}
                className="border-border bg-card"
                required
              />
              {touched.birthDate && errors.birthDate && (
                <p className="text-xs text-destructive">{errors.birthDate}</p>
              )}
            </div>

            {/* Primary Phone */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={phoneId} className="text-foreground">
                Telefone celular *
              </Label>
              <Input
                id={phoneId}
                name="phone"
                type="tel"
                inputMode="tel"
                placeholder="(00) 00000-0000"
                value={phone}
                onChange={(e) => {
                  const formatted = formatPhoneWithAreaCode(e.target.value);
                  setPhone(formatted);
                  if (touched.phone) {
                    const err = validateField("phone", formatted);
                    setErrors((prev) => ({ ...prev, phone: err || "" }));
                  }
                }}
                onBlur={(e) => handleBlur("phone", e.target.value)}
                className="border-border bg-card"
                maxLength={15}
                required
              />
              {touched.phone && errors.phone && (
                <p className="text-xs text-destructive">{errors.phone}</p>
              )}
            </div>

            {/* Email (Optional) */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={emailId} className="text-foreground">
                E-mail{" "}
                <span className="text-muted-foreground font-normal">
                  (opcional)
                </span>
              </Label>
              <Input
                id={emailId}
                name="email"
                type="email"
                placeholder="paciente@exemplo.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (touched.email) {
                    const err = validateField("email", e.target.value);
                    setErrors((prev) => ({ ...prev, email: err || "" }));
                  }
                }}
                onBlur={(e) => handleBlur("email", e.target.value)}
                className="border-border bg-card"
                autoComplete="email"
              />
              {touched.email && errors.email && (
                <p className="text-xs text-destructive">{errors.email}</p>
              )}
            </div>

            {/* Notes (Optional) */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={notesId} className="text-foreground">
                Observações{" "}
                <span className="text-muted-foreground font-normal">
                  (opcional)
                </span>
              </Label>
              <Textarea
                id={notesId}
                name="notes"
                placeholder="Observações adicionais ou notas de recepção..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                maxLength={2000}
                className="border-border bg-card"
              />
            </div>

            {/* Duplicate Warning Banner */}
            {duplicateWarning?.isDuplicate && (
              <div
                role="alert"
                className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm flex items-start gap-2.5"
              >
                <AlertTriangleIcon className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-xs text-amber-700 dark:text-amber-300">
                    Possível paciente duplicado
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {duplicateWarning.conflictField === "phone"
                      ? "Já existe um paciente cadastrado com este telefone celular nesta clínica."
                      : "Já existe um paciente cadastrado com este CPF nesta clínica."}
                  </p>
                  {duplicateWarning.existingPatientId && (
                    <Link
                      href={`/app/${encodeURIComponent(orgSlug)}/patients/${duplicateWarning.existingPatientId}`}
                      className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1 mt-0.5 w-fit"
                      target="_blank"
                    >
                      <span>Ver paciente existente</span>
                      <ExternalLinkIcon className="size-3" />
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* General Submission Error */}
            {generalError && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2.5"
              >
                <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
                <span className="text-xs">{generalError}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border mt-auto">
              <Button
                type="button"
                variant="outline"
                onClick={handleAttemptClose}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  isSubmitting ||
                  Boolean(duplicateWarning?.isDuplicate) ||
                  !fullName.trim() ||
                  !cpf.trim() ||
                  !birthDate.trim() ||
                  !phone.trim()
                }
              >
                {isSubmitting ? (
                  <>
                    <Spinner className="mr-2 size-4" />
                    Cadastrando...
                  </>
                ) : (
                  "Cadastrar paciente"
                )}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* Discard Confirmation Dialog */}
      <AlertDialog
        open={showDiscardConfirm}
        onOpenChange={setShowDiscardConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar alterações?</AlertDialogTitle>
            <AlertDialogDescription>
              As informações preenchidas no cadastro do paciente serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDiscardConfirm(false)}>
              Continuar editando
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setShowDiscardConfirm(false);
                onClose();
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
