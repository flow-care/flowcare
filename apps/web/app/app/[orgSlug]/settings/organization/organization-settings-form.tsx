"use client";

import {
  AlertCircle,
  Building2,
  FileSignature,
  ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCnpj, validCnpj } from "@/lib/clinic-details";
import {
  type OrganizationSettings,
  validateLogoFile,
} from "@/lib/organization-settings";
import { formatPhoneWithAreaCode } from "@/lib/phone";
import { formatPostalCode, postalCodeDigits } from "@/lib/postal-code";
import {
  updateOrganizationSettingsAction,
  uploadOrganizationLogoAction,
} from "./actions";

interface OrganizationSettingsFormProps {
  orgSlug: string;
  initialSettings: OrganizationSettings;
}

export function OrganizationSettingsForm({
  orgSlug,
  initialSettings,
}: OrganizationSettingsFormProps) {
  const router = useRouter();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [version, setVersion] = useState(initialSettings.version);
  const [name, setName] = useState(initialSettings.name);
  const [legalName, setLegalName] = useState(initialSettings.legalName || "");
  const [taxId, setTaxId] = useState(formatCnpj(initialSettings.taxId || ""));
  const [contactPhone, setContactPhone] = useState(
    formatPhoneWithAreaCode(initialSettings.contactPhone || ""),
  );
  const [contactEmail, setContactEmail] = useState(
    initialSettings.contactEmail || "",
  );

  // Address state
  const [postalCode, setPostalCode] = useState(
    formatPostalCode(initialSettings.postalCode || ""),
  );
  const [street, setStreet] = useState(initialSettings.street || "");
  const [streetNumber, setStreetNumber] = useState(
    initialSettings.streetNumber || "",
  );
  const [addressComplement, setAddressComplement] = useState(
    initialSettings.addressComplement || "",
  );
  const [district, setDistrict] = useState(initialSettings.district || "");
  const [city, setCity] = useState(initialSettings.city || "");
  const [state, setState] = useState(initialSettings.state || "");

  // Operational states
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isSearchingCep, setIsSearchingCep] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Logo state & live preview
  const [currentLogoUrl, setCurrentLogoUrl] = useState<string | null>(
    initialSettings.logoUrl || null,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);

  // Mockup document type preview: "prescription" | "certificate"
  const [previewDocType, setPreviewDocType] = useState<
    "prescription" | "certificate"
  >("prescription");

  const [, startTransition] = useTransition();

  // Create & clean object URL for local preview
  useEffect(() => {
    if (!selectedFile) {
      setLocalPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setLocalPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedFile]);

  // Auto-lookup CEP via ViaCEP
  async function handleCepLookup(digits: string) {
    if (digits.length !== 8) return;
    setIsSearchingCep(true);
    try {
      const response = await fetch(`/api/postal-code/${digits}`);
      if (!response.ok) {
        if (response.status === 404) {
          toast.error("CEP não encontrado. Preencha o endereço manualmente.");
        } else {
          toast.error(
            "Não foi possível consultar o CEP. Preencha o endereço manualmente.",
          );
        }
        return;
      }
      const data = await response.json();
      if (data) {
        if (data.street) setStreet(data.street);
        if (data.district) setDistrict(data.district);
        if (data.city) setCity(data.city);
        if (data.state) setState(data.state);
        toast.success("Endereço preenchido automaticamente pelo CEP.");
      }
    } catch {
      toast.error(
        "Não foi possível consultar o CEP. Preencha o endereço manualmente.",
      );
    } finally {
      setIsSearchingCep(false);
    }
  }

  function onPostalCodeChange(raw: string) {
    const formatted = formatPostalCode(raw);
    setPostalCode(formatted);
    const digits = postalCodeDigits(raw);
    if (digits.length === 8) {
      handleCepLookup(digits);
    }
  }

  // Logo selection & validation
  function handleFileSelected(file: File) {
    const validation = validateLogoFile(file);
    if (!validation.valid) {
      toast.error(validation.error || "Arquivo de logotipo inválido.");
      return;
    }
    setSelectedFile(file);
    toast.info(
      "Logotipo selecionado. Clique em 'Salvar logotipo' para enviar.",
    );
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  }

  // Upload Logo
  async function handleUploadLogo() {
    if (!selectedFile || isUploadingLogo) return;

    setIsUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await uploadOrganizationLogoAction(orgSlug, formData);
      if (!res.success) {
        toast.error(res.error || "Falha ao enviar logotipo.");
        return;
      }

      toast.success("Logotipo da clínica atualizado com sucesso!");
      if (res.data?.logoUrl) {
        setCurrentLogoUrl(res.data.logoUrl);
      }
      setSelectedFile(null);
      setLocalPreviewUrl(null);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      toast.error("Erro inesperado ao enviar o logotipo.");
    } finally {
      setIsUploadingLogo(false);
    }
  }

  // Submit main institutional & address form
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving) return;

    if (!name.trim()) {
      toast.error("O nome fantasia da clínica é obrigatório.");
      return;
    }

    if (taxId.trim() && !validCnpj(taxId)) {
      toast.error("Informe um CNPJ válido.");
      return;
    }

    setIsSaving(true);
    setConflictError(null);

    try {
      const res = await updateOrganizationSettingsAction(orgSlug, {
        version,
        name: name.trim(),
        legalName: legalName.trim(),
        taxId: taxId.trim(),
        contactPhone: contactPhone.trim(),
        contactEmail: contactEmail.trim(),
        postalCode: postalCode.trim(),
        street: street.trim(),
        streetNumber: streetNumber.trim(),
        addressComplement: addressComplement.trim(),
        district: district.trim(),
        city: city.trim(),
        state: state.trim().toUpperCase(),
      });

      if (!res.success) {
        if (res.code === "CONFLICT") {
          setConflictError(
            "Os dados cadastrais foram modificados em outra sessão. Recarregue a página para obter a versão mais recente.",
          );
        }
        toast.error(
          res.error || "Não foi possível salvar os dados da clínica.",
        );
        return;
      }

      const updated = res.data as OrganizationSettings | undefined;
      if (updated?.version !== undefined) {
        setVersion(updated.version);
      }

      toast.success("Dados da clínica atualizados com sucesso!");
      startTransition(() => {
        router.refresh();
      });
    } catch {
      toast.error("Erro inesperado ao salvar configurações.");
    } finally {
      setIsSaving(false);
    }
  }

  // Active logo to render in preview
  const displayLogo = localPreviewUrl || currentLogoUrl;

  return (
    <div className="space-y-8">
      {/* Concurrency Conflict Banner */}
      {conflictError && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="size-5 shrink-0" />
            <p className="text-sm font-medium">{conflictError}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            className="border-destructive/30 text-destructive hover:bg-destructive/20"
          >
            <RefreshCw className="mr-2 size-4" />
            Recarregar página
          </Button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Left Column: Form Fields */}
          <div className="space-y-6 lg:col-span-7">
            {/* Card 1: Informações Institucionais */}
            <Card className="border-border bg-card">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Building2 className="size-5 text-primary" />
                  <CardTitle className="text-lg font-semibold text-card-foreground">
                    Dados Institucionais
                  </CardTitle>
                </div>
                <CardDescription className="text-muted-foreground">
                  Identificação oficial da clínica para contratos, pacientes e
                  documentos legais.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="clinic-name" className="text-sm font-medium">
                    Nome fantasia <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="clinic-name"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Clínica Bem Estar"
                    disabled={isSaving}
                    className="bg-background text-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    Nome exibido nos menus, no seletor de clínicas e aos
                    pacientes.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="clinic-legalName"
                    className="text-sm font-medium"
                  >
                    Razão social
                  </Label>
                  <Input
                    id="clinic-legalName"
                    value={legalName}
                    onChange={(e) => setLegalName(e.target.value)}
                    placeholder="Ex: Bem Estar Serviços Médicos Ltda."
                    disabled={isSaving}
                    className="bg-background text-foreground"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="clinic-taxId"
                        className="text-sm font-medium"
                      >
                        CNPJ
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        00.000.000/0000-00
                      </span>
                    </div>
                    <Input
                      id="clinic-taxId"
                      value={taxId}
                      onChange={(e) => setTaxId(formatCnpj(e.target.value))}
                      placeholder="00.000.000/0000-00"
                      disabled={isSaving}
                      className="bg-background font-mono text-sm text-foreground"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label
                      htmlFor="clinic-phone"
                      className="text-sm font-medium"
                    >
                      Telefone institucional
                    </Label>
                    <Input
                      id="clinic-phone"
                      value={contactPhone}
                      onChange={(e) =>
                        setContactPhone(formatPhoneWithAreaCode(e.target.value))
                      }
                      placeholder="(11) 99999-9999"
                      disabled={isSaving}
                      className="bg-background font-mono text-sm text-foreground"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="clinic-email" className="text-sm font-medium">
                    E-mail institucional
                  </Label>
                  <Input
                    id="clinic-email"
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="contato@clinicabemestar.com.br"
                    disabled={isSaving}
                    className="bg-background text-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    Canal oficial para recebimento de comunicações e rodapés de
                    documentos.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Card 2: Endereço Completo */}
            <Card className="border-border bg-card">
              <CardHeader>
                <CardTitle className="text-lg font-semibold text-card-foreground">
                  Endereço da Unidade
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  Localização da clínica impressa nos cabeçalhos e receituários.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5 sm:col-span-1">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="clinic-postalCode"
                        className="text-sm font-medium"
                      >
                        CEP
                      </Label>
                      {isSearchingCep && (
                        <span className="flex items-center text-xs text-primary">
                          <Loader2 className="mr-1 size-3 animate-spin" />
                          Buscando
                        </span>
                      )}
                    </div>
                    <Input
                      id="clinic-postalCode"
                      value={postalCode}
                      onChange={(e) => onPostalCodeChange(e.target.value)}
                      placeholder="00000-000"
                      maxLength={9}
                      disabled={isSaving}
                      className="bg-background font-mono text-sm text-foreground"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label
                      htmlFor="clinic-street"
                      className="text-sm font-medium"
                    >
                      Logradouro (Rua / Avenida)
                    </Label>
                    <Input
                      id="clinic-street"
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      placeholder="Av. Paulista"
                      disabled={isSaving}
                      className="bg-background text-foreground"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5 sm:col-span-1">
                    <Label
                      htmlFor="clinic-streetNumber"
                      className="text-sm font-medium"
                    >
                      Número
                    </Label>
                    <Input
                      id="clinic-streetNumber"
                      value={streetNumber}
                      onChange={(e) => setStreetNumber(e.target.value)}
                      placeholder="1000"
                      disabled={isSaving}
                      className="bg-background text-foreground"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label
                      htmlFor="clinic-complement"
                      className="text-sm font-medium"
                    >
                      Complemento
                    </Label>
                    <Input
                      id="clinic-complement"
                      value={addressComplement}
                      onChange={(e) => setAddressComplement(e.target.value)}
                      placeholder="Conjunto 42, Bloco A"
                      disabled={isSaving}
                      className="bg-background text-foreground"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                  <div className="space-y-1.5 sm:col-span-5">
                    <Label
                      htmlFor="clinic-district"
                      className="text-sm font-medium"
                    >
                      Bairro
                    </Label>
                    <Input
                      id="clinic-district"
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      placeholder="Bela Vista"
                      disabled={isSaving}
                      className="bg-background text-foreground"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-5">
                    <Label
                      htmlFor="clinic-city"
                      className="text-sm font-medium"
                    >
                      Cidade
                    </Label>
                    <Input
                      id="clinic-city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="São Paulo"
                      disabled={isSaving}
                      className="bg-background text-foreground"
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label
                      htmlFor="clinic-state"
                      className="text-sm font-medium"
                    >
                      UF
                    </Label>
                    <Input
                      id="clinic-state"
                      value={state}
                      onChange={(e) =>
                        setState(e.target.value.slice(0, 2).toUpperCase())
                      }
                      placeholder="SP"
                      maxLength={2}
                      disabled={isSaving}
                      className="bg-background font-mono text-center text-sm uppercase text-foreground"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bottom Actions for Form */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                type="submit"
                disabled={isSaving}
                className="min-w-40 bg-primary font-medium text-primary-foreground shadow-sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Salvando dados...
                  </>
                ) : (
                  "Salvar alterações"
                )}
              </Button>
            </div>
          </div>

          {/* Right Column: Logo Upload & Live Document Mockup */}
          <div className="space-y-6 lg:col-span-5">
            {/* Card 3: Logotipo da Clínica */}
            <Card className="border-border bg-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="size-5 text-primary" />
                    <CardTitle className="text-lg font-semibold text-card-foreground">
                      Logotipo Oficial
                    </CardTitle>
                  </div>
                  {currentLogoUrl && (
                    <Badge
                      variant="outline"
                      className="border-primary/30 text-xs text-primary"
                    >
                      Ativo
                    </Badge>
                  )}
                </div>
                <CardDescription className="text-muted-foreground">
                  Formatos aceitos: PNG ou JPG com tamanho máximo de 5MB.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Drag and Drop Zone */}
                <input
                  id={fileInputId}
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelected(f);
                  }}
                />

                <button
                  type="button"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Selecionar imagem de logotipo da clínica"
                  className={`w-full flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                    isDragOver
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-secondary text-primary">
                    <UploadCloud className="size-6" />
                  </div>
                  <p className="text-sm font-medium text-foreground">
                    Arraste sua imagem aqui ou clique para selecionar
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    PNG ou JPG até 5MB
                  </p>
                </button>

                {/* Selected File State */}
                {selectedFile && (
                  <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 p-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <ImageIcon className="size-4 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">
                          {selectedFile.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {(selectedFile.size / 1024).toFixed(0)} KB
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedFile(null);
                          if (fileInputRef.current) {
                            fileInputRef.current.value = "";
                          }
                        }}
                        className="size-8 p-0 text-muted-foreground hover:text-destructive"
                        aria-label="Remover seleção"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={isUploadingLogo}
                        onClick={handleUploadLogo}
                        className="bg-primary text-xs font-medium text-primary-foreground"
                      >
                        {isUploadingLogo ? (
                          <>
                            <Loader2 className="mr-1.5 size-3 animate-spin" />
                            Enviando...
                          </>
                        ) : (
                          "Salvar logotipo"
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Card 4: Miniature Mockup showing how the logo appears in document headers */}
            <Card className="border-border bg-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileSignature className="size-5 text-primary" />
                    <CardTitle className="text-base font-semibold text-card-foreground">
                      Prévia nos Documentos
                    </CardTitle>
                  </div>
                  {/* Selector for Receituário / Atestado */}
                  <div className="flex items-center rounded-lg border border-border p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setPreviewDocType("prescription")}
                      className={`rounded px-2.5 py-1 font-medium transition-colors ${
                        previewDocType === "prescription"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Receituário
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewDocType("certificate")}
                      className={`rounded px-2.5 py-1 font-medium transition-colors ${
                        previewDocType === "certificate"
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Atestado
                    </button>
                  </div>
                </div>
                <CardDescription className="text-xs text-muted-foreground">
                  Simulação de como o logotipo e cabeçalho institucional serão
                  impressos em PDF.
                </CardDescription>
              </CardHeader>

              <CardContent>
                {/* Simulated A4 Paper Header Mockup */}
                <section
                  aria-label="Prévia do cabeçalho de documento médico"
                  className="rounded-lg border border-border bg-background p-4 shadow-xs"
                >
                  {/* Document Header */}
                  <div className="flex items-start justify-between gap-3 pb-3">
                    {/* Logo display */}
                    <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded border border-border/80 bg-muted/30">
                      {displayLogo ? (
                        /* biome-ignore lint/performance/noImgElement: dynamic blob and presigned preview urls */
                        <img
                          src={displayLogo}
                          alt="Logotipo da clínica na prévia"
                          className="size-full object-contain p-1"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center p-1 text-center text-muted-foreground">
                          <Building2 className="size-6 stroke-[1.5]" />
                          <span className="text-[8px] font-medium tracking-tight">
                            Sem logo
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Institutional Header Info */}
                    <div className="min-w-0 flex-1 text-right leading-tight">
                      <p className="truncate text-xs font-bold text-foreground">
                        {name.trim() || "Nome da Clínica"}
                      </p>
                      {legalName.trim() && (
                        <p className="truncate text-[10px] text-muted-foreground">
                          {legalName.trim()}
                        </p>
                      )}
                      {taxId.trim() && (
                        <p className="text-[10px] text-muted-foreground">
                          CNPJ: {taxId.trim()}
                        </p>
                      )}
                      <p className="truncate text-[9px] text-muted-foreground">
                        {[
                          street.trim(),
                          streetNumber.trim()
                            ? `nº ${streetNumber.trim()}`
                            : "",
                          addressComplement.trim(),
                          district.trim(),
                          city.trim() && state.trim()
                            ? `${city.trim()}/${state.trim()}`
                            : city.trim() || state.trim(),
                        ]
                          .filter(Boolean)
                          .join(", ") || "Endereço da clínica"}
                        {postalCode.trim() ? ` — CEP ${postalCode.trim()}` : ""}
                      </p>
                      {(contactPhone.trim() || contactEmail.trim()) && (
                        <p className="truncate text-[9px] text-muted-foreground">
                          {[contactPhone.trim(), contactEmail.trim()]
                            .filter(Boolean)
                            .join(" • ")}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Header Divider */}
                  <div className="border-b border-border/80 my-2" />

                  {/* Mock Document Body Content */}
                  <div className="space-y-2 pt-1 text-foreground/80">
                    <div className="text-center">
                      <span className="inline-block rounded bg-muted/60 px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase text-foreground">
                        {previewDocType === "prescription"
                          ? "Receituário Médico"
                          : "Atestado Médico"}
                      </span>
                    </div>

                    <div className="rounded bg-muted/20 p-2 text-[10px] leading-relaxed text-muted-foreground">
                      <p className="font-medium text-foreground/90">
                        Paciente:{" "}
                        <span className="font-normal">
                          Maria Oliveira de Souza
                        </span>
                      </p>
                      {previewDocType === "prescription" ? (
                        <div className="mt-2 space-y-1 font-mono text-[9px]">
                          <p className="font-semibold text-foreground">
                            1. Amoxicilina + Clavulanato 875/125mg
                          </p>
                          <p className="text-muted-foreground">
                            Tomar 1 comprimido via oral de 12 em 12 horas por 7
                            dias.
                          </p>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-[9px]">
                          Atesto que a paciente acima esteve sob cuidados
                          médicos nesta data e necessita de 2 (dois) dias de
                          afastamento de suas atividades.
                        </p>
                      )}
                    </div>

                    {/* Mock Prescriber Signature */}
                    <div className="pt-3 text-center">
                      <div className="mx-auto w-32 border-b border-dashed border-border/80" />
                      <p className="mt-1 text-[9px] font-medium text-foreground">
                        Dr(a). Responsável Técnico
                      </p>
                      <p className="text-[8px] text-muted-foreground">
                        CRM 123456/UF
                      </p>
                    </div>
                  </div>
                </section>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </div>
  );
}
