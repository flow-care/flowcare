"use client";

import {
  AlertTriangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InboxIcon,
  Loader2Icon,
  RotateCcwIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  canRetryMessage,
  describeMessageFailure,
  ensureMaskedPhone,
  formatMessageDate,
  MESSAGE_PERIOD_FILTERS,
  MESSAGE_STATUS_FILTERS,
  type MessagePeriod,
  messageStatusPresentation,
  messageTypeLabel,
  newIdempotencyKey,
  type WhatsAppMessageItem,
  type WhatsAppMessageStatus,
  whatsappTabHref,
} from "@/lib/whatsapp";
import { resendMessageAction } from "./actions";

export interface MessageRow extends WhatsAppMessageItem {
  patientName: string | null;
}

interface MessagesViewProps {
  orgSlug: string;
  items: MessageRow[];
  nextCursor: string | null;
  hasPreviousPage: boolean;
  filters: { status: "all" | WhatsAppMessageStatus; period: MessagePeriod };
  canResend: boolean;
}

function StatusBadge({ status }: { status: WhatsAppMessageStatus }) {
  const presentation = messageStatusPresentation(status);
  return (
    <Badge
      className={cn("px-2.5 font-semibold", presentation.className)}
      title={presentation.description}
    >
      {presentation.label}
    </Badge>
  );
}

export function MessagesView({
  orgSlug,
  items,
  nextCursor,
  hasPreviousPage,
  filters,
  canResend,
}: MessagesViewProps) {
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();
  const [details, setDetails] = useState<MessageRow | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const [requeued, setRequeued] = useState<ReadonlySet<string>>(new Set());

  // Synchronous lock: state updates are async, so two fast clicks could
  // otherwise both reach the server before the button re-renders as disabled.
  const lockRef = useRef(new Set<string>());
  // One key per message until the request settles. Reusing it on a network
  // retry lets the API deduplicate instead of queueing twice.
  const keysRef = useRef(new Map<string, string>());

  const buildHref = (
    next: Partial<{ status: string; period: string; cursor: string }>,
  ) =>
    whatsappTabHref(orgSlug, "messages", {
      status:
        (next.status ?? filters.status) === "all"
          ? undefined
          : (next.status ?? filters.status),
      period:
        (next.period ?? filters.period) === "all"
          ? undefined
          : (next.period ?? filters.period),
      cursor: next.cursor,
    });

  const navigate = (href: string) =>
    startNavigation(() => {
      router.push(href);
    });

  const retry = async (message: MessageRow) => {
    if (!canRetryMessage(message.status, canResend)) return;
    if (lockRef.current.has(message.id)) return;
    lockRef.current.add(message.id);
    setPendingIds((current) => new Set(current).add(message.id));

    let key = keysRef.current.get(message.id);
    if (!key) {
      key = newIdempotencyKey();
      keysRef.current.set(message.id, key);
    }

    try {
      const result = await resendMessageAction(orgSlug, message.id, key);
      if (result.ok) {
        keysRef.current.delete(message.id);
        setRequeued((current) => new Set(current).add(message.id));
        setDetails(null);
        toast.success("Mensagem reenfileirada para envio.");
        router.refresh();
        return;
      }
      if (result.code !== "UNAVAILABLE") keysRef.current.delete(message.id);
      toast.error(result.message);
      if (result.code === "MESSAGE_STATE_CONFLICT") router.refresh();
    } catch {
      toast.error("Não foi possível reenviar a mensagem. Tente novamente.");
    } finally {
      lockRef.current.delete(message.id);
      setPendingIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  };

  const effectiveStatus = (message: MessageRow): WhatsAppMessageStatus =>
    requeued.has(message.id) && message.status === "FAILED"
      ? "QUEUED"
      : message.status;

  const hasFilters = filters.status !== "all" || filters.period !== "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.status}
            onValueChange={(value) => navigate(buildHref({ status: value }))}
          >
            <SelectTrigger className="w-44" aria-label="Filtrar por status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MESSAGE_STATUS_FILTERS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.period}
            onValueChange={(value) => navigate(buildHref({ period: value }))}
          >
            <SelectTrigger className="w-48" aria-label="Filtrar por período">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MESSAGE_PERIOD_FILTERS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters ? (
            <Button asChild variant="ghost" size="sm">
              <Link href={whatsappTabHref(orgSlug, "messages")}>
                Limpar filtros
              </Link>
            </Button>
          ) : null}
          {isNavigating ? (
            <Loader2Icon
              className="size-4 animate-spin text-muted-foreground"
              aria-label="Carregando mensagens"
            />
          ) : null}
        </div>
        {filters.period !== "all" ? (
          <p className="text-xs text-muted-foreground">
            O período considera a data de envio; mensagens ainda na fila só
            aparecem em “Todo o período”.
          </p>
        ) : null}
      </div>

      {items.length === 0 ? (
        <Empty className="border border-dashed border-border bg-card/40 py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <InboxIcon className="size-6 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>Nenhuma mensagem no período</EmptyTitle>
            <EmptyDescription>
              {hasFilters
                ? "Nenhuma mensagem corresponde aos filtros selecionados."
                : "As mensagens de confirmação, lembrete e cancelamento enviadas aos pacientes aparecerão aqui."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div
          className={cn(
            "rounded-xl border border-border bg-card",
            isNavigating && "opacity-60",
          )}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Destinatário</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Enviada em</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((message) => {
                const status = effectiveStatus(message);
                const isPending = pendingIds.has(message.id);
                const showFailure =
                  status === "FAILED" || status === "UNCERTAIN";
                return (
                  <TableRow key={message.id}>
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {message.patientName ?? "Paciente"}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {ensureMaskedPhone(message.phoneMasked)}
                      </div>
                    </TableCell>
                    <TableCell>{messageTypeLabel(message.type)}</TableCell>
                    <TableCell className="tabular-nums">
                      {formatMessageDate(message.sentAt ?? message.createdAt)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        {showFailure ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setDetails(message)}
                            className="gap-1.5"
                          >
                            <AlertTriangleIcon
                              className="size-3.5"
                              aria-hidden
                            />
                            Ver motivo
                          </Button>
                        ) : null}
                        {canRetryMessage(status, canResend) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            aria-busy={isPending}
                            onClick={() => void retry(message)}
                            className="gap-1.5"
                          >
                            {isPending ? (
                              <Loader2Icon
                                className="size-3.5 animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <RotateCcwIcon className="size-3.5" aria-hidden />
                            )}
                            {isPending ? "Reenfileirando…" : "Tentar novamente"}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {hasPreviousPage || nextCursor ? (
        <div className="flex items-center justify-between">
          {hasPreviousPage ? (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={buildHref({})}>
                <ChevronLeftIcon className="size-4" aria-hidden />
                Primeira página
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {nextCursor ? (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={buildHref({ cursor: nextCursor })}>
                Próxima página
                <ChevronRightIcon className="size-4" aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      <FailureDialog
        message={details}
        canResend={canResend}
        isPending={details ? pendingIds.has(details.id) : false}
        onClose={() => setDetails(null)}
        onRetry={(message) => void retry(message)}
      />
    </div>
  );
}

function FailureDialog({
  message,
  canResend,
  isPending,
  onClose,
  onRetry,
}: {
  message: MessageRow | null;
  canResend: boolean;
  isPending: boolean;
  onClose: () => void;
  onRetry: (message: MessageRow) => void;
}) {
  const failure = message
    ? describeMessageFailure(message.errorCode, message.errorReason)
    : null;
  const presentation = message
    ? messageStatusPresentation(message.status)
    : null;

  return (
    <Dialog open={message !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{failure?.title}</DialogTitle>
          <DialogDescription>{failure?.hint}</DialogDescription>
        </DialogHeader>
        {message && presentation ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Destinatário</dt>
            <dd className="text-foreground">
              {message.patientName ?? "Paciente"} ·{" "}
              {ensureMaskedPhone(message.phoneMasked)}
            </dd>
            <dt className="text-muted-foreground">Tipo</dt>
            <dd>{messageTypeLabel(message.type)}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{presentation.label}</dd>
            {message.errorCode ? (
              <>
                <dt className="text-muted-foreground">Código técnico</dt>
                <dd className="font-mono text-xs">{message.errorCode}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {message?.status === "UNCERTAIN" ? (
          <p className="rounded-md bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
            {presentation?.description}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Fechar
          </Button>
          {message && canRetryMessage(message.status, canResend) ? (
            <Button
              type="button"
              disabled={isPending}
              onClick={() => onRetry(message)}
              className="gap-1.5"
            >
              {isPending ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
              ) : (
                <RotateCcwIcon className="size-4" aria-hidden />
              )}
              {isPending ? "Reenfileirando…" : "Tentar novamente"}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
