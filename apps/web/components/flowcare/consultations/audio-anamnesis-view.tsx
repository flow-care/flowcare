"use client";

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileAudio,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  completeAudioUploadAction,
  getAudioPresignedUrlAction,
  getTranscriptionStatusAction,
  startTranscriptionAction,
} from "@/app/app/[orgSlug]/consultations/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConsultationDetail } from "@/server/consultations";
import {
  formatAudioDuration,
  formatFileSize,
  generateIdempotencyKey,
  normalizeAudioContentType,
  validateAudioFile,
} from "./audio-anamnesis-utils";

export type RecorderState =
  | "idle"
  | "recording"
  | "paused"
  | "stopped"
  | "permission_denied";

export type PipelineStage =
  | "idle"
  | "uploading"
  | "transcribing"
  | "structuring"
  | "completed"
  | "error";

export interface AudioAnamnesisViewProps {
  orgSlug: string;
  consultation: ConsultationDetail;
  onSuccess?: () => void;
}

export function AudioAnamnesisView({
  orgSlug,
  consultation,
  onSuccess,
}: AudioAnamnesisViewProps) {
  // Consent Gate
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  // Recorder State
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [recordTimerSeconds, setRecordTimerSeconds] = useState(0);
  const [recordedAudioBlob, setRecordedAudioBlob] = useState<Blob | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [recorderError, setRecorderError] = useState<string | null>(null);

  // File Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileAudioUrl, setFileAudioUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Pipeline Feedback State
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>("idle");
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    generateIdempotencyKey(),
  );

  // Active audio to submit: "recording" or "file"
  const [submissionSource, setSubmissionSource] = useState<
    "recorder" | "file" | null
  >(null);

  // MediaRecorder refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // beforeunload protection
  useEffect(() => {
    if (recorderState === "recording" || recorderState === "paused") {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = "";
      };
      window.addEventListener("beforeunload", handleBeforeUnload);
      return () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
    }
  }, [recorderState]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
      if (fileAudioUrl) URL.revokeObjectURL(fileAudioUrl);
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getTracks()) {
          track.stop();
        }
      }
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
      }
    };
  }, [recordedAudioUrl, fileAudioUrl]);

  // Timer runner
  const startTimer = useCallback(() => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setRecordTimerSeconds((prev) => prev + 1);
    }, 1000);
  }, []);

  const pauseTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  // Voice Recorder Controls
  const startRecording = async () => {
    if (!consentConfirmed) {
      setRecorderError(
        "Consentimento do paciente é obrigatório para iniciar a gravação.",
      );
      return;
    }

    setRecorderError(null);

    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        setRecorderError(
          "Gravação de áudio não é suportada neste navegador ou ambiente.",
        );
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Select supported mimeType
      const mimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ];
      let supportedMime = "";
      for (const m of mimeTypes) {
        if (MediaRecorder.isTypeSupported(m)) {
          supportedMime = m;
          break;
        }
      }

      const options = supportedMime ? { mimeType: supportedMime } : undefined;
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const mime = supportedMime || "audio/webm";
        const blob = new Blob(audioChunksRef.current, { type: mime });
        setRecordedAudioBlob(blob);
        if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
        const url = URL.createObjectURL(blob);
        setRecordedAudioUrl(url);
        setRecorderState("stopped");
        stopTimer();
      };

      mediaRecorder.start(250); // Slice chunks every 250ms
      setRecorderState("recording");
      setRecordTimerSeconds(0);
      startTimer();
    } catch (err: unknown) {
      const error = err as Error;
      if (
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
      ) {
        setRecorderState("permission_denied");
        setRecorderError(
          "Permissão de microfone bloqueada pelo navegador. Conceda acesso ao microfone nas configurações do navegador para gravar a consulta.",
        );
      } else {
        setRecorderError(
          error.message || "Erro ao inicializar o microfone de gravação.",
        );
      }
    }
  };

  const pauseRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "recording"
    ) {
      mediaRecorderRef.current.pause();
      setRecorderState("paused");
      pauseTimer();
    }
  };

  const resumeRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === "paused"
    ) {
      mediaRecorderRef.current.resume();
      setRecorderState("recording");
      startTimer();
    }
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      (mediaRecorderRef.current.state === "recording" ||
        mediaRecorderRef.current.state === "paused")
    ) {
      mediaRecorderRef.current.stop();
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getTracks()) {
          track.stop();
        }
      }
      pauseTimer();
    }
  };

  const discardRecording = () => {
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    audioChunksRef.current = [];
    stopTimer();
    setRecordTimerSeconds(0);
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
    }
    setRecordedAudioBlob(null);
    setRecorderState("idle");
    setRecorderError(null);
  };

  // File Upload Handlers
  const handleFileSelection = (file: File) => {
    if (!consentConfirmed) {
      setFileError(
        "Consentimento do paciente é obrigatório para enviar o áudio.",
      );
      return;
    }

    const validation = validateAudioFile(file);
    if (!validation.valid) {
      setFileError(validation.error || "Arquivo de áudio inválido.");
      setSelectedFile(null);
      if (fileAudioUrl) {
        URL.revokeObjectURL(fileAudioUrl);
        setFileAudioUrl(null);
      }
      return;
    }

    setFileError(null);
    setSelectedFile(file);
    if (fileAudioUrl) URL.revokeObjectURL(fileAudioUrl);
    setFileAudioUrl(URL.createObjectURL(file));
  };

  const discardFile = () => {
    setSelectedFile(null);
    if (fileAudioUrl) {
      URL.revokeObjectURL(fileAudioUrl);
      setFileAudioUrl(null);
    }
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Pipeline Execution
  const executePipeline = async (
    audioBlob: Blob,
    fileName: string,
    contentType: string,
    keyToUse: string,
  ) => {
    setPipelineError(null);

    try {
      // Stage 1: Enviando gravação de áudio...
      setPipelineStage("uploading");
      setPipelineProgress(25);

      const normalizedType = normalizeAudioContentType(contentType, fileName);
      const presignedRes = await getAudioPresignedUrlAction(
        orgSlug,
        consultation.id,
        {
          fileName,
          contentType: normalizedType,
          sizeBytes: audioBlob.size,
        },
      );

      if (!presignedRes.success || !presignedRes.data) {
        throw new Error(
          presignedRes.error ||
            "Não foi possível obter a URL para upload do áudio.",
        );
      }

      const { uploadUrl, audioId } = presignedRes.data;

      // Upload audio bytes to presigned URL
      let uploadSuccessful = false;
      try {
        const uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": normalizedType,
          },
          body: audioBlob,
        });

        if (uploadResponse.ok) {
          uploadSuccessful = true;
        }
      } catch {
        uploadSuccessful = false;
      }

      // Finalize audio upload in backend
      if (uploadSuccessful && audioId) {
        await completeAudioUploadAction(orgSlug, consultation.id, audioId);
      }

      setPipelineProgress(50);

      // Stage 2: Transcrevendo voz com inteligência artificial...
      setPipelineStage("transcribing");
      setPipelineProgress(65);

      const startJobRes = await startTranscriptionAction(
        orgSlug,
        consultation.id,
        {
          audioUrl: uploadUrl,
          consentConfirmed: true,
          idempotencyKey: keyToUse,
        },
      );

      if (!startJobRes.success || !startJobRes.data) {
        throw new Error(
          startJobRes.error ||
            "Não foi possível iniciar o processamento da IA.",
        );
      }

      // Stage 3: Estruturando tópicos clínicos...
      setPipelineStage("structuring");
      setPipelineProgress(85);

      // Status polling (up to 5 attempts with delay)
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const statusRes = await getTranscriptionStatusAction(
          orgSlug,
          consultation.id,
        );

        if (statusRes.success && statusRes.data) {
          if (statusRes.data.status === "COMPLETED") {
            break;
          }
          if (statusRes.data.status === "FAILED") {
            throw new Error(
              statusRes.data.error ||
                "A transcrição automática da IA falhou durante o processamento.",
            );
          }
        }
      }

      // Transition to completed
      setPipelineProgress(100);
      setPipelineStage("completed");

      // Redirect after brief delay
      setTimeout(() => {
        onSuccess?.();
      }, 1200);
    } catch (err: unknown) {
      setPipelineStage("error");
      const error = err as Error;
      setPipelineError(
        error.message ||
          "Erro inesperado durante o processamento da anamnese. Tente novamente.",
      );
    }
  };

  const handleStartSubmit = (source: "recorder" | "file") => {
    setSubmissionSource(source);
    const key = generateIdempotencyKey();
    setIdempotencyKey(key);

    if (source === "recorder" && recordedAudioBlob) {
      executePipeline(
        recordedAudioBlob,
        "gravacao-consulta.webm",
        recordedAudioBlob.type || "audio/webm",
        key,
      );
    } else if (source === "file" && selectedFile) {
      executePipeline(selectedFile, selectedFile.name, selectedFile.type, key);
    }
  };

  const handleRetrySubmit = () => {
    if (submissionSource === "recorder" && recordedAudioBlob) {
      executePipeline(
        recordedAudioBlob,
        "gravacao-consulta.webm",
        recordedAudioBlob.type || "audio/webm",
        idempotencyKey,
      );
    } else if (submissionSource === "file" && selectedFile) {
      executePipeline(
        selectedFile,
        selectedFile.name,
        selectedFile.type,
        idempotencyKey,
      );
    }
  };

  // Pipeline in progress / modal view
  if (pipelineStage !== "idle") {
    return (
      <Card className="border border-border shadow-xs">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" />
            <CardTitle className="text-lg font-semibold">
              Processamento Clínico Inteligente
            </CardTitle>
          </div>
          <CardDescription>
            Processando o áudio clínico para geração estruturada da anamnese.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Etapas do Pipeline</span>
              <span className="font-medium font-mono">{pipelineProgress}%</span>
            </div>
            <Progress value={pipelineProgress} className="h-2" />
          </div>

          {/* Stages list */}
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            {/* Step 1 */}
            <div className="flex items-center gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full">
                {pipelineStage === "uploading" ? (
                  <Loader2 className="size-5 animate-spin text-primary" />
                ) : pipelineProgress > 25 ? (
                  <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <div className="size-2.5 rounded-full bg-muted-foreground/30" />
                )}
              </div>
              <div className="flex-1">
                <p
                  className={`text-sm font-medium ${
                    pipelineStage === "uploading"
                      ? "text-primary"
                      : pipelineProgress > 25
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  1. Enviando gravação de áudio...
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex items-center gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full">
                {pipelineStage === "transcribing" ? (
                  <Loader2 className="size-5 animate-spin text-primary" />
                ) : pipelineProgress > 65 ? (
                  <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <div className="size-2.5 rounded-full bg-muted-foreground/30" />
                )}
              </div>
              <div className="flex-1">
                <p
                  className={`text-sm font-medium ${
                    pipelineStage === "transcribing"
                      ? "text-primary"
                      : pipelineProgress > 65
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  2. Transcrevendo voz com inteligência artificial...
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex items-center gap-3">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full">
                {pipelineStage === "structuring" ? (
                  <Loader2 className="size-5 animate-spin text-primary" />
                ) : pipelineStage === "completed" ? (
                  <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <div className="size-2.5 rounded-full bg-muted-foreground/30" />
                )}
              </div>
              <div className="flex-1">
                <p
                  className={`text-sm font-medium ${
                    pipelineStage === "structuring"
                      ? "text-primary"
                      : pipelineStage === "completed"
                        ? "text-foreground"
                        : "text-muted-foreground"
                  }`}
                >
                  3. Estruturando tópicos clínicos...
                </p>
              </div>
            </div>
          </div>

          {/* Success state */}
          {pipelineStage === "completed" && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
              <div className="flex flex-col items-center gap-2">
                <CheckCircle2 className="size-8 text-emerald-600 dark:text-emerald-400" />
                <h4 className="text-base font-semibold text-emerald-950 dark:text-emerald-100">
                  Anamnese gerada com sucesso!
                </h4>
                <p className="text-xs text-muted-foreground">
                  Redirecionando para a aba de revisão dos tópicos clínicos...
                </p>
              </div>
            </div>
          )}

          {/* Error state */}
          {pipelineStage === "error" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="size-5 shrink-0 text-destructive" />
                  <div>
                    <h4 className="text-sm font-semibold text-destructive">
                      Falha no processamento da anamnese
                    </h4>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {pipelineError ||
                        "Não foi possível concluir a transcrição e estruturação dos tópicos."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setPipelineStage("idle");
                    setPipelineError(null);
                  }}
                >
                  Voltar e ajustar
                </Button>
                <Button
                  variant="default"
                  className="gap-2"
                  onClick={handleRetrySubmit}
                >
                  <RotateCcw className="size-4" />
                  Tentar novamente
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Patient Consent Gate */}
      <Card className="border border-border shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Termo de Consentimento para Gravação
          </CardTitle>
          <CardDescription>
            Exigência legal e ética para gravação de voz em consultas clínicas.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg border border-border/70 bg-muted/20 p-4">
            <Checkbox
              id="consent-checkbox"
              checked={consentConfirmed}
              onCheckedChange={(checked) =>
                setConsentConfirmed(Boolean(checked))
              }
              className="mt-0.5"
            />
            <div className="space-y-1">
              <label
                htmlFor="consent-checkbox"
                className="cursor-pointer text-sm font-medium leading-relaxed text-foreground select-none"
              >
                Declaro que o paciente forneceu consentimento formal para a
                gravação do áudio da consulta para fins de transcrição clínica.
              </label>
              <p className="text-xs text-muted-foreground">
                O áudio gravado ou enviado é restrito ao atendimento e
                processado sob criptografia em conformidade com as diretrizes de
                proteção de dados de saúde.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Recording & Upload Section */}
      <Tabs defaultValue="recorder" className="w-full space-y-4">
        <div className="flex items-center justify-between">
          <TabsList className="bg-muted p-1">
            <TabsTrigger value="recorder" className="gap-2 text-xs">
              <Mic className="size-3.5" />
              <span>Gravar pelo Navegador</span>
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-2 text-xs">
              <UploadCloud className="size-3.5" />
              <span>Enviar Arquivo de Áudio</span>
            </TabsTrigger>
          </TabsList>

          {!consentConfirmed && (
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-xs"
            >
              Consentimento obrigatório
            </Badge>
          )}
        </div>

        {/* Tab A: Voice Recorder */}
        <TabsContent value="recorder" className="outline-none">
          <Card className="border border-border shadow-xs">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Mic className="size-4 text-primary" />
                Gravador de Voz da Consulta
              </CardTitle>
              <CardDescription>
                Utilize o microfone para capturar o áudio durante a consulta em
                tempo real.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Permission Denied Alert */}
              {recorderState === "permission_denied" && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4">
                  <div className="flex items-start gap-3">
                    <MicOff className="size-5 shrink-0 text-destructive" />
                    <div className="flex-1 space-y-2">
                      <h4 className="text-sm font-semibold text-destructive">
                        Acesso ao microfone não autorizado
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Permissão de microfone bloqueada pelo navegador. Conceda
                        acesso ao microfone nas configurações do navegador para
                        gravar a consulta.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 text-xs"
                        onClick={startRecording}
                      >
                        <RotateCcw className="size-3.5" />
                        Tentar permitir novamente
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* General Recorder Error */}
              {recorderError && recorderState !== "permission_denied" && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="size-4" />
                    {recorderError}
                  </div>
                </div>
              )}

              {/* Recording Body */}
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center sm:p-10">
                {/* State: Idle */}
                {recorderState === "idle" && (
                  <div className="flex flex-col items-center space-y-3">
                    <div className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary shadow-inner">
                      <Mic className="size-8" />
                    </div>
                    <h3 className="text-base font-semibold text-foreground">
                      Pronto para iniciar gravação
                    </h3>
                    <p className="max-w-md text-xs text-muted-foreground">
                      Clique no botão abaixo para começar a capturar a conversa
                      clínica. É necessário autorizar o uso do microfone no
                      navegador.
                    </p>
                    <div className="pt-2">
                      <Button
                        disabled={!consentConfirmed}
                        onClick={startRecording}
                        className="gap-2 shadow-sm"
                      >
                        <Mic className="size-4" />
                        Gravar
                      </Button>
                    </div>
                  </div>
                )}

                {/* State: Recording */}
                {recorderState === "recording" && (
                  <div className="flex flex-col items-center space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="relative flex size-3">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-75" />
                        <span className="relative inline-flex size-3 rounded-full bg-destructive" />
                      </span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-destructive">
                        Gravando áudio
                      </span>
                    </div>

                    <div className="font-mono text-4xl font-bold tracking-tight text-foreground">
                      {formatAudioDuration(recordTimerSeconds)}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Captura em andamento. Não feche nem recarregue esta aba.
                    </p>

                    <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={pauseRecording}
                      >
                        <Pause className="size-4" />
                        Pausar
                      </Button>
                      <Button
                        variant="default"
                        className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={stopRecording}
                      >
                        <Square className="size-4" />
                        Parar
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        title="Descartar gravação"
                        onClick={discardRecording}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* State: Paused */}
                {recorderState === "paused" && (
                  <div className="flex flex-col items-center space-y-4">
                    <Badge
                      variant="outline"
                      className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    >
                      Gravação pausada
                    </Badge>

                    <div className="font-mono text-4xl font-bold tracking-tight text-foreground/80">
                      {formatAudioDuration(recordTimerSeconds)}
                    </div>

                    <p className="text-xs text-muted-foreground">
                      A gravação está pausada. Retome quando desejar continuar.
                    </p>

                    <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                      <Button
                        variant="default"
                        className="gap-2"
                        onClick={resumeRecording}
                      >
                        <Play className="size-4" />
                        Retomar
                      </Button>
                      <Button
                        variant="outline"
                        className="gap-2"
                        onClick={stopRecording}
                      >
                        <Square className="size-4" />
                        Parar
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        title="Descartar gravação"
                        onClick={discardRecording}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* State: Stopped / Preview */}
                {recorderState === "stopped" && (
                  <div className="w-full max-w-md flex flex-col items-center space-y-4">
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="size-5" />
                      <span className="text-sm font-semibold">
                        Gravação concluída (
                        {formatAudioDuration(recordTimerSeconds)})
                      </span>
                    </div>

                    {recordedAudioUrl && (
                      <div className="w-full space-y-1.5 text-left">
                        <span className="text-xs font-medium text-muted-foreground">
                          Ouvir áudio gravado
                        </span>
                        <audio
                          controls
                          src={recordedAudioUrl}
                          className="h-10 w-full"
                        >
                          <track kind="captions" />
                        </audio>
                      </div>
                    )}

                    <div className="flex w-full items-center justify-between gap-3 pt-3">
                      <Button
                        variant="outline"
                        className="gap-1.5"
                        onClick={discardRecording}
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                        Descartar
                      </Button>
                      <Button
                        variant="default"
                        className="gap-2"
                        disabled={!recordedAudioBlob || !consentConfirmed}
                        onClick={() => handleStartSubmit("recorder")}
                      >
                        <Sparkles className="size-4" />
                        Gerar Anamnese com IA
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab B: File Upload */}
        <TabsContent value="upload" className="outline-none">
          <Card className="border border-border shadow-xs">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <UploadCloud className="size-4 text-primary" />
                Upload de Arquivo de Áudio
              </CardTitle>
              <CardDescription>
                Envie um arquivo previamente gravado nos formatos MP3, WAV, M4A
                ou WebM (até 50MB).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* File Error */}
              {fileError && (
                <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  <div className="flex items-center gap-2 font-medium">
                    <AlertTriangle className="size-4" />
                    {fileError}
                  </div>
                </div>
              )}

              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp3,.wav,.m4a,.webm,audio/mpeg,audio/wav,audio/mp4,audio/webm"
                className="hidden"
                disabled={!consentConfirmed}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileSelection(file);
                }}
              />

              {!selectedFile ? (
                /* biome-ignore lint/a11y/useSemanticElements: dropzone container wraps nested action button */
                <div
                  role="button"
                  aria-label="Área para envio de arquivo de áudio"
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (consentConfirmed) setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFileSelection(file);
                  }}
                  className={`flex flex-col items-center justify-center rounded-xl border border-dashed p-8 text-center transition-colors sm:p-10 ${
                    isDragOver
                      ? "border-primary bg-primary/5"
                      : "border-border bg-muted/20"
                  } ${!consentConfirmed ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
                  onClick={() => {
                    if (consentConfirmed) fileInputRef.current?.click();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && consentConfirmed) {
                      fileInputRef.current?.click();
                    }
                  }}
                  tabIndex={consentConfirmed ? 0 : -1}
                >
                  <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <UploadCloud className="size-7" />
                  </div>
                  <h4 className="mt-3 text-sm font-semibold text-foreground">
                    Arraste o arquivo de áudio ou clique para selecionar
                  </h4>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    Formatos aceitos: MP3, WAV, M4A ou WebM. Tamanho máximo:
                    50MB.
                  </p>
                  <div className="mt-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!consentConfirmed}
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      Selecionar Arquivo
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <FileAudio className="size-5" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {selectedFile.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(selectedFile.size)}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={discardFile}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>

                  {fileAudioUrl && (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">
                        Prévia do áudio
                      </span>
                      <audio
                        controls
                        src={fileAudioUrl}
                        className="h-10 w-full"
                      >
                        <track kind="captions" />
                      </audio>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                    <Button variant="outline" size="sm" onClick={discardFile}>
                      Trocar arquivo
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="gap-2"
                      disabled={!consentConfirmed}
                      onClick={() => handleStartSubmit("file")}
                    >
                      <Sparkles className="size-4" />
                      Gerar Anamnese com IA
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
