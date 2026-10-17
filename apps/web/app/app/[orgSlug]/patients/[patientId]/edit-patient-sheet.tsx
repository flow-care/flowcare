"use client";

import {
  AlertCircleIcon,
  CheckIcon,
  LockIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
import { formatCpf } from "@/lib/patient-formatters";
import { formatPhoneWithAreaCode } from "@/lib/phone";
import { formatPostalCode, postalCodeDigits } from "@/lib/postal-code";
import type {
  PatientOverviewData,
  UpdatePatientResponse,
} from "@/server/patients";
import { getPatientOverviewAction, updatePatientAction } from "../actions";

const GENDER_OPTIONS = [
  "Masculino",
  "Feminino",
  "Outro",
  "Não informado",
] as const;

interface FormSnapshot {
  fullName: string;
  phone: string;
  email: string;
  birthDate: string;
  gender: string;
  postalCode: string;
  street: string;
  city: string;
  state: string;
  healthInsurance: string;
  insuranceNumber: string;
  insuranceExpiration: string;
  version: number;
}

export interface EditPatientSheetProps {
  isOpen: boolean;
  onClose: () => void;
  orgSlug: string;
  patientId: string;
  overview: PatientOverviewData;
  onSuccess?: (updatedPatient: UpdatePatientResponse["patient"]) => void;
}

export function EditPatientSheet({
  isOpen,
  onClose,
  orgSlug,
  patientId,
  overview,
  onSuccess,
}: EditPatientSheetProps) {
  const router = useRouter();

  // Form Field States
  const [fullName, setFullName] = useState("");
  const [cpf, setCpf] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [gender, setGender] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [healthInsurance, setHealthInsurance] = useState("");
  const [insuranceNumber, setInsuranceNumber] = useState("");
  const [insuranceExpiration, setInsuranceExpiration] = useState("");
  const [version, setVersion] = useState(0);

  // Snapshot for dirty checking
  const initialSnapshotRef = useRef<FormSnapshot | null>(null);
  const lastLookedUpCepRef = useRef<string | null>(null);

  // Validation States
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // CEP lookup state
  const [isLookingUpCep, setIsLookingUpCep] = useState(false);

  // Submission & Conflict States
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isVersionConflict, setIsVersionConflict] = useState(false);
  const [versionConflictMessage, setVersionConflictMessage] = useState<
    string | null
  >(null);
  const [isReloading, setIsReloading] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Accessibility IDs
  const fullNameId = useId();
  const cpfId = useId();
  const birthDateId = useId();
  const phoneId = useId();
  const emailId = useId();
  const genderId = useId();
  const postalCodeId = useId();
  const streetId = useId();
  const cityId = useId();
  const stateId = useId();
  const healthInsuranceId = useId();
  const insuranceNumberId = useId();
  const insuranceExpirationId = useId();

  // Populate form from overview data
  const populateFromOverview = useCallback((data: PatientOverviewData) => {
    const rawBirthDate = data.patient.birthDate
      ? data.patient.birthDate.slice(0, 10)
      : "";
    const rawPhone = data.patient.phone || data.contact?.phone || "";
    const rawEmail = data.patient.email || data.contact?.email || "";
    const rawGender = data.patient.gender || "Não informado";
    const rawAddress = data.address || data.patient.address;
    const rawPostalCode = rawAddress?.postalCode
      ? formatPostalCode(rawAddress.postalCode)
      : "";
    const rawStreet = rawAddress?.street || "";
    const rawCity = rawAddress?.city || "";
    const rawState = rawAddress?.state || "";
    const rawPlan =
      data.activeInsurance?.name ||
      data.healthInsurance ||
      data.patient.healthInsurance ||
      "";
    const rawPlanNumber =
      data.activeInsurance?.number ||
      data.insuranceNumber ||
      data.patient.insuranceNumber ||
      "";
    const rawPlanExpiration =
      data.activeInsurance?.expiration ||
      data.patient.insuranceExpiration ||
      "";
    const rawVersion = data.patient.version ?? 0;

    setFullName(data.patient.fullName || "");
    setCpf(data.patient.cpf || "");
    setBirthDate(rawBirthDate);
    setPhone(formatPhoneWithAreaCode(rawPhone));
    setEmail(rawEmail);
    setGender(rawGender);
    setPostalCode(rawPostalCode);
    setStreet(rawStreet);
    setCity(rawCity);
    setState(rawState);
    setHealthInsurance(rawPlan);
    setInsuranceNumber(rawPlanNumber);
    setInsuranceExpiration(rawPlanExpiration);
    setVersion(rawVersion);

    initialSnapshotRef.current = {
      fullName: (data.patient.fullName || "").trim(),
      phone: rawPhone.replace(/\D/g, ""),
      email: rawEmail.trim(),
      birthDate: rawBirthDate,
      gender: rawGender,
      postalCode: postalCodeDigits(rawPostalCode),
      street: rawStreet.trim(),
      city: rawCity.trim(),
      state: rawState.trim(),
      healthInsurance: rawPlan.trim(),
      insuranceNumber: rawPlanNumber.trim(),
      insuranceExpiration: rawPlanExpiration,
      version: rawVersion,
    };

    lastLookedUpCepRef.current = postalCodeDigits(rawPostalCode) || null;
    setTouched({});
    setErrors({});
    setGeneralError(null);
    setIsVersionConflict(false);
    setVersionConflictMessage(null);
    setShowDiscardConfirm(false);
  }, []);

  // Pre-load current patient data on sheet open or overview change
  useEffect(() => {
    if (isOpen) {
      populateFromOverview(overview);
    }
  }, [isOpen, overview, populateFromOverview]);

  // Dirty check: has any field changed compared to snapshot?
  const isDirty = Boolean(
    initialSnapshotRef.current &&
      (fullName.trim() !== initialSnapshotRef.current.fullName ||
        phone.replace(/\D/g, "") !== initialSnapshotRef.current.phone ||
        email.trim() !== initialSnapshotRef.current.email ||
        birthDate !== initialSnapshotRef.current.birthDate ||
        gender !== initialSnapshotRef.current.gender ||
        postalCodeDigits(postalCode) !==
          initialSnapshotRef.current.postalCode ||
        street.trim() !== initialSnapshotRef.current.street ||
        city.trim() !== initialSnapshotRef.current.city ||
        state.trim() !== initialSnapshotRef.current.state ||
        healthInsurance.trim() !== initialSnapshotRef.current.healthInsurance ||
        insuranceNumber.trim() !== initialSnapshotRef.current.insuranceNumber ||
        insuranceExpiration !== initialSnapshotRef.current.insuranceExpiration),
  );

  // Field Validation Helper
  const validateField = (name: string, value: string): string | undefined => {
    switch (name) {
      case "fullName": {
        const trimmed = value.trim();
        if (!trimmed) return "Nome completo é obrigatório.";
        if (trimmed.length < 2) return "Nome deve ter pelo menos 2 caracteres.";
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
          return "Telefone deve conter DDD e 8 ou 9 dígitos.";
        return undefined;
      }
      case "email": {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(trimmed)) return "Informe um e-mail válido.";
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

  // Auto CEP lookup via ViaCEP (/api/postal-code/:cep)
  const handleCepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const formatted = formatPostalCode(raw);
    setPostalCode(formatted);

    const digits = postalCodeDigits(formatted);
    if (digits.length === 8 && digits !== lastLookedUpCepRef.current) {
      lastLookedUpCepRef.current = digits;
      setIsLookingUpCep(true);
      fetch(`/api/postal-code/${digits}`)
        .then(async (res) => {
          if (!res.ok) {
            toast.error(
              "CEP não encontrado. Confira o número ou preencha o endereço manualmente.",
            );
            return;
          }
          const data = await res.json();
          if (data && typeof data === "object") {
            if (data.street) setStreet(data.street);
            if (data.city) setCity(data.city);
            if (data.state) setState(data.state);
            toast.success("Endereço preenchido automaticamente pelo CEP.");
          }
        })
        .catch(() => {
          toast.error(
            "Não foi possível consultar o CEP. Preencha o endereço manualmente.",
          );
        })
        .finally(() => {
          setIsLookingUpCep(false);
        });
    }
  };

  // Close request interceptor (dirty form guard)
  const handleRequestClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  // Concurrency conflict: reload latest patient data
  const handleReloadLatest = async () => {
    setIsReloading(true);
    try {
      const result = await getPatientOverviewAction(orgSlug, patientId);
      if (result.success && result.data) {
        populateFromOverview(result.data);
        toast.info("Dados mais recentes do paciente recarregados.");
        router.refresh();
      } else {
        toast.error(
          result.error || "Não foi possível recarregar os dados do paciente.",
        );
      }
    } catch {
      toast.error("Não foi possível recarregar os dados do paciente.");
    } finally {
      setIsReloading(false);
    }
  };

  // Handle Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Validate all fields
    const fullNameErr = validateField("fullName", fullName);
    const phoneErr = validateField("phone", phone);
    const birthDateErr = validateField("birthDate", birthDate);
    const emailErr = validateField("email", email);

    const newErrors: Record<string, string> = {};
    if (fullNameErr) newErrors.fullName = fullNameErr;
    if (phoneErr) newErrors.phone = phoneErr;
    if (birthDateErr) newErrors.birthDate = birthDateErr;
    if (emailErr) newErrors.email = emailErr;

    setTouched({
      fullName: true,
      phone: true,
      birthDate: true,
      email: true,
    });
    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      toast.error("Por favor, corrija os erros no formulário antes de salvar.");
      return;
    }

    setIsSubmitting(true);
    setGeneralError(null);
    setIsVersionConflict(false);
    setVersionConflictMessage(null);

    const payload = {
      fullName: fullName.trim(),
      phone: phone.replace(/\D/g, "") || phone,
      birthDate,
      email: email.trim() ? email.trim() : null,
      gender: gender && gender !== "Não informado" ? gender : null,
      address: {
        postalCode: postalCodeDigits(postalCode) || null,
        street: street.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
      },
      healthInsurance: healthInsurance.trim() || null,
      insuranceNumber: insuranceNumber.trim() || null,
      insuranceExpiration: insuranceExpiration || null,
      version,
    };

    try {
      const result = await updatePatientAction(orgSlug, patientId, payload);

      if (!result.success) {
        if (result.code === "VERSION_CONFLICT") {
          setIsVersionConflict(true);
          setVersionConflictMessage(
            result.error ||
              "Este paciente foi atualizado por outro usuário. Recarregue para ver os dados mais recentes.",
          );
          toast.error("Conflito de concorrência detectado.");
          return;
        }

        setGeneralError(
          result.error || "Não foi possível atualizar os dados do paciente.",
        );
        toast.error(
          result.error || "Não foi possível atualizar os dados do paciente.",
        );
        return;
      }

      toast.success("Dados cadastrais do paciente atualizados com sucesso.");
      router.refresh();
      if (onSuccess && result.data) {
        onSuccess(result.data);
      }
      onClose();
    } catch {
      setGeneralError("Erro inesperado ao salvar os dados.");
      toast.error("Erro inesperado ao salvar os dados.");
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
          className="w-full sm:max-w-md p-6 flex flex-col gap-6 overflow-y-auto"
          onEscapeKeyDown={(e) => {
            if (isDirty) {
              e.preventDefault();
              setShowDiscardConfirm(true);
            }
          }}
          onPointerDownOutside={(e) => {
            if (isDirty) {
              e.preventDefault();
              setShowDiscardConfirm(true);
            }
          }}
        >
          <SheetHeader className="gap-1.5 text-left">
            <SheetTitle className="text-xl font-semibold text-foreground">
              Editar Dados Cadastrais
            </SheetTitle>
            <SheetDescription className="text-sm text-muted-foreground">
              Atualize as informações de identificação, contato e convênio do
              paciente.
            </SheetDescription>
          </SheetHeader>

          {/* Concurrency Conflict Warning Banner (409 VERSION_CONFLICT) */}
          {isVersionConflict && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-destructive flex flex-col gap-2.5 shadow-xs"
            >
              <div className="flex items-start gap-2">
                <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-xs uppercase tracking-wide">
                    Conflito de Concorrência
                  </span>
                  <span className="text-xs leading-relaxed">
                    {versionConflictMessage ||
                      "Este paciente foi atualizado por outro usuário. Recarregue para ver os dados mais recentes."}
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleReloadLatest}
                disabled={isReloading}
                className="self-start text-xs h-7 border-destructive/40 text-destructive hover:bg-destructive/15 cursor-pointer"
              >
                {isReloading ? (
                  <>
                    <Spinner className="size-3 mr-1.5" />
                    Recarregando...
                  </>
                ) : (
                  <>
                    <RefreshCwIcon className="size-3 mr-1.5" />
                    Recarregar dados mais recentes
                  </>
                )}
              </Button>
            </div>
          )}

          {/* General Error Banner */}
          {generalError && !isVersionConflict && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 p-3.5 text-xs text-destructive flex items-center gap-2"
            >
              <AlertCircleIcon className="size-4 shrink-0" />
              <span>{generalError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-5 flex-1">
            {/* Section: Identificação */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Identificação
              </h3>

              {/* Full Name */}
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={fullNameId}
                  className="text-foreground text-sm font-medium"
                >
                  Nome completo *
                </Label>
                <Input
                  id={fullNameId}
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (errors.fullName) {
                      setErrors((prev) => ({ ...prev, fullName: "" }));
                    }
                  }}
                  onBlur={() => handleBlur("fullName", fullName)}
                  placeholder="Nome completo do paciente"
                  disabled={isSubmitting}
                  aria-invalid={Boolean(touched.fullName && errors.fullName)}
                  aria-describedby={
                    touched.fullName && errors.fullName
                      ? `${fullNameId}-error`
                      : undefined
                  }
                />
                {touched.fullName && errors.fullName && (
                  <p
                    id={`${fullNameId}-error`}
                    className="text-xs text-destructive"
                  >
                    {errors.fullName}
                  </p>
                )}
              </div>

              {/* CPF (Locked & Read-only) */}
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={cpfId}
                  className="text-foreground text-sm font-medium flex items-center gap-1.5"
                >
                  <LockIcon className="size-3.5 text-muted-foreground" />
                  CPF (Identificador Primário)
                </Label>
                <div className="relative">
                  <Input
                    id={cpfId}
                    value={formatCpf(cpf)}
                    readOnly
                    disabled
                    className="bg-muted/50 text-muted-foreground font-mono cursor-not-allowed border-dashed"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    <LockIcon className="size-4" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  O CPF é a chave primária de identificação do paciente e não
                  pode ser alterado diretamente.
                </p>
              </div>

              {/* Birth date & Gender row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Birth Date */}
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={birthDateId}
                    className="text-foreground text-sm font-medium"
                  >
                    Data de nascimento *
                  </Label>
                  <Input
                    id={birthDateId}
                    type="date"
                    value={birthDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => {
                      setBirthDate(e.target.value);
                      if (errors.birthDate) {
                        setErrors((prev) => ({ ...prev, birthDate: "" }));
                      }
                    }}
                    onBlur={() => handleBlur("birthDate", birthDate)}
                    disabled={isSubmitting}
                    aria-invalid={Boolean(
                      touched.birthDate && errors.birthDate,
                    )}
                    aria-describedby={
                      touched.birthDate && errors.birthDate
                        ? `${birthDateId}-error`
                        : undefined
                    }
                  />
                  {touched.birthDate && errors.birthDate && (
                    <p
                      id={`${birthDateId}-error`}
                      className="text-xs text-destructive"
                    >
                      {errors.birthDate}
                    </p>
                  )}
                </div>

                {/* Gender Select */}
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={genderId}
                    className="text-foreground text-sm font-medium"
                  >
                    Gênero
                  </Label>
                  <Select
                    value={gender || "Não informado"}
                    onValueChange={(val) => setGender(val)}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id={genderId} className="w-full">
                      <SelectValue placeholder="Selecione o gênero" />
                    </SelectTrigger>
                    <SelectContent>
                      {GENDER_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Section: Contato */}
            <div className="space-y-4 pt-2 border-t border-border">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Contato
              </h3>

              {/* Phone */}
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={phoneId}
                  className="text-foreground text-sm font-medium"
                >
                  Telefone celular *
                </Label>
                <Input
                  id={phoneId}
                  value={phone}
                  onChange={(e) => {
                    const formatted = formatPhoneWithAreaCode(e.target.value);
                    setPhone(formatted);
                    if (errors.phone) {
                      setErrors((prev) => ({ ...prev, phone: "" }));
                    }
                  }}
                  onBlur={() => handleBlur("phone", phone)}
                  placeholder="(00) 00000-0000"
                  disabled={isSubmitting}
                  aria-invalid={Boolean(touched.phone && errors.phone)}
                  aria-describedby={
                    touched.phone && errors.phone
                      ? `${phoneId}-error`
                      : undefined
                  }
                />
                {touched.phone && errors.phone && (
                  <p
                    id={`${phoneId}-error`}
                    className="text-xs text-destructive"
                  >
                    {errors.phone}
                  </p>
                )}
              </div>

              {/* Email */}
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={emailId}
                  className="text-foreground text-sm font-medium"
                >
                  E-mail
                </Label>
                <Input
                  id={emailId}
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) {
                      setErrors((prev) => ({ ...prev, email: "" }));
                    }
                  }}
                  onBlur={() => handleBlur("email", email)}
                  placeholder="exemplo@email.com"
                  disabled={isSubmitting}
                  aria-invalid={Boolean(touched.email && errors.email)}
                  aria-describedby={
                    touched.email && errors.email
                      ? `${emailId}-error`
                      : undefined
                  }
                />
                {touched.email && errors.email && (
                  <p
                    id={`${emailId}-error`}
                    className="text-xs text-destructive"
                  >
                    {errors.email}
                  </p>
                )}
              </div>
            </div>

            {/* Section: Endereço */}
            <div className="space-y-4 pt-2 border-t border-border">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Endereço
                </h3>
                {isLookingUpCep && (
                  <div className="flex items-center gap-1.5 text-xs text-primary font-medium">
                    <Spinner className="size-3" />
                    <span>Buscando CEP...</span>
                  </div>
                )}
              </div>

              {/* CEP */}
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={postalCodeId}
                  className="text-foreground text-sm font-medium"
                >
                  CEP
                </Label>
                <Input
                  id={postalCodeId}
                  value={postalCode}
                  onChange={handleCepChange}
                  placeholder="00000-000"
                  maxLength={9}
                  disabled={isSubmitting}
                />
              </div>

              {/* Street */}
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={streetId}
                  className="text-foreground text-sm font-medium"
                >
                  Logradouro (Rua/Avenida)
                </Label>
                <Input
                  id={streetId}
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Nome da rua, número, complemento"
                  disabled={isSubmitting}
                />
              </div>

              {/* City & State row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label
                    htmlFor={cityId}
                    className="text-foreground text-sm font-medium"
                  >
                    Cidade
                  </Label>
                  <Input
                    id={cityId}
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="Cidade"
                    disabled={isSubmitting}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={stateId}
                    className="text-foreground text-sm font-medium"
                  >
                    Estado (UF)
                  </Label>
                  <Input
                    id={stateId}
                    value={state}
                    onChange={(e) => setState(e.target.value.toUpperCase())}
                    placeholder="UF"
                    maxLength={2}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </div>

            {/* Section: Convênio e Saúde */}
            <div className="space-y-4 pt-2 border-t border-border">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Convênio
              </h3>

              {/* Health Insurance Plan Name */}
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor={healthInsuranceId}
                  className="text-foreground text-sm font-medium"
                >
                  Plano de saúde / Convênio
                </Label>
                <Input
                  id={healthInsuranceId}
                  value={healthInsurance}
                  onChange={(e) => setHealthInsurance(e.target.value)}
                  placeholder="Ex: Unimed, Bradesco Saúde, Particular"
                  disabled={isSubmitting}
                />
              </div>

              {/* Card Number & Expiration row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={insuranceNumberId}
                    className="text-foreground text-sm font-medium"
                  >
                    Número da carteirinha
                  </Label>
                  <Input
                    id={insuranceNumberId}
                    value={insuranceNumber}
                    onChange={(e) => setInsuranceNumber(e.target.value)}
                    placeholder="Número da carteirinha"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={insuranceExpirationId}
                    className="text-foreground text-sm font-medium"
                  >
                    Validade do convênio
                  </Label>
                  <Input
                    id={insuranceExpirationId}
                    type="date"
                    value={insuranceExpiration}
                    onChange={(e) => setInsuranceExpiration(e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            </div>

            {/* Form Action Buttons */}
            <div className="mt-auto pt-6 border-t border-border flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleRequestClose}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="min-w-32"
              >
                {isSubmitting ? (
                  <>
                    <Spinner className="mr-2 size-4" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <CheckIcon className="mr-2 size-4" />
                    Salvar alterações
                  </>
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
              Você tem modificações não salvas nos dados deste paciente. Se
              fechar agora, todas as alterações serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              type="button"
              onClick={() => setShowDiscardConfirm(false)}
            >
              Continuar editando
            </AlertDialogCancel>
            <AlertDialogAction
              type="button"
              variant="destructive"
              onClick={() => {
                setShowDiscardConfirm(false);
                onClose();
              }}
            >
              Descartar alterações
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
