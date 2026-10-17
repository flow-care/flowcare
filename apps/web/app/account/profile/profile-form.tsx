"use client";

import {
  Camera,
  Check,
  ImageIcon,
  Info,
  Loader2,
  Lock,
  UploadCloud,
  User,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  LOCKED_EMAIL_NOTICE,
  type UserProfile,
  validateProfilePhoto,
} from "@/lib/account-profile";
import { formatPhoneWithAreaCode } from "@/lib/phone";
import { updateProfileAction, uploadProfilePhotoAction } from "./actions";

interface ProfileFormProps {
  initialProfile: UserProfile;
}

export function ProfileForm({ initialProfile }: ProfileFormProps) {
  const router = useRouter();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, startTransition] = useTransition();

  // Form field states
  const [fullName, setFullName] = useState(initialProfile.fullName || "");
  const [phone, setPhone] = useState(
    formatPhoneWithAreaCode(initialProfile.phone || ""),
  );
  const [professionalTitle, setProfessionalTitle] = useState(
    initialProfile.professionalTitle || "",
  );
  const [registrationNumber, setRegistrationNumber] = useState(
    initialProfile.registrationNumber || "",
  );

  // Photo state & live preview
  const [currentPhotoUrl, setCurrentPhotoUrl] = useState<string | null>(
    initialProfile.photoUrl || null,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Operational states
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [fullNameError, setFullNameError] = useState<string | null>(null);

  // Create object URL for immediate live preview of chosen photo
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

  // Photo selection & client-side validation
  function handleFileSelected(file: File) {
    setPhotoError(null);
    const validation = validateProfilePhoto(file);
    if (!validation.valid) {
      const errorMsg =
        validation.error || "Arquivo de foto inválido. Use PNG ou JPG até 2MB.";
      setPhotoError(errorMsg);
      toast.error(errorMsg);
      return;
    }
    setSelectedFile(file);
    toast.info("Foto selecionada. Salve para confirmar o upload.");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelected(file);
    }
  }

  // Upload photo independently
  async function handleUploadPhoto() {
    if (!selectedFile || isUploadingPhoto) return;

    setIsUploadingPhoto(true);
    setPhotoError(null);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const res = await uploadProfilePhotoAction(formData);
      if (!res.ok) {
        setPhotoError(res.message);
        toast.error(res.message);
        return;
      }

      toast.success("Foto de perfil atualizada com sucesso!");
      const updatedData = res.data as UserProfile | undefined;
      if (updatedData?.photoUrl) {
        setCurrentPhotoUrl(updatedData.photoUrl);
      }
      setSelectedFile(null);
      setLocalPreviewUrl(null);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      toast.error("Falha ao enviar foto de perfil.");
    } finally {
      setIsUploadingPhoto(false);
    }
  }

  // Clear photo selection
  function handleCancelPhotoSelection() {
    setSelectedFile(null);
    setLocalPreviewUrl(null);
    setPhotoError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  // Save personal details form
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSaving || isUploadingPhoto) return;

    // Validate full name
    const trimmedName = fullName.trim();
    if (trimmedName.length < 3) {
      setFullNameError("Nome completo deve ter pelo menos 3 caracteres.");
      toast.error("Nome completo deve ter pelo menos 3 caracteres.");
      return;
    }
    setFullNameError(null);

    setIsSaving(true);
    try {
      // If user also selected a photo, upload it as well
      if (selectedFile) {
        const photoFormData = new FormData();
        photoFormData.append("file", selectedFile);
        const photoRes = await uploadProfilePhotoAction(photoFormData);
        if (photoRes.ok) {
          const updatedPhotoData = photoRes.data as UserProfile | undefined;
          if (updatedPhotoData?.photoUrl) {
            setCurrentPhotoUrl(updatedPhotoData.photoUrl);
          }
          setSelectedFile(null);
          setLocalPreviewUrl(null);
        } else {
          toast.error(photoRes.message);
        }
      }

      const res = await updateProfileAction({
        fullName: trimmedName,
        phone: phone.trim() || undefined,
        professionalTitle: professionalTitle.trim() || undefined,
        registrationNumber: registrationNumber.trim() || undefined,
      });

      if (!res.ok) {
        toast.error(res.message);
        if (res.fieldErrors?.fullName) {
          setFullNameError(res.fieldErrors.fullName);
        }
        return;
      }

      toast.success("Dados do perfil atualizados com sucesso!");
      startTransition(() => {
        router.refresh();
      });
    } catch {
      toast.error("Não foi possível salvar as alterações. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  }

  const activeAvatarSrc =
    localPreviewUrl ||
    currentPhotoUrl ||
    `https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(fullName.trim() || "Flowcare")}&lettersVariant=single`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Coluna Principal: Formulário de Dados Pessoais */}
      <div className="lg:col-span-7">
        <form onSubmit={handleSubmit} noValidate>
          <Card className="border-border bg-card shadow-xs">
            <CardHeader className="space-y-1">
              <div className="flex items-center gap-2">
                <User className="size-5 text-primary" />
                <CardTitle className="text-lg font-semibold text-card-foreground">
                  Dados Pessoais
                </CardTitle>
              </div>
              <CardDescription className="text-sm text-muted-foreground">
                Informações de identificação da sua conta no Flowcare.
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4 pt-2">
              {/* Nome Completo */}
              <div className="space-y-1.5">
                <Label htmlFor="fullName" className="text-sm font-medium">
                  Nome completo <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="fullName"
                  name="fullName"
                  value={fullName}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (fullNameError) setFullNameError(null);
                  }}
                  placeholder="Seu nome completo"
                  autoComplete="name"
                  maxLength={120}
                  disabled={isSaving}
                  aria-invalid={!!fullNameError}
                  aria-describedby={
                    fullNameError ? "fullName-error" : undefined
                  }
                  className="bg-background text-foreground"
                  required
                />
                {fullNameError && (
                  <p id="fullName-error" className="text-xs text-destructive">
                    {fullNameError}
                  </p>
                )}
              </div>

              {/* Telefone celular */}
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-sm font-medium">
                  Telefone celular
                </Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) =>
                    setPhone(formatPhoneWithAreaCode(e.target.value))
                  }
                  placeholder="(00) 00000-0000"
                  maxLength={15}
                  disabled={isSaving}
                  className="bg-background font-mono text-sm text-foreground"
                />
              </div>

              {/* Título profissional e Registro */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="professionalTitle"
                    className="text-sm font-medium"
                  >
                    Especialidade / Título profissional
                  </Label>
                  <Input
                    id="professionalTitle"
                    name="professionalTitle"
                    value={professionalTitle}
                    onChange={(e) => setProfessionalTitle(e.target.value)}
                    placeholder="Ex: Médico Clínico Geral, Cardiologista"
                    maxLength={120}
                    disabled={isSaving}
                    className="bg-background text-foreground"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label
                    htmlFor="registrationNumber"
                    className="text-sm font-medium"
                  >
                    Registro profissional (CRM/Conselho)
                  </Label>
                  <Input
                    id="registrationNumber"
                    name="registrationNumber"
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    placeholder="Ex: CRM/SP 123456"
                    maxLength={80}
                    disabled={isSaving}
                    className="bg-background font-mono text-sm text-foreground"
                  />
                </div>
              </div>

              {/* E-mail (somente leitura / bloqueado) */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="email" className="text-sm font-medium">
                    E-mail principal
                  </Label>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="size-3" /> Bloqueado para edição direta
                  </span>
                </div>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  value={initialProfile.email}
                  disabled
                  readOnly
                  aria-describedby="email-notice"
                  className="cursor-not-allowed bg-muted/60 text-muted-foreground"
                />
                <div
                  id="email-notice"
                  className="flex items-start gap-1.5 text-xs text-muted-foreground"
                >
                  <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span>{LOCKED_EMAIL_NOTICE}</span>
                </div>
              </div>
            </CardContent>

            <CardFooter className="flex justify-end border-t border-border pt-4">
              <Button
                type="submit"
                disabled={isSaving || isUploadingPhoto}
                className="min-w-40 bg-primary font-medium text-primary-foreground shadow-xs"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Salvando dados...
                  </>
                ) : (
                  <>
                    <Check className="mr-1.5 size-4" />
                    Salvar alterações
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>

      {/* Coluna Lateral: Upload de Foto de Perfil */}
      <div className="space-y-6 lg:col-span-5">
        <Card className="border-border bg-card shadow-xs">
          <CardHeader className="space-y-1">
            <div className="flex items-center gap-2">
              <ImageIcon className="size-5 text-primary" />
              <CardTitle className="text-lg font-semibold text-card-foreground">
                Foto de Perfil
              </CardTitle>
            </div>
            <CardDescription className="text-sm text-muted-foreground">
              Sua foto será exibida no menu de perfil, cabeçalho e equipe.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Live Preview Avatar */}
            <div className="flex flex-col items-center justify-center gap-3">
              <div className="relative">
                <Avatar className="size-24 border-2 border-border shadow-xs sm:size-28">
                  <AvatarImage
                    src={activeAvatarSrc}
                    alt={fullName || "Foto de perfil"}
                    referrerPolicy="no-referrer"
                    className="object-cover"
                  />
                  <AvatarFallback className="text-xl font-semibold">
                    {fullName.trim().charAt(0).toUpperCase() || "?"}
                  </AvatarFallback>
                </Avatar>
                {isUploadingPhoto && (
                  <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70 backdrop-blur-xs">
                    <Loader2 className="size-6 animate-spin text-primary" />
                  </div>
                )}
              </div>

              {selectedFile && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="max-w-[200px] truncate font-medium text-foreground">
                    {selectedFile.name}
                  </span>
                  <span>
                    ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </span>
                </div>
              )}
            </div>

            {/* Hidden file input */}
            <input
              id={fileInputId}
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelected(f);
              }}
              disabled={isSaving || isUploadingPhoto}
            />

            {/* Dropzone acessível */}
            <button
              type="button"
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              disabled={isSaving || isUploadingPhoto}
              aria-label="Selecionar imagem de foto de perfil"
              className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-5 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                isDragOver
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/40"
              }`}
            >
              <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-secondary text-primary">
                <UploadCloud className="size-5" />
              </div>
              <p className="text-sm font-medium text-foreground">
                Arraste uma foto aqui ou clique para selecionar
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Formatos aceitos: PNG ou JPG até 2MB
              </p>
            </button>

            {/* Mensagem de erro de foto */}
            {photoError && (
              <p className="text-center text-xs text-destructive">
                {photoError}
              </p>
            )}

            {/* Botões de Ação para a foto selecionada */}
            {selectedFile && (
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleUploadPhoto}
                  disabled={isUploadingPhoto || isSaving}
                  size="sm"
                  className="flex-1 bg-primary text-primary-foreground"
                >
                  {isUploadingPhoto ? (
                    <>
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                      Enviando foto...
                    </>
                  ) : (
                    <>
                      <Camera className="mr-1.5 size-4" />
                      Salvar foto
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCancelPhotoSelection}
                  disabled={isUploadingPhoto || isSaving}
                >
                  <X className="mr-1 size-3.5" />
                  Cancelar
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
