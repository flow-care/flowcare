"use client";

import {
  AlertCircleIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  Loader2Icon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  archivePatientAttachmentAction,
  getAttachmentDownloadUrlAction,
} from "@/app/app/[orgSlug]/patients/actions";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { PatientAttachmentItem } from "@/server/patients";

export const ATTACHMENT_CATEGORIES = [
  "Laudo",
  "Imagem",
  "Receita externa",
  "Outro",
] as const;

export type AttachmentCategory = (typeof ATTACHMENT_CATEGORIES)[number];

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"];

export function formatAttachmentCategory(category?: string | null): string {
  if (!category) return "Outro";
  const lower = category.toLowerCase().trim();
  if (lower === "laudo" || lower === "report") return "Laudo";
  if (lower === "imagem" || lower === "image") return "Imagem";
  if (
    lower === "receita externa" ||
    lower === "receita_externa" ||
    lower === "external_prescription"
  )
    return "Receita externa";
  if (lower === "outro" || lower === "other") return "Outro";
  return category;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatAttachmentDate(dateString: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(dateString));
  } catch {
    return dateString;
  }
}

function getFileIcon(contentType: string, fileName: string) {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (contentType.includes("pdf") || ext === ".pdf") {
    return <FileTextIcon className="size-5 text-red-500 shrink-0" />;
  }
  if (
    contentType.includes("image") ||
    ext === ".jpg" ||
    ext === ".jpeg" ||
    ext === ".png"
  ) {
    return <ImageIcon className="size-5 text-blue-500 shrink-0" />;
  }
  return <FileIcon className="size-5 text-muted-foreground shrink-0" />;
}

function getCategoryBadgeVariant(cat: string) {
  switch (cat) {
    case "Laudo":
      return "default";
    case "Imagem":
      return "secondary";
    case "Receita externa":
      return "outline";
    default:
      return "secondary";
  }
}

interface PatientAttachmentsViewProps {
  orgSlug: string;
  patientId: string;
  initialAttachments: PatientAttachmentItem[];
  isRestricted?: boolean;
  canUpload?: boolean;
  isLoading?: boolean;
}

export function PatientAttachmentsView({
  orgSlug,
  patientId,
  initialAttachments,
  isRestricted = false,
  canUpload = true,
  isLoading = false,
}: PatientAttachmentsViewProps) {
  const router = useRouter();
  const fileInputId = useId();
  const descInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [attachments, setAttachments] =
    useState<PatientAttachmentItem[]>(initialAttachments);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  // Upload state
  const [showUploadZone, setShowUploadZone] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedCategory, setSelectedCategory] =
    useState<AttachmentCategory>("Laudo");
  const [description, setDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Download & Archive state
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [attachmentToArchive, setAttachmentToArchive] =
    useState<PatientAttachmentItem | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  // Sync when initialAttachments changes
  useEffect(() => {
    setAttachments(initialAttachments);
  }, [initialAttachments]);

  // Prevent accidental tab closing while uploading
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isUploading) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isUploading]);

  if (isRestricted) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LockIcon className="size-6" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">
            Acesso restrito aos anexos clínicos
          </h3>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Exames e documentos clínicos anexados ao paciente são restritos a
            profissionais de saúde autorizados.
          </p>
        </CardContent>
      </Card>
    );
  }

  const validateFile = (file: File): boolean => {
    setValidationError(null);
    const dotIndex = file.name.lastIndexOf(".");
    if (dotIndex === -1) {
      const msg =
        "Extensão de arquivo não permitida. Apenas arquivos PDF, JPG e PNG são permitidos.";
      setValidationError(msg);
      toast.error(msg);
      return false;
    }
    const ext = file.name.slice(dotIndex).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      const msg = `Formato de arquivo (${ext}) não permitido. Apenas arquivos PDF, JPG e PNG são aceitos.`;
      setValidationError(msg);
      toast.error(msg);
      return false;
    }
    if (file.size <= 0) {
      const msg = "O arquivo selecionado está vazio.";
      setValidationError(msg);
      toast.error(msg);
      return false;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const msg = "O arquivo excede o limite máximo permitido de 25MB.";
      setValidationError(msg);
      toast.error(msg);
      return false;
    }
    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateFile(file)) {
      setSelectedFile(file);
    }
    if (e.target) {
      e.target.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (isUploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file && validateFile(file)) {
      setSelectedFile(file);
      setShowUploadZone(true);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!isUploading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleUploadSubmit = () => {
    if (!selectedFile || isUploading) return;
    if (!validateFile(selectedFile)) return;

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("category", selectedCategory);
    if (description.trim()) {
      formData.append("description", description.trim());
    }

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/organizations/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(patientId)}/attachments`,
    );

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.min(
          99,
          Math.round((event.loaded / event.total) * 100),
        );
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        setUploadProgress(100);
        try {
          const res = JSON.parse(xhr.responseText);
          const newAtt = res.attachment || res;
          if (newAtt?.id) {
            setAttachments((prev) => [
              newAtt,
              ...prev.filter((a) => a.id !== newAtt.id),
            ]);
          }
        } catch {}
        toast.success("Arquivo anexado com sucesso!");
        setSelectedFile(null);
        setDescription("");
        setValidationError(null);
        setShowUploadZone(false);
        router.refresh();
      } else {
        let errorMsg = "Falha ao enviar arquivo.";
        try {
          const err = JSON.parse(xhr.responseText);
          errorMsg = err.message || errorMsg;
        } catch {}
        toast.error(errorMsg);
        setValidationError(errorMsg);
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      const msg = "Erro de conexão ao enviar o arquivo.";
      toast.error(msg);
      setValidationError(msg);
    };

    xhr.send(formData);
  };

  const handleDownload = async (att: PatientAttachmentItem) => {
    const targetId = att.attachmentId || att.id;
    if (downloadingId) return;
    setDownloadingId(targetId);

    try {
      const result = await getAttachmentDownloadUrlAction(
        orgSlug,
        patientId,
        targetId,
      );
      if (!result.success || !result.downloadUrl) {
        throw new Error(
          result.error || "Não foi possível obter o link de download.",
        );
      }
      window.open(result.downloadUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Falha ao obter URL de download.",
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handleConfirmArchive = async () => {
    if (!attachmentToArchive || isArchiving) return;
    setIsArchiving(true);
    const targetId = attachmentToArchive.attachmentId || attachmentToArchive.id;

    try {
      const result = await archivePatientAttachmentAction(
        orgSlug,
        patientId,
        targetId,
      );
      if (!result.success) {
        throw new Error(result.error || "Não foi possível arquivar o anexo.");
      }
      toast.success("Anexo arquivado com sucesso!");
      setAttachments((prev) =>
        prev.filter((a) => a.id !== targetId && a.attachmentId !== targetId),
      );
      setAttachmentToArchive(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Erro ao arquivar anexo.",
      );
    } finally {
      setIsArchiving(false);
    }
  };

  // Filter attachments by search and category
  const filteredAttachments = attachments.filter((att) => {
    if (categoryFilter !== "all") {
      const cat = formatAttachmentCategory(att.category);
      if (cat.toLowerCase() !== categoryFilter.toLowerCase()) return false;
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      const matchName = att.fileName.toLowerCase().includes(term);
      const matchDesc = att.description?.toLowerCase().includes(term);
      if (!matchName && !matchDesc) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header and Action Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base font-semibold text-foreground">
                Documentos e Arquivos Anexados
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Laudos externos, exames laboratoriais, fotos e documentos do
                paciente
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="px-2.5 py-0.5 text-xs">
                {attachments.length} anexo(s)
              </Badge>
              {canUpload && (
                <Button
                  size="sm"
                  variant={showUploadZone ? "outline" : "default"}
                  onClick={() => setShowUploadZone((prev) => !prev)}
                  disabled={isUploading}
                  className="gap-1.5"
                >
                  {showUploadZone ? (
                    <>
                      <XIcon className="size-4" /> Fechar envio
                    </>
                  ) : (
                    <>
                      <PlusIcon className="size-4" /> Novo anexo
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        {/* Upload Zone (Expandable) */}
        {canUpload && (
          <div
            className={cn(
              "px-6 pb-6 pt-0 transition-all",
              !showUploadZone && !isDragging && "hidden",
            )}
          >
            <section
              aria-label="Zona de envio de arquivos"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={cn(
                "relative rounded-lg border-2 border-dashed p-6 text-center transition-colors",
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-muted/30",
                isUploading && "pointer-events-none opacity-80",
              )}
            >
              <input
                id={fileInputId}
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileChange}
                disabled={isUploading}
                className="hidden"
              />

              {!selectedFile ? (
                <div className="flex flex-col items-center justify-center space-y-3">
                  <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UploadCloudIcon className="size-6" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Arraste e solte o arquivo aqui, ou{" "}
                      <label
                        htmlFor={fileInputId}
                        className="cursor-pointer text-primary underline underline-offset-2 hover:text-primary/90"
                      >
                        selecione no computador
                      </label>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Formatos permitidos: PDF, JPG, PNG (máx. 25MB)
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 text-left">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {getFileIcon(selectedFile.type, selectedFile.name)}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {selectedFile.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(selectedFile.size)}
                        </p>
                      </div>
                    </div>
                    {!isUploading && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => setSelectedFile(null)}
                        className="size-8 text-muted-foreground hover:text-foreground"
                      >
                        <XIcon className="size-4" />
                      </Button>
                    )}
                  </div>

                  {/* Category and description options */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <span className="block text-xs font-medium text-foreground">
                        Categoria
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {ATTACHMENT_CATEGORIES.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setSelectedCategory(cat)}
                            disabled={isUploading}
                            className={cn(
                              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                              selectedCategory === cat
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor={descInputId}
                        className="block text-xs font-medium text-foreground"
                      >
                        Descrição (opcional)
                      </label>
                      <Input
                        id={descInputId}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Ex: Hemograma completo 10/2026"
                        disabled={isUploading}
                        maxLength={200}
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  </div>

                  {/* Progress Indicator */}
                  {isUploading && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Loader2Icon className="size-3.5 animate-spin text-primary" />
                          Enviando {selectedFile.name}...
                        </span>
                        <span>{uploadProgress}%</span>
                      </div>
                      <Progress value={uploadProgress} className="h-2" />
                    </div>
                  )}

                  {validationError && (
                    <div className="flex items-center gap-2 text-xs text-destructive">
                      <AlertCircleIcon className="size-4 shrink-0" />
                      <span>{validationError}</span>
                    </div>
                  )}

                  {/* Submit button */}
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedFile(null);
                        setValidationError(null);
                        setShowUploadZone(false);
                      }}
                      disabled={isUploading}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleUploadSubmit}
                      disabled={isUploading}
                      className="gap-1.5"
                    >
                      {isUploading ? (
                        <>
                          <Loader2Icon className="size-4 animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <UploadCloudIcon className="size-4" />
                          Enviar arquivo
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {/* Search & Filter Toolbar */}
        {attachments.length > 0 && (
          <div className="border-t border-border px-6 py-3.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1 max-w-sm">
                <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar arquivos por nome..."
                  className="h-8 pl-8 text-xs"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>

              {/* Category Filter Pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground mr-1">
                  Filtrar:
                </span>
                <button
                  type="button"
                  onClick={() => setCategoryFilter("all")}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                    categoryFilter === "all"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  Todos
                </button>
                {ATTACHMENT_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategoryFilter(cat)}
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                      categoryFilter === cat
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Content Table / List */}
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : attachments.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FileTextIcon className="size-6" />
              </div>
              <h4 className="text-sm font-semibold text-foreground">
                Nenhum arquivo ou exame anexado a este paciente
              </h4>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Envie laudos externos, exames laboratoriais ou fotos usando a
                área de envio acima.
              </p>
              {canUpload && !showUploadZone && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowUploadZone(true)}
                  className="mt-4 gap-1.5"
                >
                  <PlusIcon className="size-4" /> Anexar primeiro arquivo
                </Button>
              )}
            </div>
          ) : filteredAttachments.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <p>Nenhum anexo encontrado para o filtro selecionado.</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchTerm("");
                  setCategoryFilter("all");
                }}
                className="mt-2 text-xs"
              >
                Limpar filtros
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/20">
                    <TableHead className="w-[40%] text-xs font-semibold">
                      Arquivo
                    </TableHead>
                    <TableHead className="text-xs font-semibold">
                      Categoria
                    </TableHead>
                    <TableHead className="text-xs font-semibold">
                      Tamanho
                    </TableHead>
                    <TableHead className="text-xs font-semibold">
                      Data de Envio
                    </TableHead>
                    <TableHead className="text-xs font-semibold">
                      Enviado por
                    </TableHead>
                    <TableHead className="text-right text-xs font-semibold">
                      Ações
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAttachments.map((att) => {
                    const formattedCat = formatAttachmentCategory(att.category);
                    const isDownloadingThis =
                      downloadingId === (att.attachmentId || att.id);

                    return (
                      <TableRow key={att.id} className="hover:bg-muted/40">
                        {/* Filename & Description */}
                        <TableCell className="py-3">
                          <div className="flex items-center gap-3">
                            {getFileIcon(att.contentType, att.fileName)}
                            <div className="min-w-0">
                              <p
                                className="truncate text-sm font-medium text-foreground"
                                title={att.fileName}
                              >
                                {att.fileName}
                              </p>
                              {att.description && (
                                <p
                                  className="truncate text-xs text-muted-foreground"
                                  title={att.description}
                                >
                                  {att.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        {/* Category */}
                        <TableCell className="py-3">
                          <Badge
                            variant={getCategoryBadgeVariant(formattedCat)}
                            className="text-[11px] font-medium"
                          >
                            {formattedCat}
                          </Badge>
                        </TableCell>

                        {/* File Size */}
                        <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatFileSize(att.sizeBytes)}
                        </TableCell>

                        {/* Upload Date */}
                        <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatAttachmentDate(att.createdAt)}
                        </TableCell>

                        {/* Uploader */}
                        <TableCell className="py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {att.uploadedById || "Equipe clínica"}
                        </TableCell>

                        {/* Actions: Download & Archive */}
                        <TableCell className="py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownload(att)}
                              disabled={isDownloadingThis}
                              className="h-8 gap-1.5 px-2.5 text-xs text-foreground hover:bg-muted"
                              title="Baixar anexo com segurança"
                            >
                              {isDownloadingThis ? (
                                <Loader2Icon className="size-3.5 animate-spin text-primary" />
                              ) : (
                                <DownloadIcon className="size-3.5" />
                              )}
                              <span>Baixar</span>
                            </Button>

                            {canUpload && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setAttachmentToArchive(att)}
                                className="h-8 gap-1.5 px-2.5 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                title="Arquivar anexo"
                              >
                                <Trash2Icon className="size-3.5" />
                                <span>Arquivar</span>
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialog for Archiving */}
      <AlertDialog
        open={attachmentToArchive !== null}
        onOpenChange={(open) => {
          if (!open && !isArchiving) {
            setAttachmentToArchive(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar anexo</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja arquivar este anexo? O arquivo não estará
              mais disponível na lista de anexos ativos do paciente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleConfirmArchive}
              disabled={isArchiving}
            >
              {isArchiving ? (
                <>
                  <Loader2Icon className="mr-1.5 size-4 animate-spin" />
                  Arquivando...
                </>
              ) : (
                "Arquivar anexo"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
