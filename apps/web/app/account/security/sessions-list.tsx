"use client";

import {
  AlertCircle,
  Laptop,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import {
  type AccountSession,
  formatSessionDate,
  formatSessionDevice,
  formatSessionIp,
} from "@/lib/account-sessions";
import {
  getActiveSessionsAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
} from "./actions";

interface ActiveSessionsListProps {
  initialSessions: AccountSession[];
}

export function ActiveSessionsList({
  initialSessions,
}: ActiveSessionsListProps) {
  const router = useRouter();
  const [sessions, setSessions] = useState<AccountSession[]>(initialSessions);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [isRevokingOther, setIsRevokingOther] = useState(false);
  const [isPending, startTransition] = useTransition();

  const otherSessionsCount = sessions.filter((s) => !s.isCurrent).length;

  const refreshSessions = async () => {
    startTransition(async () => {
      const res = await getActiveSessionsAction();
      if (res.ok) {
        setSessions(res.sessions);
      } else {
        toast.error("Não foi possível atualizar a lista de sessões.");
      }
    });
  };

  const handleRevokeSingle = async (sessionId: string) => {
    setRevokingId(sessionId);
    try {
      const res = await revokeSessionAction(sessionId);
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        toast.success("Sessão remota encerrada com sucesso.");
        router.refresh();
      } else if (res.code === "NOT_FOUND") {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        toast.info("Esta sessão já havia sido encerrada ou expirado.");
      } else if (res.code === "UNAUTHENTICATED") {
        toast.error("Sua sessão expirou. Faça login novamente.");
      } else {
        toast.error("Não foi possível encerrar a sessão.");
      }
    } catch {
      toast.error("Erro inesperado ao encerrar a sessão.");
    } finally {
      setRevokingId(null);
    }
  };

  const handleRevokeOther = async () => {
    setIsRevokingOther(true);
    try {
      const res = await revokeOtherSessionsAction();
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.isCurrent));
        toast.success(
          `Todas as outras sessões (${res.revokedCount}) foram encerradas.`,
        );
        router.refresh();
      } else if (res.code === "UNAUTHENTICATED") {
        toast.error("Sua sessão expirou. Faça login novamente.");
      } else {
        toast.error("Não foi possível encerrar as outras sessões.");
      }
    } catch {
      toast.error("Erro inesperado ao encerrar as outras sessões.");
    } finally {
      setIsRevokingOther(false);
    }
  };

  const getDeviceIcon = (userAgent: string | null) => {
    const ua = (userAgent || "").toLowerCase();
    if (
      ua.includes("mobile") ||
      ua.includes("android") ||
      ua.includes("iphone")
    ) {
      return <Smartphone className="size-5 text-muted-foreground" />;
    }
    return <Laptop className="size-5 text-muted-foreground" />;
  };

  return (
    <Card className="rounded-xl border border-border bg-card">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-lg font-semibold">
            Sessões ativas
          </CardTitle>
          <CardDescription>
            Dispositivos e navegadores atualmente conectados à sua conta
            Flowcare.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refreshSessions}
            disabled={isPending}
            className="gap-1.5 text-xs"
          >
            <RefreshCw
              className={`size-3.5 ${isPending ? "animate-spin" : ""}`}
            />
            Atualizar
          </Button>

          {otherSessionsCount > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={isRevokingOther}
                  className="gap-1.5 text-xs"
                >
                  <ShieldAlert className="size-3.5" />
                  {isRevokingOther
                    ? "Encerrando..."
                    : "Encerrar todas as outras sessões"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Encerrar todas as outras sessões?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação desconectará imediatamente todos os outros
                    computadores e dispositivos conectados à sua conta. A sua
                    sessão atual permanecerá ativa.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleRevokeOther}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Encerrar outras sessões
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
            <AlertCircle className="size-8 mb-2" />
            <p className="text-sm">Nenhuma sessão ativa encontrada.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sessions.map((session) => (
              <div
                key={session.id}
                data-testid={`session-item-${session.id}`}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between first:pt-0 last:pb-0"
              >
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    {getDeviceIcon(session.userAgent)}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">
                        {formatSessionDevice(session.userAgent)}
                      </span>
                      {session.isCurrent && (
                        <Badge
                          variant="secondary"
                          className="bg-primary/10 text-primary border-primary/20 text-xs font-medium"
                        >
                          Sessão atual (este dispositivo)
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span>IP: {formatSessionIp(session.ipAddress)}</span>
                      <span>•</span>
                      <span>
                        Última atividade:{" "}
                        {formatSessionDate(session.lastActiveAt)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  {session.isCurrent ? (
                    <span className="text-xs text-muted-foreground italic">
                      Para sair deste dispositivo, use a opção Sair do menu.
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={revokingId === session.id}
                      onClick={() => handleRevokeSingle(session.id)}
                      className="gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive border-border"
                    >
                      <LogOut className="size-3.5" />
                      {revokingId === session.id
                        ? "Encerrando..."
                        : "Encerrar sessão"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
