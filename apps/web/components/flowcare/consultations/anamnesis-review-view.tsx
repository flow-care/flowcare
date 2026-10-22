"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCheck,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  approveAnamnesisAction,
  getTranscriptionStatusAction,
  updateAnamnesisDraftAction,
} from "@/app/app/[orgSlug]/consultations/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
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
import { Textarea } from "@/components/ui/textarea";
import { isClinicalRole } from "@/lib/app-navigation";
import type { ConsultationDetail } from "@/server/consultations";
import {
  CLINICAL_ANAMNESIS_TOPICS,
  extractTopicsFromDraft,
  formatDoctorVerificationStamp,
  resolveTopicInitialValue,
  validateAnamnesisTopics,
} from "./anamnesis-review-utils";
import { formatDateTime } from "./format-date";

export interface AnamnesisReviewViewProps {
  orgSlug: string;
  consultation: ConsultationDetail;
  userRole?: string;
  onApproved?: () => void;
}

export function AnamnesisReviewView({
  orgSlug,
  consultation,
  userRole,
  onApproved,
}: AnamnesisReviewViewProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const isClinical = isClinicalRole(userRole);
  const isInitiallyApproved = consultation.anamnesisStatus === "APPROVED";

  // Transcrição original: mostra o texto que a IA ouviu, para o profissional
  // conferir antes de aprovar. Falha em silêncio (recurso acessório).
  const [transcript, setTranscript] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getTranscriptionStatusAction(orgSlug, consultation.id)
      .then((result) => {
        if (
          !cancelled &&
          result.success &&
          result.data?.status === "COMPLETED" &&
          result.data.text
        ) {
          setTranscript(result.data.text);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgSlug, consultation.id]);

  // Initial topics extracted from draft or snapshot or consultation fields
  const initialDraftTopics = useMemo(() => {
    return extractTopicsFromDraft(
      consultation.anamnesisDraft,
      consultation.anamnesisSnapshot,
      consultation.chiefComplaint,
      consultation.clinicalNotes,
    );
  }, [consultation]);

  // Topic values keyed by topic.key
  const [topics, setTopics] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const topic of CLINICAL_ANAMNESIS_TOPICS) {
      map[topic.key] = resolveTopicInitialValue(
        topic.key,
        initialDraftTopics,
        consultation.chiefComplaint,
        consultation.clinicalNotes,
      );
    }
    return map;
  });

  const [version, setVersion] = useState<number>(consultation.version ?? 0);
  const [isApproved, setIsApproved] = useState<boolean>(isInitiallyApproved);
  const [approvedAt, setApprovedAt] = useState<string | null>(
    consultation.approvedAt ?? null,
  );
  const [signedBy, setSignedBy] = useState<string | null>(
    consultation.signedBy ?? null,
  );
  const [snapshotHash, setSnapshotHash] = useState<string | null>(
    consultation.snapshotHash ?? null,
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Derived flags
  const isReadOnly = isApproved || !isClinical;

  // Verification details
  const { doctorName, registration } = formatDoctorVerificationStamp(
    consultation.professional,
    signedBy,
  );

  const handleTopicChange = (key: string, value: string) => {
    if (isReadOnly) return;
    setTopics((prev) => ({
      ...prev,
      [key]: value,
    }));
    // Clear transient validation error when user types
    if (validationError) setValidationError(null);
  };

  const handleSaveDraft = async () => {
    if (isReadOnly || isSaving) return;
    setIsSaving(true);
    setConflictError(null);
    setSaveSuccessMsg(null);
    setValidationError(null);

    const result = await updateAnamnesisDraftAction(orgSlug, consultation.id, {
      version,
      content: topics,
      chiefComplaint: topics.chief_complaint,
      clinicalNotes: topics.conduct,
    });

    setIsSaving(false);

    if (result.success && result.data) {
      setVersion(result.data.version ?? version + 1);
      const now = new Date();
      const timeStr = now.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      setSaveSuccessMsg(`Rascunho salvo com sucesso às ${timeStr}.`);
    } else {
      if (result.code === "CONFLICT") {
        setConflictError(
          result.error ||
            "Conflito de edição concorrente: este prontuário foi alterado por outra sessão. Recarregue os dados antes de salvar.",
        );
      } else {
        setConflictError(
          result.error || "Não foi possível salvar o rascunho da anamnese.",
        );
      }
    }
  };

  const handleOpenApproveDialog = () => {
    if (isReadOnly) return;
    // Validate required topics before opening confirmation
    const validation = validateAnamnesisTopics(topics);
    if (!validation.valid) {
      setValidationError(
        `Preencha todos os tópicos obrigatórios antes da aprovação clínica: ${validation.missingTopics.join(", ")}.`,
      );
      return;
    }

    setValidationError(null);
    setIsDialogOpen(true);
  };

  const handleConfirmApproval = async () => {
    if (isReadOnly || isApproving) return;
    setIsApproving(true);
    setConflictError(null);
    setValidationError(null);

    const result = await approveAnamnesisAction(orgSlug, consultation.id, {
      version,
      content: topics,
      chiefComplaint: topics.chief_complaint,
      clinicalNotes: topics.conduct,
    });

    setIsApproving(false);
    setIsDialogOpen(false);

    if (result.success && result.data) {
      setIsApproved(true);
      setVersion(result.data.version);
      setSignedBy(result.data.signedBy);
      setApprovedAt(result.data.approvedAt);
      setSnapshotHash(result.data.snapshotHash);
      setSaveSuccessMsg("Anamnese aprovada e homologada com sucesso!");
      startTransition(() => {
        router.refresh();
      });
      onApproved?.();
    } else {
      if (result.code === "CONFLICT") {
        setConflictError(
          result.error ||
            "Conflito de versão: a consulta foi modificada por outra sessão. Recarregue a página antes de aprovar.",
        );
      } else {
        setConflictError(
          result.error || "Não foi possível aprovar a anamnese.",
        );
      }
    }
  };

  const handleReload = () => {
    startTransition(() => {
      router.refresh();
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    });
  };

  return (
    <div className="flex flex-col gap-6" data-testid="anamnesis-review-view">
      {/* 1. Header & Status Card */}
      <Card className="border border-border shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FileCheck className="size-5 text-primary" />
                <CardTitle className="text-xl font-semibold text-foreground">
                  Revisão e Aprovação da Anamnese
                </CardTitle>
              </div>
              <CardDescription>
                {isApproved
                  ? "Prontuário homologado e assinado digitalmente em conformidade clínica."
                  : "Revise os tópicos clínicos estruturados pela IA, edite conforme necessário e aprove o prontuário."}
              </CardDescription>
            </div>

            <div className="flex items-center gap-2">
              <Badge
                variant={isApproved ? "default" : "secondary"}
                className={
                  isApproved
                    ? "bg-emerald-600 text-white hover:bg-emerald-600"
                    : "bg-secondary text-secondary-foreground"
                }
              >
                {isApproved ? "Aprovada e Imutável" : "Rascunho em Revisão"}
              </Badge>
              <Badge
                variant="outline"
                className="text-xs text-muted-foreground"
              >
                v{version}
              </Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* 2. Banner: Suggestion generated by AI (when NOT approved) */}
      {!isApproved && (
        <div
          className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-foreground shadow-2xs"
          data-testid="ai-suggestion-banner"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-5" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-foreground">
                Sugestão gerada por IA — requer validação médica
              </h4>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Os tópicos abaixo foram organizados a partir da gravação e
                transcrição do atendimento clínico. Como ferramenta de apoio ao
                diagnóstico, este conteúdo requer leitura atenta, correções e
                validação formal pelo médico responsável antes da assinatura
                definitiva.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 3. Banner: Approved & Verified Digital Stamp (when APPROVED) */}
      {isApproved && (
        <div
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-foreground shadow-2xs"
          data-testid="verified-stamp-banner"
        >
          <div className="flex items-start gap-3.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-6" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-base font-semibold text-emerald-950 dark:text-emerald-100">
                    Anamnese Aprovada e Homologada
                  </h4>
                  <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                    Documento Imutável
                  </Badge>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Lock className="size-3.5" />
                  <span>Edição bloqueada</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Este prontuário foi revisado, validado e congelado digitalmente.
                Nenhuma alteração posterior é permitida nos termos da resolução
                do CFM.
              </p>

              <div className="mt-3 grid grid-cols-1 gap-2.5 rounded-lg border border-emerald-500/20 bg-card/60 p-3.5 text-xs text-foreground sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <UserCheck className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <span className="font-semibold">Médico Responsável:</span>{" "}
                    <span>{doctorName}</span>
                    {registration && (
                      <span className="text-muted-foreground">
                        {" "}
                        ({registration})
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <span className="font-semibold">Data da Homologação:</span>{" "}
                    <span>{formatDateTime(approvedAt)}</span>
                  </div>
                </div>

                {snapshotHash && (
                  <div className="sm:col-span-2 flex items-center gap-2 pt-1 border-t border-emerald-500/10">
                    <span className="font-semibold shrink-0">
                      Integridade (SHA-256):
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground truncate">
                      {snapshotHash}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Concurrency Conflict Banner (409) */}
      {conflictError && (
        <div
          role="alert"
          aria-label="Conflito de edição concorrente"
          className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-foreground shadow-2xs"
          data-testid="conflict-error-banner"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <h4 className="text-sm font-semibold text-destructive">
                Conflito de edição concorrente
              </h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {conflictError}
              </p>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReload}
                  className="gap-2 text-xs border-destructive/40 hover:bg-destructive/10"
                >
                  <RefreshCw className="size-3.5" />
                  Recarregar e sincronizar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Non-clinical role read-only banner */}
      {!isClinical && !isApproved && (
        <div
          className="rounded-xl border border-border bg-muted/40 p-3.5 text-xs text-muted-foreground"
          data-testid="non-clinical-warning"
        >
          <div className="flex items-center gap-2">
            <Lock className="size-4 shrink-0" />
            <span>
              Visualização restrita em modo somente-leitura. Apenas médicos e
              profissionais habilitados possuem permissão para editar ou aprovar
              anamneses.
            </span>
          </div>
        </div>
      )}

      {/* 5b. Transcrição original do atendimento (somente leitura) */}
      {transcript && (
        <Card
          className="border-border shadow-xs"
          data-testid="transcription-panel"
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Sparkles className="size-4 text-muted-foreground" />
              Transcrição do atendimento
            </CardTitle>
            <CardDescription className="text-xs">
              Texto reconhecido a partir do áudio. Confira a fonte antes de
              aprovar a anamnese.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                Ver transcrição completa
              </summary>
              <Textarea
                readOnly
                rows={10}
                value={transcript}
                className="mt-2 text-xs leading-relaxed"
                aria-label="Transcrição do atendimento"
              />
            </details>
          </CardContent>
        </Card>
      )}

      {/* 6. Transient feedback messages */}
      {saveSuccessMsg && !conflictError && (
        <div
          className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
          data-testid="save-success-banner"
        >
          <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {validationError && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive"
          data-testid="validation-error-banner"
        >
          <AlertTriangle className="size-4 shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      {/* 7. Structured Clinical Topics Editor */}
      <div className="space-y-5">
        {CLINICAL_ANAMNESIS_TOPICS.map((topic, index) => {
          const value = topics[topic.key] || "";
          const isMissing =
            Boolean(validationError) && topic.required && !value.trim();

          return (
            <Card
              key={topic.key}
              className={`border transition-all ${
                isMissing
                  ? "border-destructive ring-1 ring-destructive/40"
                  : "border-border shadow-xs"
              }`}
              data-testid={`topic-card-${topic.key}`}
            >
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <CardTitle className="text-base font-semibold text-foreground">
                      {topic.label}
                    </CardTitle>
                    {topic.required && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-medium border-primary/30 text-primary"
                      >
                        Obrigatório
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="text-xs">
                    {topic.description}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={value}
                  onChange={(e) => handleTopicChange(topic.key, e.target.value)}
                  readOnly={isReadOnly}
                  disabled={isReadOnly}
                  placeholder={
                    isReadOnly
                      ? "Nenhum registro informado para este tópico."
                      : topic.placeholder
                  }
                  rows={4}
                  data-testid={`topic-input-${topic.key}`}
                  className={`min-h-[100px] resize-y text-sm leading-relaxed ${
                    isReadOnly
                      ? "bg-muted/30 text-foreground cursor-default border-border/80 focus-visible:border-border"
                      : "bg-card text-foreground focus-visible:border-primary"
                  }`}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* 8. Action Footer (only visible when NOT approved and clinical role) */}
      {!isApproved && isClinical && (
        <Card className="border border-border shadow-xs">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-foreground">
                Finalizar atendimento e congelar prontuário
              </p>
              <p className="text-xs text-muted-foreground">
                Ao clicar em aprovar, o prontuário será homologado e não poderá
                mais ser modificado.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="default"
                disabled={isSaving || isApproving}
                onClick={handleSaveDraft}
                className="gap-2"
                data-testid="save-draft-button"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Salvando rascunho...</span>
                  </>
                ) : (
                  <>
                    <Save className="size-4" />
                    <span>Salvar rascunho</span>
                  </>
                )}
              </Button>

              <AlertDialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="default"
                    size="default"
                    disabled={isSaving || isApproving}
                    onClick={handleOpenApproveDialog}
                    className="gap-2 shadow-sm"
                    data-testid="approve-anamnesis-button"
                  >
                    {isApproving ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span>Aprovando...</span>
                      </>
                    ) : (
                      <>
                        <FileCheck className="size-4" />
                        <span>Aprovar anamnese</span>
                      </>
                    )}
                  </Button>
                </AlertDialogTrigger>

                <AlertDialogContent data-testid="approval-dialog">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Aprovar e homologar anamnese clínica
                    </AlertDialogTitle>
                    <AlertDialogDescription className="space-y-3">
                      <span>
                        Você está prestes a aprovar formalmente esta anamnese.
                        Ao confirmar, o prontuário será congelado de forma
                        definitiva e se tornará estritamente somente-leitura com
                        carimbo digital de auditoria.
                      </span>

                      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-foreground space-y-1">
                        <div>
                          <span className="font-semibold">
                            Profissional responsável:
                          </span>{" "}
                          <span>{doctorName}</span>
                        </div>
                        {registration && (
                          <div>
                            <span className="font-semibold">
                              Registro profissional:
                            </span>{" "}
                            <span>{registration}</span>
                          </div>
                        )}
                        <div>
                          <span className="font-semibold">
                            Paciente atendido:
                          </span>{" "}
                          <span>
                            {consultation.patient?.fullName || "Paciente"}
                          </span>
                        </div>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>

                  <AlertDialogFooter>
                    <AlertDialogCancel
                      disabled={isApproving}
                      data-testid="dialog-cancel-button"
                    >
                      Cancelar
                    </AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isApproving}
                      onClick={handleConfirmApproval}
                      data-testid="dialog-confirm-button"
                    >
                      {isApproving ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          Aprovando...
                        </>
                      ) : (
                        "Confirmar e aprovar"
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
