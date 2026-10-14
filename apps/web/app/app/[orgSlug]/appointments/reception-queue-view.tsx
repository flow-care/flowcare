"use client";

import { cn } from "cn";
import {
  AlertCircleIcon,
  BellIcon,
  CheckCircle2Icon,
  ClockIcon,
  PlayIcon,
  RotateCwIcon,
  UserCheckIcon,
  UsersIcon,
  UserXIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  calculateWaitTimeMinutes,
  formatWaitTime,
  normalizeReceptionQueueStatus,
} from "@/lib/appointments";
import type {
  ReceptionQueueItem,
  ReceptionQueueStatus,
  ReceptionQueueTargetStatus,
} from "@/server/reception";
import {
  getReceptionQueueAction,
  updateReceptionQueueStatusAction,
} from "./actions";

interface ReceptionQueueViewProps {
  orgSlug: string;
  date: string;
  initialQueue?: ReceptionQueueItem[];
  initialError?: string | null;
}

export function ReceptionQueueView({
  orgSlug,
  date,
  initialQueue = [],
  initialError = null,
}: ReceptionQueueViewProps) {
  const [queue, setQueue] = useState<ReceptionQueueItem[]>(initialQueue);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingActionKey, setLoadingActionKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [activeFilter, setActiveFilter] = useState<
    "ALL" | "WAITING" | "PRESENT" | "IN_SERVICE" | "COMPLETED"
  >("ALL");

  const [now] = useState(() => new Date());

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const res = await getReceptionQueueAction(orgSlug, date);
      if (res.success) {
        setQueue(res.data);
      } else {
        setError(res.error);
      }
    } catch {
      setError("Não foi possível atualizar a fila da recepção.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTransition = async (
    item: ReceptionQueueItem,
    targetStatus: ReceptionQueueTargetStatus,
  ) => {
    if (loadingActionKey) return;

    const actionKey = `${item.id}-${targetStatus}`;
    setLoadingActionKey(actionKey);
    setError(null);

    const previousQueue = [...queue];

    // Optimistic update
    setQueue((prev) =>
      prev.map((i) => {
        if (i.id !== item.id && i.appointmentId !== item.appointmentId)
          return i;
        const nextStatus =
          targetStatus === "IN_CONSULTATION" ? "IN_SERVICE" : targetStatus;
        return {
          ...i,
          queueStatus: nextStatus as ReceptionQueueStatus,
          arrivedAt:
            nextStatus === "ARRIVED"
              ? (i.arrivedAt ?? new Date().toISOString())
              : i.arrivedAt,
          version: i.version + 1,
        };
      }),
    );

    try {
      if (item.queueStatus === "WAITING" && targetStatus === "CALLED") {
        // Step 1: Advance WAITING -> ARRIVED
        const step1 = await updateReceptionQueueStatusAction(
          orgSlug,
          item.appointmentId,
          "ARRIVED",
          item.version,
        );
        if (!step1.success) {
          throw new Error(step1.error);
        }
        // Step 2: Advance ARRIVED -> CALLED
        const step2 = await updateReceptionQueueStatusAction(
          orgSlug,
          item.appointmentId,
          "CALLED",
          step1.data.version,
        );
        if (!step2.success) {
          throw new Error(step2.error);
        }
        setQueue((prev) =>
          prev.map((i) =>
            i.id === item.id || i.appointmentId === item.appointmentId
              ? { ...i, ...step2.data }
              : i,
          ),
        );
      } else {
        const res = await updateReceptionQueueStatusAction(
          orgSlug,
          item.appointmentId,
          targetStatus,
          item.version,
        );
        if (!res.success) {
          throw new Error(res.error);
        }
        setQueue((prev) =>
          prev.map((i) =>
            i.id === item.id || i.appointmentId === item.appointmentId
              ? { ...i, ...res.data }
              : i,
          ),
        );
      }
    } catch (err) {
      setQueue(previousQueue);
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao atualizar status do paciente.",
      );
    } finally {
      setLoadingActionKey(null);
    }
  };

  // Group items by status
  const groups = useMemo(() => {
    const waiting: ReceptionQueueItem[] = [];
    const presentOrCalled: ReceptionQueueItem[] = [];
    const inService: ReceptionQueueItem[] = [];
    const completed: ReceptionQueueItem[] = [];

    const sortedQueue = [...queue].sort((a, b) =>
      a.scheduledAt.localeCompare(b.scheduledAt),
    );

    for (const item of sortedQueue) {
      if (item.queueStatus === "WAITING") {
        waiting.push(item);
      } else if (
        item.queueStatus === "ARRIVED" ||
        item.queueStatus === "CALLED"
      ) {
        presentOrCalled.push(item);
      } else if (item.queueStatus === "IN_SERVICE") {
        inService.push(item);
      } else {
        completed.push(item);
      }
    }

    return {
      waiting,
      presentOrCalled,
      inService,
      completed,
    };
  }, [queue]);

  const totalCount = queue.length;

  return (
    <div className="flex flex-col gap-6">
      {/* Action / Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card p-1 shadow-2xs">
          <Button
            variant={activeFilter === "ALL" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveFilter("ALL")}
            className="h-8 px-2.5 text-xs font-medium"
          >
            Todos ({totalCount})
          </Button>
          <Button
            variant={activeFilter === "WAITING" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveFilter("WAITING")}
            className="h-8 px-2.5 text-xs font-medium"
          >
            Aguardando ({groups.waiting.length})
          </Button>
          <Button
            variant={activeFilter === "PRESENT" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveFilter("PRESENT")}
            className="h-8 px-2.5 text-xs font-medium"
          >
            Presente / Chamado ({groups.presentOrCalled.length})
          </Button>
          <Button
            variant={activeFilter === "IN_SERVICE" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveFilter("IN_SERVICE")}
            className="h-8 px-2.5 text-xs font-medium"
          >
            Em atendimento ({groups.inService.length})
          </Button>
          <Button
            variant={activeFilter === "COMPLETED" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveFilter("COMPLETED")}
            className="h-8 px-2.5 text-xs font-medium"
          >
            Finalizado ({groups.completed.length})
          </Button>
        </div>

        {/* Refresh Button */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing || Boolean(loadingActionKey)}
            className="h-8 px-3 text-xs font-medium gap-1.5"
          >
            <RotateCwIcon
              className={cn("size-3.5", isRefreshing && "animate-spin")}
            />
            <span>{isRefreshing ? "Atualizando..." : "Atualizar"}</span>
          </Button>
        </div>
      </div>

      {/* Error Banner with Retry */}
      {error && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-xl border border-destructive/20 bg-destructive/10 text-destructive text-sm">
          <div className="flex items-center gap-2.5">
            <AlertCircleIcon className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-7 px-2.5 text-xs"
          >
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Empty State */}
      {totalCount === 0 ? (
        <Empty className="border border-dashed border-border bg-card/40 py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon className="size-6 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>Fila da recepção vazia</EmptyTitle>
            <EmptyDescription>
              Nenhum paciente na fila de espera para o dia selecionado.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {/* GROUP 1: AGUARDANDO */}
          {(activeFilter === "ALL" || activeFilter === "WAITING") && (
            <QueueSection
              title="Aguardando Chegada"
              count={groups.waiting.length}
              items={groups.waiting}
              now={now}
              loadingActionKey={loadingActionKey}
              onTransition={handleTransition}
            />
          )}

          {/* GROUP 2: PRESENTE / CHAMADO */}
          {(activeFilter === "ALL" || activeFilter === "PRESENT") && (
            <QueueSection
              title="Presente / Chamado"
              count={groups.presentOrCalled.length}
              items={groups.presentOrCalled}
              now={now}
              loadingActionKey={loadingActionKey}
              onTransition={handleTransition}
            />
          )}

          {/* GROUP 3: EM ATENDIMENTO */}
          {(activeFilter === "ALL" || activeFilter === "IN_SERVICE") && (
            <QueueSection
              title="Em atendimento"
              count={groups.inService.length}
              items={groups.inService}
              now={now}
              loadingActionKey={loadingActionKey}
              onTransition={handleTransition}
            />
          )}

          {/* GROUP 4: FINALIZADO */}
          {(activeFilter === "ALL" || activeFilter === "COMPLETED") && (
            <QueueSection
              title="Finalizado"
              count={groups.completed.length}
              items={groups.completed}
              now={now}
              loadingActionKey={loadingActionKey}
              onTransition={handleTransition}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface QueueSectionProps {
  title: string;
  count: number;
  items: ReceptionQueueItem[];
  now: Date;
  loadingActionKey: string | null;
  onTransition: (
    item: ReceptionQueueItem,
    targetStatus: ReceptionQueueTargetStatus,
  ) => Promise<void>;
}

function QueueSection({
  title,
  count,
  items,
  now,
  loadingActionKey,
  onTransition,
}: QueueSectionProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
          {title}
        </h2>
        <span className="flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
          {count}
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {items.map((item) => (
          <QueueCard
            key={item.id}
            item={item}
            now={now}
            loadingActionKey={loadingActionKey}
            onTransition={onTransition}
          />
        ))}
      </div>
    </div>
  );
}

interface QueueCardProps {
  item: ReceptionQueueItem;
  now: Date;
  loadingActionKey: string | null;
  onTransition: (
    item: ReceptionQueueItem,
    targetStatus: ReceptionQueueTargetStatus,
  ) => Promise<void>;
}

function QueueCard({
  item,
  now,
  loadingActionKey,
  onTransition,
}: QueueCardProps) {
  const statusInfo = normalizeReceptionQueueStatus(item.queueStatus);
  const waitMinutes = calculateWaitTimeMinutes(item.arrivedAt, now);
  const formattedWaitTime = formatWaitTime(waitMinutes);

  const scheduledTime = item.localScheduledAt
    ? item.localScheduledAt.slice(11, 16)
    : "--:--";

  const isItemLoading =
    Boolean(loadingActionKey) && loadingActionKey?.startsWith(`${item.id}-`);

  return (
    <div
      className={cn(
        "flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl border border-border bg-card text-card-foreground shadow-2xs hover:border-primary/40 transition-all",
        isItemLoading && "opacity-70 pointer-events-none",
      )}
    >
      {/* Left: Time, Patient & Professional Details */}
      <div className="flex items-start sm:items-center gap-4">
        {/* Scheduled Time Badge */}
        <div className="flex flex-col items-center justify-center min-w-[5.5rem] px-2.5 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium shrink-0">
          <span className="font-semibold text-foreground text-sm">
            {scheduledTime}
          </span>
          <span className="text-[11px]">{item.durationMinutes} min</span>
        </div>

        {/* Patient and Professional Info */}
        <div className="flex flex-col gap-0.5">
          <h3 className="font-semibold text-foreground text-base">
            {item.patientName ?? `Paciente #${item.patientId.slice(0, 8)}`}
          </h3>
          <p className="text-sm text-muted-foreground">
            {item.professionalName ??
              `Profissional #${item.professionalId.slice(0, 8)}`}
          </p>
        </div>
      </div>

      {/* Middle & Right: Status, Wait Time & Actions */}
      <div className="flex flex-wrap items-center gap-3 justify-between md:justify-end">
        {/* Wait Time Indicator */}
        {item.arrivedAt ? (
          <div
            className="flex items-center gap-1.5 text-xs text-muted-foreground px-2.5 py-1 rounded-md bg-muted/60"
            title={`Chegada: ${new Date(item.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
          >
            <ClockIcon className="size-3.5 text-primary" />
            <span>
              Espera:{" "}
              <strong className="text-foreground font-semibold">
                {formattedWaitTime}
              </strong>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 py-1">
            <span>Não chegou</span>
          </div>
        )}

        {/* Status Badge */}
        <Badge variant={statusInfo.variant} data-status={statusInfo.key}>
          {statusInfo.label}
        </Badge>

        {/* Action Buttons based on Queue Status */}
        <div className="flex items-center gap-2">
          {item.queueStatus === "WAITING" && (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={() => onTransition(item, "ARRIVED")}
                disabled={Boolean(loadingActionKey)}
                className="h-8 px-2.5 text-xs font-medium gap-1.5"
              >
                {loadingActionKey === `${item.id}-ARRIVED` ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <UserCheckIcon className="size-3.5" />
                )}
                <span>Marcar Chegada</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => onTransition(item, "CALLED")}
                disabled={Boolean(loadingActionKey)}
                className="h-8 px-2.5 text-xs font-medium gap-1.5"
              >
                {loadingActionKey === `${item.id}-CALLED` ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <BellIcon className="size-3.5" />
                )}
                <span>Chamar</span>
              </Button>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onTransition(item, "NO_SHOW")}
                disabled={Boolean(loadingActionKey)}
                title="Não compareceu"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
              >
                {loadingActionKey === `${item.id}-NO_SHOW` ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <UserXIcon className="size-4" />
                )}
              </Button>
            </>
          )}

          {item.queueStatus === "ARRIVED" && (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={() => onTransition(item, "CALLED")}
                disabled={Boolean(loadingActionKey)}
                className="h-8 px-2.5 text-xs font-medium gap-1.5"
              >
                {loadingActionKey === `${item.id}-CALLED` ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <BellIcon className="size-3.5" />
                )}
                <span>Chamar</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => onTransition(item, "IN_SERVICE")}
                disabled={Boolean(loadingActionKey)}
                className="h-8 px-2.5 text-xs font-medium gap-1.5"
              >
                {loadingActionKey === `${item.id}-IN_SERVICE` ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <PlayIcon className="size-3.5" />
                )}
                <span>Iniciar Atendimento</span>
              </Button>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onTransition(item, "NO_SHOW")}
                disabled={Boolean(loadingActionKey)}
                title="Não compareceu"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
              >
                {loadingActionKey === `${item.id}-NO_SHOW` ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <UserXIcon className="size-4" />
                )}
              </Button>
            </>
          )}

          {item.queueStatus === "CALLED" && (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={() => onTransition(item, "IN_SERVICE")}
                disabled={Boolean(loadingActionKey)}
                className="h-8 px-2.5 text-xs font-medium gap-1.5"
              >
                {loadingActionKey === `${item.id}-IN_SERVICE` ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <PlayIcon className="size-3.5" />
                )}
                <span>Iniciar Atendimento</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => onTransition(item, "CALLED")}
                disabled={Boolean(loadingActionKey)}
                className="h-8 px-2.5 text-xs font-medium gap-1.5"
              >
                {loadingActionKey === `${item.id}-CALLED` ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <BellIcon className="size-3.5" />
                )}
                <span>Chamar Novamente</span>
              </Button>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onTransition(item, "NO_SHOW")}
                disabled={Boolean(loadingActionKey)}
                title="Não compareceu"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
              >
                {loadingActionKey === `${item.id}-NO_SHOW` ? (
                  <Spinner className="size-3.5" />
                ) : (
                  <UserXIcon className="size-4" />
                )}
              </Button>
            </>
          )}

          {item.queueStatus === "IN_SERVICE" && (
            <Button
              variant="default"
              size="sm"
              onClick={() => onTransition(item, "COMPLETED")}
              disabled={Boolean(loadingActionKey)}
              className="h-8 px-3 text-xs font-medium gap-1.5"
            >
              {loadingActionKey === `${item.id}-COMPLETED` ? (
                <Spinner className="size-3.5" />
              ) : (
                <CheckCircle2Icon className="size-3.5" />
              )}
              <span>Concluir</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
