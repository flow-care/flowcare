"use client";

import {
  AlertCircleIcon,
  AlertTriangleIcon,
  ArrowLeftIcon,
  BanIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileCheckIcon,
  PencilIcon,
  PrinterIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  formatDocumentDate,
  formatDocumentStatus,
  formatDocumentType,
} from "@/lib/documents";
import type { DocumentDetail } from "@/server/documents";
import {
  issueDocumentAction,
  rectifyDocumentAction,
  voidDocumentAction,
} from "../actions";
import { EditDocumentSheet } from "./edit-document-sheet";

export interface DocumentDetailViewProps {
  orgSlug: string;
  document: DocumentDetail;
  activeTab?: string;
  initialSheet?: string;
  userRole?: string;
  organizationName?: string;
}

export function DocumentDetailView({
  orgSlug,
  document: initialDocument,
  activeTab: propActiveTab = "preview",
  initialSheet,
  userRole: _userRole,
  organizationName = "Clínica",
}: DocumentDetailViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [document, setDocument] = useState<DocumentDetail>(initialDocument);

  // Active Tab state
  const currentTabParam = searchParams.get("tab") || propActiveTab || "preview";
  const [activeTab, setActiveTab] = useState<string>(currentTabParam);

  useEffect(() => {
    const tabParam = searchParams.get("tab") || "preview";
    setActiveTab(tabParam);
  }, [searchParams]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", value);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // Edit sheet state
  const isEditSheetOpen =
    (searchParams.get("sheet") ?? initialSheet) === "edit";

  const handleOpenEditSheet = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sheet", "edit");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleCloseEditSheet = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("sheet");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Issuance modal state
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);
  const [isIssuing, setIsIssuing] = useState(false);

  // Rectification state
  const [isRectifying, setIsRectifying] = useState(false);

  // Void modal state
  const [isVoidDialogOpen, setIsVoidDialogOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidReasonError, setVoidReasonError] = useState<string | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);

  // Previewer Zoom state
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  // PDF iframe loading and error states
  const [pdfKey, setPdfKey] = useState<number>(0);
  const [isPdfLoading, setIsPdfLoading] = useState(true);
  const [hasPdfError, setHasPdfError] = useState(false);

  // Doctor CRM / registration from variables
  const doctorReg = useMemo(() => {
    const vars = document.variables || {};
    return String(
      vars.profissional_registro ??
        vars.profissional_crm ??
        vars.medico_crm ??
        vars.crm ??
        "",
    ).trim();
  }, [document.variables]);

  // Handle Download PDF
  const handleDownloadPdf = () => {
    if (document.status === "DRAFT") {
      toast.info(
        "O PDF oficial estará disponível para download após a emissão do documento.",
      );
      return;
    }
    const downloadUrl = `/api/organizations/${encodeURIComponent(orgSlug)}/documents/${encodeURIComponent(document.id)}/pdf?download=true`;
    const a = window.document.createElement("a");
    a.href = downloadUrl;
    a.download = `documento-${document.id}.pdf`;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
  };

  // Handle Print
  const handlePrint = () => {
    window.print();
  };

  // Handle Issue Confirmation
  const handleConfirmIssue = async () => {
    if (isIssuing) return;
    setIsIssuing(true);

    try {
      const result = await issueDocumentAction(orgSlug, document.id, {
        version: document.version,
      });

      if (!result.success || !result.data) {
        toast.error(result.error || "Não foi possível emitir o documento.");
        return;
      }

      toast.success("Documento oficial emitido com sucesso!");
      setIsIssueDialogOpen(false);
      setDocument((prev) => ({
        ...prev,
        status: "ISSUED",
        issuedAt: result.data?.issuedAt ?? new Date().toISOString(),
      }));
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Erro inesperado ao emitir documento.",
      );
    } finally {
      setIsIssuing(false);
    }
  };

  // Handle Rectify Action
  const handleRectify = async () => {
    if (isRectifying) return;
    setIsRectifying(true);

    try {
      const result = await rectifyDocumentAction(orgSlug, document.id);

      if (!result.success || !result.data) {
        toast.error(result.error || "Não foi possível retificar o documento.");
        return;
      }

      toast.success(
        "Rascunho de retificação criado. Redirecionando para edição...",
      );
      router.push(
        `/app/${encodeURIComponent(orgSlug)}/documents/${encodeURIComponent(result.data.documentId)}?tab=preview&sheet=edit`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Erro inesperado ao iniciar retificação.",
      );
    } finally {
      setIsRectifying(false);
    }
  };

  // Handle Void Confirmation
  const handleConfirmVoid = async () => {
    const trimmed = voidReason.trim();
    if (trimmed.length < 10) {
      setVoidReasonError("A justificativa deve ter no mínimo 10 caracteres.");
      return;
    }

    if (isVoiding) return;
    setIsVoiding(true);
    setVoidReasonError(null);

    try {
      const result = await voidDocumentAction(orgSlug, document.id, {
        reason: trimmed,
        version: document.version,
      });

      if (!result.success) {
        setVoidReasonError(
          result.error || "Não foi possível anular o documento.",
        );
        toast.error(result.error || "Não foi possível anular o documento.");
        return;
      }

      toast.success("Documento oficial anulado.");
      setIsVoidDialogOpen(false);
      setDocument((prev) => ({
        ...prev,
        status: "VOIDED",
        voidedAt: result.data?.voidedAt ?? new Date().toISOString(),
        voidReason: result.data?.voidReason ?? trimmed,
      }));
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Erro inesperado ao anular documento.",
      );
    } finally {
      setIsVoiding(false);
    }
  };

  // Retry PDF loading
  const handleRetryPdf = () => {
    setHasPdfError(false);
    setIsPdfLoading(true);
    setPdfKey((prev) => prev + 1);
  };

  // Reset zoom
  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 25, 200));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 25, 50));
  const handleZoomReset = () => setZoomLevel(100);

  const pdfProxyUrl = useMemo(() => {
    return `/api/organizations/${encodeURIComponent(orgSlug)}/documents/${encodeURIComponent(document.id)}/pdf?key=${pdfKey}`;
  }, [orgSlug, document.id, pdfKey]);

  return (
    <div className="space-y-6">
      {/* Top Back Navigation Bar */}
      <div className="flex items-center justify-between">
        <Link
          href={`/app/${encodeURIComponent(orgSlug)}/documents`}
          className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="mr-1.5 size-4" />
          Voltar para lista de documentos
        </Link>

        {/* Chain / Rectification indicator badge */}
        {document.chainVersion && document.chainVersion > 1 && (
          <Badge variant="outline" className="border-border text-xs">
            Retificação • Versão {document.chainVersion}
          </Badge>
        )}
      </div>

      {/* Main Document Header Toolbar */}
      <section
        aria-label="Barra de ferramentas do documento"
        className="rounded-xl border border-border bg-card p-6 shadow-xs space-y-4"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {document.title || "Documento Clínico"}
              </h1>
              <Badge variant="outline" className="border-border font-medium">
                {formatDocumentType(document.type)}
              </Badge>

              {/* Status Badge */}
              {document.status === "DRAFT" && (
                <Badge
                  variant="secondary"
                  className="font-medium text-muted-foreground"
                >
                  {formatDocumentStatus(document.status)}
                </Badge>
              )}
              {document.status === "ISSUED" && (
                <Badge
                  variant="outline"
                  className="border-emerald-600/30 bg-emerald-50 font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400"
                >
                  Documento Oficial Emitido
                </Badge>
              )}
              {document.status === "VOIDED" && (
                <Badge variant="destructive" className="font-semibold">
                  DOCUMENTO ANULADO
                </Badge>
              )}
            </div>

            {/* Subtitle with Patient and Meta */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span>
                Paciente:{" "}
                <Link
                  href={`/app/${encodeURIComponent(orgSlug)}/patients/${encodeURIComponent(document.patientId)}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {document.patient.fullName}
                </Link>
              </span>
              <span aria-hidden="true">•</span>
              <span>
                {document.status === "ISSUED" && document.issuedAt
                  ? `Emitido em ${formatDocumentDate(document.issuedAt)}`
                  : `Criado em ${formatDocumentDate(document.createdAt)}`}
              </span>
              {document.status === "ISSUED" && (
                <>
                  <span aria-hidden="true">•</span>
                  <span>
                    Emissor: Dr(a). {document.author.fullName}
                    {doctorReg ? ` (CRM: ${doctorReg})` : ""}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Action Buttons Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Download PDF */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadPdf}
              className="border-border text-foreground hover:bg-muted"
            >
              <DownloadIcon className="mr-1.5 size-4" />
              Baixar PDF
            </Button>

            {/* Print */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="border-border text-foreground hover:bg-muted"
            >
              <PrinterIcon className="mr-1.5 size-4" />
              Imprimir
            </Button>

            {/* Contextual Actions: DRAFT */}
            {document.status === "DRAFT" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOpenEditSheet}
                  className="border-border text-foreground"
                >
                  <PencilIcon className="mr-1.5 size-4" />
                  Editar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setIsIssueDialogOpen(true)}
                  className="font-medium"
                >
                  <FileCheckIcon className="mr-1.5 size-4" />
                  Emitir versão final
                </Button>
              </>
            )}

            {/* Contextual Actions: ISSUED */}
            {document.status === "ISSUED" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRectify}
                  disabled={isRectifying}
                  className="border-border text-foreground hover:bg-muted"
                >
                  {isRectifying ? (
                    <>
                      <Spinner className="mr-1.5 size-4" />
                      Retificando...
                    </>
                  ) : (
                    <>
                      <RotateCcwIcon className="mr-1.5 size-4" />
                      Retificar documento
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setVoidReason("");
                    setVoidReasonError(null);
                    setIsVoidDialogOpen(true);
                  }}
                >
                  <BanIcon className="mr-1.5 size-4" />
                  Anular documento
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Visual Watermark / Warning Banner for DRAFT */}
        {document.status === "DRAFT" && (
          <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span>Rascunho não emitido — sem validade formal</span>
          </div>
        )}

        {/* Banner for VOIDED */}
        {document.status === "VOIDED" && (
          <div className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <div className="flex items-center gap-2 font-semibold uppercase tracking-wide">
              <BanIcon className="size-4 shrink-0" />
              <span>Documento Oficial Anulado</span>
              {document.voidedAt && (
                <span className="text-xs font-normal opacity-90">
                  (em {formatDocumentDate(document.voidedAt)})
                </span>
              )}
            </div>
            {document.voidReason && (
              <p className="mt-1 text-xs leading-relaxed text-foreground/90">
                <span className="font-medium text-destructive">
                  Justificativa de anulação:
                </span>{" "}
                {document.voidReason}
              </p>
            )}
          </div>
        )}

        {/* Issuer Stamp Box for ISSUED */}
        {document.status === "ISSUED" && (
          <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
            <div className="flex items-center gap-2">
              <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
              <span>
                <strong>Documento Oficial Emitido</strong> • Emissor: Dr(a).{" "}
                {document.author.fullName}
                {doctorReg ? ` • CRM: ${doctorReg}` : ""}
              </span>
            </div>
            {document.issuedAt && (
              <span className="text-muted-foreground">
                Data/Hora: {formatDocumentDate(document.issuedAt)}
              </span>
            )}
          </div>
        )}
      </section>

      {/* Tabs Navigation */}
      <Tabs
        value={activeTab}
        onValueChange={handleTabChange}
        className="space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <TabsList className="grid w-full grid-cols-2 sm:w-auto">
            <TabsTrigger value="preview">Prévia do Documento</TabsTrigger>
            <TabsTrigger value="details">Detalhes e Histórico</TabsTrigger>
          </TabsList>

          {/* Zoom controls for preview tab */}
          {activeTab === "preview" && (
            <div className="flex items-center gap-1.5 self-end sm:self-auto">
              <span className="text-xs text-muted-foreground mr-1">Zoom:</span>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={handleZoomOut}
                disabled={zoomLevel <= 50}
                title="Diminuir zoom"
                className="size-8"
              >
                <ZoomOutIcon className="size-3.5" />
              </Button>
              <button
                type="button"
                onClick={handleZoomReset}
                className="w-12 text-center text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                title="Restaurar zoom original"
              >
                {zoomLevel}%
              </button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={handleZoomIn}
                disabled={zoomLevel >= 200}
                title="Aumentar zoom"
                className="size-8"
              >
                <ZoomInIcon className="size-3.5" />
              </Button>
            </div>
          )}
        </div>

        {/* Tab 1: Preview Viewer */}
        <TabsContent
          value="preview"
          className="space-y-4 focus-visible:outline-none"
        >
          {/* If ISSUED or VOIDED: Embedded PDF Viewer */}
          {document.status === "ISSUED" || document.status === "VOIDED" ? (
            <div className="space-y-4">
              <div
                className="relative mx-auto overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-all"
                style={{
                  maxWidth: `${Math.round((800 * zoomLevel) / 100)}px`,
                  minHeight: "650px",
                }}
              >
                {/* Loading indicator */}
                {isPdfLoading && !hasPdfError && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-card/85 p-6 backdrop-blur-xs">
                    <Spinner className="size-8 text-primary mb-3" />
                    <p className="text-sm font-medium text-foreground">
                      Carregando prévia do documento PDF...
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Renderizando visualização oficial autenticada.
                    </p>
                  </div>
                )}

                {/* PDF Error State */}
                {hasPdfError ? (
                  <div className="flex flex-col items-center justify-center p-12 text-center">
                    <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-3">
                      <AlertCircleIcon className="size-6" />
                    </div>
                    <h3 className="text-base font-semibold text-foreground">
                      Falha na renderização do PDF
                    </h3>
                    <p className="mt-1 max-w-md text-xs text-muted-foreground">
                      Ocorreu uma falha ao gerar ou carregar a prévia do PDF do
                      servidor. Os dados do documento continuam preservados.
                    </p>
                    <div className="mt-5 flex items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleRetryPdf}
                      >
                        <RefreshCwIcon className="mr-1.5 size-3.5" />
                        Tentar novamente
                      </Button>
                    </div>
                  </div>
                ) : (
                  <iframe
                    key={pdfKey}
                    src={pdfProxyUrl}
                    title="Prévia do documento PDF"
                    className="w-full h-[750px] border-none bg-background"
                    onLoad={() => setIsPdfLoading(false)}
                    onError={() => {
                      setIsPdfLoading(false);
                      setHasPdfError(true);
                    }}
                  />
                )}
              </div>
            </div>
          ) : (
            /* DRAFT: Structured A4 Clinical Document Paper */
            <div className="space-y-4">
              <div
                className="relative mx-auto rounded-xl border border-border bg-white text-neutral-900 p-8 sm:p-12 shadow-sm transition-all dark:bg-zinc-950 dark:text-zinc-100"
                style={{
                  maxWidth: `${Math.round((800 * zoomLevel) / 100)}px`,
                  minHeight: "750px",
                }}
              >
                {/* Diagonal Watermark for Draft */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none select-none absolute inset-0 flex items-center justify-center overflow-hidden"
                >
                  <span className="rotate-[-28deg] text-center text-4xl sm:text-5xl font-black uppercase tracking-widest text-neutral-400/20 dark:text-neutral-500/15 leading-relaxed">
                    Rascunho não emitido
                    <br />
                    sem validade formal
                  </span>
                </div>

                {/* Document Paper Content */}
                <div className="relative z-1 space-y-8">
                  {/* Clinic Header */}
                  <div className="border-b border-neutral-200 pb-5 text-center dark:border-zinc-800">
                    <h2 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-zinc-50">
                      {organizationName}
                    </h2>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-zinc-400">
                      Documento Clínico Assistencial • Flowcare
                    </p>
                  </div>

                  {/* Patient Box */}
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-4 text-xs dark:border-zinc-800 dark:bg-zinc-900/60">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <span className="text-neutral-500 dark:text-zinc-400 block font-medium">
                          Paciente:
                        </span>
                        <span className="text-sm font-semibold text-neutral-900 dark:text-zinc-100">
                          {document.patient.fullName}
                        </span>
                      </div>
                      <div className="sm:text-right">
                        <span className="text-neutral-500 dark:text-zinc-400 block font-medium">
                          Identificação / Situação:
                        </span>
                        <span className="font-semibold text-amber-700 dark:text-amber-400">
                          Rascunho Preliminar
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Document Title & Type */}
                  <div className="text-center space-y-1 pt-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-zinc-400">
                      {formatDocumentType(document.type)}
                    </span>
                    <h3 className="text-lg font-bold tracking-tight text-neutral-900 dark:text-zinc-50">
                      {document.title}
                    </h3>
                  </div>

                  {/* Body Content */}
                  <div className="min-h-[260px] whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-800 dark:text-zinc-200">
                    {document.content || (
                      <span className="italic text-neutral-400">
                        Nenhum conteúdo adicionado a este documento.
                      </span>
                    )}
                  </div>

                  {/* Professional Signature Block */}
                  <div className="border-t border-neutral-200 pt-8 text-center text-xs dark:border-zinc-800 space-y-1">
                    <div className="mx-auto w-64 border-b border-neutral-300 dark:border-zinc-700 mb-2" />
                    <p className="font-bold text-neutral-900 dark:text-zinc-100 text-sm">
                      Dr(a). {document.author.fullName}
                    </p>
                    <p className="text-neutral-500 dark:text-zinc-400">
                      {doctorReg
                        ? `CRM / Registro: ${doctorReg}`
                        : "Profissional Responsável"}
                    </p>
                    <p className="text-neutral-400 dark:text-zinc-500 text-2xs pt-1">
                      Data de criação: {formatDocumentDate(document.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Tab 2: Details & History */}
        <TabsContent
          value="details"
          className="space-y-6 focus-visible:outline-none"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Metadados Cadastrais */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">
                  Metadados do Documento
                </CardTitle>
                <CardDescription>
                  Informações de rastreabilidade e autoria
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3.5 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      ID do Documento
                    </span>
                    <span
                      className="font-mono text-xs truncate block"
                      title={document.id}
                    >
                      {document.id}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      Versão Atual
                    </span>
                    <span className="font-medium">
                      v{document.version}{" "}
                      {document.chainVersion
                        ? `(Cadeia: v${document.chainVersion})`
                        : ""}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      Profissional Autor
                    </span>
                    <span className="font-medium">
                      {document.author.fullName}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      Paciente
                    </span>
                    <span className="font-medium">
                      {document.patient.fullName}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      Data de Criação
                    </span>
                    <span>{formatDocumentDate(document.createdAt)}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      Última Atualização
                    </span>
                    <span>{formatDocumentDate(document.updatedAt)}</span>
                  </div>
                </div>

                {document.replacesDocumentId && (
                  <div className="pt-2 border-t border-border">
                    <span className="text-xs text-muted-foreground block">
                      Documento Anterior Retificado
                    </span>
                    <Link
                      href={`/app/${encodeURIComponent(orgSlug)}/documents/${encodeURIComponent(document.replacesDocumentId)}`}
                      className="text-xs font-mono text-primary hover:underline"
                    >
                      {document.replacesDocumentId}
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Situação e Auditoria */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">
                  Auditoria e Validade
                </CardTitle>
                <CardDescription>
                  Registros formais de emissão e estado
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3.5 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground block">
                    Situação Atual
                  </span>
                  <div className="mt-1">
                    {document.status === "ISSUED" && (
                      <Badge
                        variant="outline"
                        className="border-emerald-600/30 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/40 dark:text-emerald-400"
                      >
                        Emitido e Oficializado
                      </Badge>
                    )}
                    {document.status === "DRAFT" && (
                      <Badge variant="secondary">Rascunho não emitido</Badge>
                    )}
                    {document.status === "VOIDED" && (
                      <Badge variant="destructive">Documento Anulado</Badge>
                    )}
                  </div>
                </div>

                {document.issuedAt && (
                  <div>
                    <span className="text-xs text-muted-foreground block">
                      Data de Emissão
                    </span>
                    <span className="font-medium">
                      {formatDocumentDate(document.issuedAt)}
                    </span>
                  </div>
                )}

                {document.voidedAt && (
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground block">
                      Data de Anulação
                    </span>
                    <span className="font-medium text-destructive">
                      {formatDocumentDate(document.voidedAt)}
                    </span>
                    {document.voidReason && (
                      <p className="text-xs text-muted-foreground pt-1">
                        <strong>Motivo:</strong> {document.voidReason}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Histórico de Versões */}
          {document.versions && document.versions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">
                  Histórico de Versões Salvas
                </CardTitle>
                <CardDescription>
                  Revisões registradas no prontuário
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="divide-y divide-border rounded-lg border border-border">
                  {document.versions.map((ver) => (
                    <div
                      key={ver.id}
                      className="flex items-center justify-between p-3 text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">
                            Versão {ver.version}
                          </span>
                          {ver.version === document.version && (
                            <Badge variant="secondary" className="text-2xs">
                              Atual
                            </Badge>
                          )}
                        </div>
                        <span className="text-muted-foreground">
                          {ver.title}
                        </span>
                      </div>
                      <div className="text-right text-muted-foreground">
                        <span>{formatDocumentDate(ver.createdAt)}</span>
                        {ver.savedBy && (
                          <span className="block text-2xs">
                            por {ver.savedBy.fullName}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Document Sheet (when sheet=edit) */}
      <EditDocumentSheet
        isOpen={isEditSheetOpen}
        onClose={handleCloseEditSheet}
        orgSlug={orgSlug}
        document={document}
        onSuccess={() => {
          handleCloseEditSheet();
          router.refresh();
        }}
      />

      {/* Confirmation Dialog: Issue Final Document */}
      <AlertDialog open={isIssueDialogOpen} onOpenChange={setIsIssueDialogOpen}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              Emitir versão final do documento?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground space-y-2">
              <p>
                Ao emitir, este documento será oficializado no prontuário do
                paciente com seu carimbo médico e data/hora oficial de emissão.
              </p>
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                Após a emissão, o documento não poderá mais ser editado
                diretamente, apenas retificado por um novo documento vinculado.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isIssuing} className="border-border">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmIssue}
              disabled={isIssuing}
            >
              {isIssuing ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  Emitindo...
                </>
              ) : (
                "Confirmar emissão"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancellation Justification Dialog: Void Document */}
      <AlertDialog open={isVoidDialogOpen} onOpenChange={setIsVoidDialogOpen}>
        <AlertDialogContent className="bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">
              Anular documento oficial
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Esta ação é irreversível. O documento será marcado como anulado e
              perderá sua validade legal e clínica no prontuário.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 py-2">
            <div className="flex items-center justify-between text-xs">
              <label
                htmlFor="void-reason-input"
                className="font-medium text-foreground"
              >
                Justificativa obrigatória *
              </label>
              <span
                className={`text-2xs ${
                  voidReason.trim().length < 10
                    ? "text-muted-foreground"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}
              >
                {voidReason.trim().length} / 10 caracteres mínimos
              </span>
            </div>
            <Textarea
              id="void-reason-input"
              rows={4}
              placeholder="Descreva o motivo detalhado para anulação deste documento (mínimo de 10 caracteres)..."
              value={voidReason}
              onChange={(e) => {
                setVoidReason(e.target.value);
                if (voidReasonError) setVoidReasonError(null);
              }}
              className="border-border bg-background text-foreground text-xs leading-relaxed"
            />
            {voidReasonError && (
              <p className="text-xs font-medium text-destructive">
                {voidReasonError}
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isVoiding} className="border-border">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmVoid}
              disabled={isVoiding || voidReason.trim().length < 10}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isVoiding ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  Anulando...
                </>
              ) : (
                "Anular documento"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
