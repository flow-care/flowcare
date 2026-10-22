"use client";

import {
  AlertCircleIcon,
  CheckCircle2Icon,
  Loader2Icon,
  QrCodeIcon,
  RefreshCwIcon,
  SmartphoneIcon,
  WifiOffIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import {
  canRequestQr,
  connectionPresentation,
  formatConnectedPhone,
  formatCountdown,
  nextPollDelayMs,
  qrProgressPercent,
  qrRemainingSeconds,
  type StatusTone,
  type WhatsAppStatus,
  whatsappStatusSchema,
} from "@/lib/whatsapp";

interface ActiveQr {
  dataUrl: string;
  expiresAtMs: number;
  totalMs: number;
}

interface QrResponse {
  status: WhatsAppStatus["status"];
  phoneNumber: string | null;
  qrCode: string | null;
  qrExpiresInMs: number;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-muted text-muted-foreground",
};

const MAX_QR_ATTEMPTS = 4;
const QR_RETRY_DELAY_MS = 2_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function ConnectionPanel({
  orgSlug,
  initialStatus,
  initialError,
}: {
  orgSlug: string;
  initialStatus: WhatsAppStatus | null;
  initialError: string | null;
}) {
  const [status, setStatus] = useState<WhatsAppStatus | null>(initialStatus);
  const [commError, setCommError] = useState<string | null>(initialError);
  const [forbidden, setForbidden] = useState(false);
  const [qr, setQr] = useState<ActiveQr | null>(null);
  const [qrExpired, setQrExpired] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const statusRef = useRef<WhatsAppStatus["status"]>(
    initialStatus?.status ?? "DISCONNECTED",
  );
  const hasQrRef = useRef(false);
  const generatingRef = useRef(false);
  const mountedRef = useRef(true);
  const checkNowRef = useRef<() => void>(() => {});

  const statusUrl = `/api/organizations/${encodeURIComponent(orgSlug)}/whatsapp/status`;
  const qrUrl = `/api/organizations/${encodeURIComponent(orgSlug)}/whatsapp/qr`;

  useEffect(() => {
    statusRef.current = status?.status ?? statusRef.current;
  }, [status]);

  useEffect(() => {
    hasQrRef.current = qr !== null;
  }, [qr]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Status polling: no manual reload needed; paused while the tab is hidden.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(
        poll,
        nextPollDelayMs(statusRef.current, hasQrRef.current),
      );
    };

    async function poll() {
      if (stopped) return;
      if (document.visibilityState === "hidden") {
        schedule();
        return;
      }
      controller = new AbortController();
      try {
        const response = await fetch(statusUrl, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (stopped) return;
        if (response.ok) {
          const parsed = whatsappStatusSchema.safeParse(body);
          if (parsed.success) {
            setStatus(parsed.data);
            setCommError(null);
          } else {
            setCommError("Resposta inválida ao verificar o status.");
          }
        } else if (response.status === 403) {
          setForbidden(true);
        } else if (response.status === 401) {
          setCommError("Sua sessão expirou. Entre novamente para continuar.");
        } else {
          setCommError(
            "Não foi possível comunicar com o serviço de WhatsApp. Tentando novamente…",
          );
        }
      } catch {
        if (!stopped) {
          setCommError(
            "Sem comunicação com o servidor. Tentando novamente automaticamente…",
          );
        }
      } finally {
        if (!stopped) setIsChecking(false);
      }
      schedule();
    }

    const checkNow = () => {
      if (timer) clearTimeout(timer);
      controller?.abort();
      setIsChecking(true);
      void poll();
    };
    checkNowRef.current = checkNow;

    const onVisibility = () => {
      if (document.visibilityState === "visible") checkNow();
    };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [statusUrl]);

  // Countdown ticker, only while a QR code is on screen.
  useEffect(() => {
    if (!qr) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      if (now >= qr.expiresAtMs) {
        // Drop the credential from memory as soon as it expires.
        setQr(null);
        setQrExpired(true);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [qr]);

  // Pairing finished on the phone: remove any leftover QR code.
  const isConnected = status?.status === "CONNECTED";
  useEffect(() => {
    if (!isConnected) return;
    setQrExpired(false);
    if (hasQrRef.current) toast.success("WhatsApp conectado com sucesso.");
    setQr(null);
  }, [isConnected]);

  const generateQr = useCallback(async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setIsGenerating(true);
    setQrExpired(false);
    setQr(null);

    try {
      for (let attempt = 1; attempt <= MAX_QR_ATTEMPTS; attempt++) {
        const response = await fetch(qrUrl, {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
        });
        const body = (await response.json().catch(() => null)) as
          | (Partial<QrResponse> & { message?: string })
          | null;
        if (!mountedRef.current) return;

        if (!response.ok) {
          if (response.status === 403) {
            setForbidden(true);
          } else {
            const message =
              body?.message ??
              "Não foi possível gerar o QR Code. Tente novamente.";
            setCommError(message);
            toast.error(message);
          }
          return;
        }

        const session = body as QrResponse | null;
        if (!session?.status) {
          toast.error("Resposta inválida ao gerar o QR Code.");
          return;
        }
        setStatus({ status: session.status, phoneNumber: session.phoneNumber });
        setCommError(null);

        if (session.status === "CONNECTED") {
          toast.success("Este WhatsApp já está conectado.");
          return;
        }
        if (session.qrCode && session.qrExpiresInMs > 0) {
          const now = Date.now();
          setNowMs(now);
          setQr({
            dataUrl: session.qrCode,
            expiresAtMs: now + session.qrExpiresInMs,
            totalMs: session.qrExpiresInMs,
          });
          return;
        }
        // The provider is still starting the session; ask again shortly.
        if (attempt < MAX_QR_ATTEMPTS) await sleep(QR_RETRY_DELAY_MS);
      }
      toast.info(
        "O serviço ainda está preparando a sessão. Clique em “Gerar QR Code” novamente em instantes.",
      );
    } catch {
      if (mountedRef.current) {
        const message =
          "Não foi possível comunicar com o servidor. Tente novamente.";
        setCommError(message);
        toast.error(message);
      }
    } finally {
      generatingRef.current = false;
      if (mountedRef.current) setIsGenerating(false);
    }
  }, [qrUrl]);

  if (forbidden) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground"
      >
        Apenas administradores da clínica podem conectar ou recuperar a sessão
        do WhatsApp.
      </div>
    );
  }

  const presentation = status ? connectionPresentation(status.status) : null;
  const remainingSeconds = qr ? qrRemainingSeconds(qr.expiresAtMs, nowMs) : 0;
  const remainingMs = qr ? Math.max(0, qr.expiresAtMs - nowMs) : 0;
  const showGenerate = !status || canRequestQr(status.status);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <SmartphoneIcon className="size-5 text-primary" aria-hidden />
              <CardTitle>Conexão do WhatsApp</CardTitle>
            </div>
            {presentation ? (
              <Badge
                className={cn(
                  "px-2.5 py-0.5 text-xs font-semibold",
                  TONE_CLASSES[presentation.tone],
                )}
                data-testid="whatsapp-status-badge"
              >
                {isConnected ? (
                  <CheckCircle2Icon aria-hidden />
                ) : status?.status === "ERROR" ? (
                  <AlertCircleIcon aria-hidden />
                ) : status?.status === "CONNECTING" ? (
                  <Loader2Icon className="animate-spin" aria-hidden />
                ) : (
                  <WifiOffIcon aria-hidden />
                )}
                {presentation.label}
              </Badge>
            ) : (
              <Badge variant="outline">Verificando…</Badge>
            )}
          </div>
          <CardDescription aria-live="polite">
            {presentation?.description ??
              "Não foi possível verificar o status da instância."}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {commError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
            >
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{commError}</span>
            </div>
          ) : null}

          {isConnected ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Número vinculado
              </p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {formatConnectedPhone(status?.phoneNumber ?? null)}
              </p>
            </div>
          ) : null}

          {qr ? (
            <div
              className="flex flex-col items-center gap-4 rounded-xl border border-border bg-background p-5"
              data-testid="whatsapp-qr-active"
            >
              {/* biome-ignore lint/performance/noImgElement: inline base64 QR credential, must not go through the image optimizer cache */}
              <img
                src={qr.dataUrl}
                alt="QR Code para parear o WhatsApp da clínica"
                width={256}
                height={256}
                draggable={false}
                referrerPolicy="no-referrer"
                className="size-64 rounded-lg bg-white p-2"
              />
              <div className="w-full max-w-64 space-y-2 text-center">
                <p
                  className="text-sm font-medium text-foreground"
                  aria-live="off"
                >
                  Expira em{" "}
                  <span className="tabular-nums" data-testid="qr-countdown">
                    {formatCountdown(remainingSeconds)}
                  </span>
                </p>
                <Progress
                  value={qrProgressPercent(remainingMs, qr.totalMs)}
                  aria-label="Tempo restante do QR Code"
                />
                <p className="text-xs text-muted-foreground">
                  O QR Code é temporário. Leia-o antes de expirar.
                </p>
              </div>
            </div>
          ) : null}

          {qrExpired && !isConnected ? (
            <output className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <p className="font-medium text-foreground">O QR Code expirou.</p>
              <p className="mt-1 text-muted-foreground">
                Gere um novo QR Code para continuar o pareamento.
              </p>
            </output>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {showGenerate ? (
              <Button
                type="button"
                onClick={() => void generateQr()}
                disabled={isGenerating}
                className="gap-2"
              >
                {isGenerating ? (
                  <Loader2Icon className="size-4 animate-spin" aria-hidden />
                ) : qrExpired ? (
                  <RefreshCwIcon className="size-4" aria-hidden />
                ) : (
                  <QrCodeIcon className="size-4" aria-hidden />
                )}
                {isGenerating
                  ? "Gerando QR Code…"
                  : qrExpired
                    ? "Gerar novo QR Code"
                    : qr
                      ? "Gerar outro QR Code"
                      : "Gerar QR Code"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                checkNowRef.current();
              }}
              disabled={isChecking}
              className="gap-2 text-muted-foreground"
            >
              <RefreshCwIcon
                className={cn("size-4", isChecking && "animate-spin")}
                aria-hidden
              />
              Verificar status
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Como conectar ou reconectar
          </CardTitle>
          <CardDescription>
            Use o celular que ficará vinculado à clínica.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ol className="list-decimal space-y-2 pl-5 text-foreground">
            <li>Clique em “Gerar QR Code” nesta tela.</li>
            <li>
              No celular, abra o WhatsApp e vá em{" "}
              <strong>Configurações → Aparelhos conectados</strong>.
            </li>
            <li>
              Toque em <strong>Conectar um aparelho</strong> e aponte a câmera
              para o QR Code antes que ele expire.
            </li>
            <li>Aguarde: o status muda para “Conectado” automaticamente.</li>
          </ol>
          <div className="space-y-1.5 border-t border-border pt-4 text-muted-foreground">
            <p>
              <strong className="text-foreground">Perdeu a conexão?</strong>{" "}
              Verifique se o celular está ligado e com internet; se o status
              continuar “Desconectado”, gere um novo QR Code.
            </p>
            <p>
              Enquanto estiver desconectado, as mensagens ficam na fila e os
              agendamentos continuam funcionando normalmente.
            </p>
            <p>
              Para desconectar, remova o aparelho em{" "}
              <strong className="text-foreground">Aparelhos conectados</strong>{" "}
              no WhatsApp do celular.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
