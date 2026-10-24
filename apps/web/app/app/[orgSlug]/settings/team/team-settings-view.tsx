"use client";

import {
  AlertCircle,
  CheckCircle2,
  Mail,
  MoreHorizontal,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
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
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatTeamDate, getRoleBadgeConfig } from "@/lib/team-display";
import type { MembershipRole } from "@/lib/team-members";
import { isSoleAdminMember } from "@/lib/team-removal";
import type { PermissionCatalog, TeamInvite, TeamMember } from "@/server/team";
import {
  type CreateInviteActionResult,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
} from "./actions";
import { EditMemberSheet } from "./edit-member-sheet";
import { InviteMemberSheet } from "./invite-member-sheet";
import { MemberPermissionsSheet } from "./member-permissions-sheet";
import { RemoveMemberDialog } from "./remove-member-dialog";
import { useTeamNavigation } from "./team-navigation";

export { formatTeamDate, getRoleBadgeConfig };

export interface TeamSettingsViewProps {
  orgSlug: string;
  initialMembers: TeamMember[];
  initialInvites: TeamInvite[];
  permissionCatalog?: PermissionCatalog | null;
  isSoloClinic?: boolean;
  defaultTab?: "members" | "invites";
  initialSheet?: string;
  initialMemberId?: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function getRevokeConfirmationMessage(email?: string): string {
  return `Tem certeza de que deseja revogar o convite enviado para ${email || "este e-mail"}? O link enviado por e-mail será imediatamente invalidado e não poderá mais ser utilizado para ingressar na clínica.`;
}

export function RevokeInviteDialog({
  invite,
  open,
  isRevoking,
  onOpenChange,
  onConfirm,
}: {
  invite: TeamInvite | null;
  open: boolean;
  isRevoking: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive sm:mx-0">
            <ShieldAlert className="size-6" />
          </div>
          <AlertDialogTitle>Revogar convite de acesso</AlertDialogTitle>
          <AlertDialogDescription>
            {getRevokeConfirmationMessage(invite?.email)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRevoking}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isRevoking}
            onClick={onConfirm}
          >
            {isRevoking ? (
              <>
                <Spinner className="mr-2 size-3.5" />
                Revogando...
              </>
            ) : (
              "Revogar convite"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function TeamSettingsView({
  orgSlug,
  initialMembers,
  initialInvites,
  permissionCatalog = null,
  isSoloClinic = false,
  defaultTab = "members",
  initialSheet,
  initialMemberId,
}: TeamSettingsViewProps) {
  const { router, pathname, searchParams } = useTeamNavigation();

  const [members, setMembers] = useState<TeamMember[]>(initialMembers);
  const [invites, setInvites] = useState<TeamInvite[]>(initialInvites);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [revokingInvite, setRevokingInvite] = useState<TeamInvite | null>(null);
  const [isRevoking, startRevokeTransition] = useTransition();
  const [removingMember, setRemovingMember] = useState<TeamMember | null>(null);
  const [isRemovingMember, startRemoveTransition] = useTransition();
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const isInviteSheetOpen =
    (searchParams?.get("sheet") ?? initialSheet) === "invite";
  const isEditSheetOpen =
    (searchParams?.get("sheet") ?? initialSheet) === "edit";
  const isPermissionsSheetOpen =
    (searchParams?.get("sheet") ?? initialSheet) === "permissions";
  const editMemberId = searchParams?.get("memberId") ?? initialMemberId;
  const activeEditMember = members.find((m) => m.id === editMemberId) ?? null;
  const activePermissionsMember = activeEditMember;

  const handleCloseInviteSheet = () => {
    if (searchParams) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("sheet");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    } else {
      router.push(`/app/${encodeURIComponent(orgSlug)}/settings/team`);
    }
  };

  const handleClosePermissionsSheet = () => {
    handleCloseEditSheet();
  };

  const handleCloseEditSheet = () => {
    if (searchParams) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("sheet");
      params.delete("memberId");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    } else {
      router.push(`/app/${encodeURIComponent(orgSlug)}/settings/team`);
    }
  };

  const handleMemberRoleUpdated = (updated: {
    id: string;
    role: MembershipRole;
    version: number;
    userName?: string;
    email?: string;
  }) => {
    setMembers((prev) =>
      prev.map((m) =>
        m.id === updated.id
          ? {
              ...m,
              role: updated.role,
              version: updated.version,
              userName: updated.userName ?? m.userName,
              email: updated.email ?? m.email,
            }
          : m,
      ),
    );
    const roleConfig = getRoleBadgeConfig(updated.role);
    const successMsg = `Papel de ${updated.userName ?? "colaborador"} atualizado para ${roleConfig.label} com sucesso!`;
    setFeedback({ type: "success", message: successMsg });
    toast.success(successMsg);
  };

  const handleConfirmRemoveMember = () => {
    if (!removingMember || isRemovingMember) return;
    const target = removingMember;
    if (isSoleAdminMember(target, members)) {
      setRemovalError("A clínica deve manter ao menos um administrador ativo.");
      return;
    }
    setRemovalError(null);
    startRemoveTransition(async () => {
      try {
        const result = await removeMemberAction(orgSlug, target.id);
        if (!result.ok) {
          setRemovalError(result.error.message);
          toast.error(result.error.message);
          return;
        }
        setMembers((previous) =>
          previous.filter((member) => member.id !== target.id),
        );
        setRemovingMember(null);
        handleCloseEditSheet();
        toast.success(`${target.userName} foi removido da clínica.`);
      } catch {
        const message = "Não foi possível remover o membro da clínica.";
        setRemovalError(message);
        toast.error(message);
      }
    });
  };

  const handleInviteSuccess = (newInvite: CreateInviteActionResult) => {
    setInvites((prev) => [
      {
        id: newInvite.id,
        email: newInvite.email,
        role: newInvite.role,
        expiresAt: newInvite.expiresAt,
        createdAt: new Date().toISOString(),
      },
      ...prev.filter((inv) => inv.id !== newInvite.id),
    ]);
    const successMsg = `Convite enviado com sucesso para ${newInvite.email}!`;
    setFeedback({ type: "success", message: successMsg });
    toast.success(successMsg);
  };

  const handleResendSuccess = (updatedInvite: {
    id: string;
    email: string;
    expiresAt: string;
  }) => {
    setInvites((prev) =>
      prev.map((item) =>
        item.id === updatedInvite.id
          ? { ...item, expiresAt: updatedInvite.expiresAt }
          : item,
      ),
    );
    const successMsg = `Convite para ${updatedInvite.email} reenviado com sucesso!`;
    setFeedback({ type: "success", message: successMsg });
    toast.success(successMsg);
  };

  // Protection for the last administrator
  const adminMembers = members.filter(
    (m) => m.role === "ADMIN" || m.role === "ADMIN_PROFESSIONAL",
  );
  const isSoleAdmin = adminMembers.length === 1;

  const handleResend = async (invite: TeamInvite) => {
    setResendingId(invite.id);
    setFeedback(null);
    try {
      const result = await resendInviteAction(orgSlug, invite.id);
      if (result.ok) {
        setInvites((prev) =>
          prev.map((item) =>
            item.id === invite.id
              ? { ...item, expiresAt: result.data.expiresAt }
              : item,
          ),
        );
        const successMsg = `Convite reenviado com sucesso! Válido até ${formatTeamDate(result.data.expiresAt)}.`;
        setFeedback({ type: "success", message: successMsg });
        toast.success(successMsg);
      } else {
        const errorMsg =
          result.error.message || "Não foi possível reenviar o convite.";
        setFeedback({ type: "error", message: errorMsg });
        toast.error(errorMsg);
      }
    } catch {
      const genericMsg = "Falha ao reenviar convite. Tente novamente.";
      setFeedback({ type: "error", message: genericMsg });
      toast.error(genericMsg);
    } finally {
      setResendingId(null);
    }
  };

  const handleConfirmRevoke = () => {
    if (!revokingInvite) return;
    const targetInvite = revokingInvite;
    startRevokeTransition(async () => {
      try {
        const result = await revokeInviteAction(orgSlug, targetInvite.id);
        if (result.ok) {
          setInvites((prev) =>
            prev.filter((item) => item.id !== targetInvite.id),
          );
          const successMsg = `Convite para ${targetInvite.email} revogado com sucesso.`;
          setFeedback({ type: "success", message: successMsg });
          toast.success(successMsg);
          setRevokingInvite(null);
        } else {
          const errorMsg =
            result.error.message || "Não foi possível revogar o convite.";
          setFeedback({ type: "error", message: errorMsg });
          toast.error(errorMsg);
        }
      } catch {
        const genericMsg = "Falha ao revogar convite. Tente novamente.";
        setFeedback({ type: "error", message: genericMsg });
        toast.error(genericMsg);
      }
    });
  };

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Equipe e Permissões
            </h1>
            <p className="text-sm text-muted-foreground">
              Gerencie os colaboradores da clínica, permissões de acesso e
              convites pendentes.
            </p>
          </div>
          <Button asChild className="gap-2 shrink-0">
            <Link
              href={`/app/${encodeURIComponent(orgSlug)}/settings/team?sheet=invite`}
            >
              <UserPlus className="size-4" />
              <span>Convidar membro</span>
            </Link>
          </Button>
        </div>

        {/* Feedback Alert if available */}
        {feedback && (
          <div
            className={`flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm transition-all ${
              feedback.type === "success"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                : "border-destructive/20 bg-destructive/10 text-destructive"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertCircle className="size-4 shrink-0 text-destructive" />
            )}
            <span className="flex-1">{feedback.message}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="text-xs font-medium underline opacity-80 hover:opacity-100 cursor-pointer"
            >
              Fechar
            </button>
          </div>
        )}

        {/* Single Admin Callout */}
        {isSoleAdmin && members.length === 1 && (
          <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-card-foreground">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="flex-1 space-y-1">
              <h2 className="font-medium text-foreground">
                Clínica com apenas 1 administrador
              </h2>
              <p className="text-xs/relaxed text-muted-foreground">
                Sua clínica possui apenas você como administrador cadastrado e
                nenhum outro membro. Convide médicos, profissionais de saúde e
                recepcionistas para agilizar a rotina de atendimentos.
              </p>
            </div>
            <Button
              asChild
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5 text-xs"
            >
              <Link
                href={`/app/${encodeURIComponent(orgSlug)}/settings/team?sheet=invite`}
              >
                <UserPlus className="size-3.5" />
                Convidar agora
              </Link>
            </Button>
          </div>
        )}

        {/* Tabs: Membros Ativos / Convites Pendentes */}
        <Tabs defaultValue={defaultTab} className="w-full space-y-4">
          <TabsList className="bg-muted p-1">
            <TabsTrigger value="members" className="gap-2">
              <Users className="size-4" />
              <span>Membros Ativos</span>
              <Badge
                variant="secondary"
                className="ml-1 h-5 px-1.5 text-xs font-semibold"
              >
                {members.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="invites" className="gap-2">
              <Mail className="size-4" />
              <span>Convites Pendentes</span>
              <Badge
                variant="secondary"
                className="ml-1 h-5 px-1.5 text-xs font-semibold"
              >
                {invites.length}
              </Badge>
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: Membros Ativos */}
          <TabsContent
            value="members"
            forceMount
            className="data-[state=inactive]:hidden space-y-4"
          >
            <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[35%]">Colaborador</TableHead>
                    <TableHead className="w-[25%]">E-mail</TableHead>
                    <TableHead className="w-[20%]">Papel</TableHead>
                    <TableHead className="w-[15%]">Ingresso</TableHead>
                    <TableHead className="w-[5%] text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((member) => {
                    const isLastAdmin =
                      isSoleAdmin &&
                      (member.role === "ADMIN" ||
                        member.role === "ADMIN_PROFESSIONAL");
                    const roleConfig = getRoleBadgeConfig(member.role);

                    return (
                      <TableRow key={member.id} className="transition-colors">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="size-9">
                              <AvatarFallback className="text-xs font-medium">
                                {getInitials(member.userName)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-foreground">
                                  {member.userName}
                                </span>
                                {isLastAdmin && (
                                  <Badge
                                    variant="outline"
                                    className="gap-1 border-primary/40 bg-primary/10 text-primary text-[11px] font-medium"
                                  >
                                    <ShieldCheck className="size-3" />
                                    Administrador principal
                                  </Badge>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground sm:hidden">
                                {member.email}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {member.email}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={roleConfig.className}
                            >
                              {roleConfig.label}
                            </Badge>
                            {member.isCustomized && (
                              <Badge
                                variant="outline"
                                className="border-primary/40 bg-primary/10 text-[11px] text-primary"
                              >
                                Personalizado
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatTeamDate(member.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isLastAdmin && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 text-xs text-muted-foreground cursor-help rounded-md px-2 py-1 bg-muted/60 border-0 outline-none"
                                    aria-label="Administrador principal protegido"
                                  >
                                    <ShieldCheck className="size-3.5 text-primary" />
                                    <span className="hidden sm:inline">
                                      Protegido
                                    </span>
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  O último administrador não pode ser rebaixado
                                  ou removido da clínica.
                                </TooltipContent>
                              </Tooltip>
                            )}

                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 px-2.5 text-xs"
                            >
                              <Link
                                href={`/app/${encodeURIComponent(orgSlug)}/settings/team?sheet=permissions&memberId=${encodeURIComponent(member.id)}`}
                              >
                                <ShieldCheck className="size-3.5" />
                                <span>Permissões</span>
                              </Link>
                            </Button>

                            <Button
                              asChild
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 px-2.5 text-xs"
                            >
                              <Link
                                href={`/app/${encodeURIComponent(orgSlug)}/settings/team?sheet=edit&memberId=${encodeURIComponent(member.id)}`}
                              >
                                <UserCheck className="size-3.5" />
                                <span>Editar</span>
                              </Link>
                            </Button>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-muted-foreground hover:text-foreground"
                                  aria-label={`Mais opções para ${member.userName}`}
                                >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link
                                    href={`/app/${encodeURIComponent(orgSlug)}/settings/team?sheet=edit&memberId=${encodeURIComponent(member.id)}`}
                                  >
                                    <UserCheck className="mr-2 size-4" />
                                    Editar permissões
                                  </Link>
                                </DropdownMenuItem>
                                {isLastAdmin ? (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      disabled
                                      className="text-muted-foreground opacity-60"
                                    >
                                      <Trash2 className="mr-2 size-4" />
                                      Remover membro (protegido)
                                    </DropdownMenuItem>
                                  </>
                                ) : (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      disabled
                                      className="text-muted-foreground"
                                    >
                                      <Trash2 className="mr-2 size-4" />
                                      Remover membro
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {/* Tab 2: Convites Pendentes */}
          <TabsContent
            value="invites"
            forceMount
            className="data-[state=inactive]:hidden space-y-4"
          >
            {invites.length === 0 ? (
              <Empty className="border border-dashed border-border bg-card/50 py-12">
                <EmptyMedia variant="icon">
                  <Mail className="size-6 text-muted-foreground" />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>Nenhum convite pendente</EmptyTitle>
                  <EmptyDescription>
                    Todos os convites enviados já foram aceitos ou não há
                    convites ativos no momento.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button asChild variant="outline" className="gap-2">
                    <Link
                      href={`/app/${encodeURIComponent(orgSlug)}/settings/team?sheet=invite`}
                    >
                      <UserPlus className="size-4" />
                      Convidar novo membro
                    </Link>
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[30%]">
                        E-mail do destinatário
                      </TableHead>
                      <TableHead className="w-[22%]">
                        Papel pré-atribuído
                      </TableHead>
                      <TableHead className="w-[18%]">Data de envio</TableHead>
                      <TableHead className="w-[18%]">Expira em</TableHead>
                      <TableHead className="w-[12%] text-right">
                        Ações
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((invite) => {
                      const roleConfig = getRoleBadgeConfig(invite.role);
                      const isResendingThis = resendingId === invite.id;

                      return (
                        <TableRow key={invite.id} className="transition-colors">
                          <TableCell className="font-medium text-foreground">
                            {invite.email}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={roleConfig.className}
                            >
                              {roleConfig.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatTeamDate(invite.createdAt)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatTeamDate(invite.expiresAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isResendingThis}
                                onClick={() => handleResend(invite)}
                                className="h-8 gap-1.5 px-2.5 text-xs"
                                aria-label={`Reenviar convite para ${invite.email}`}
                              >
                                {isResendingThis ? (
                                  <Spinner className="size-3.5" />
                                ) : (
                                  <RefreshCw className="size-3.5" />
                                )}
                                <span>Reenviar</span>
                              </Button>

                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRevokingInvite(invite)}
                                className="h-8 gap-1.5 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                                aria-label={`Revogar convite para ${invite.email}`}
                              >
                                <Trash2 className="size-3.5" />
                                <span>Revogar</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* AlertDialog for Revoking Invitation */}
        <RevokeInviteDialog
          invite={revokingInvite}
          open={Boolean(revokingInvite)}
          isRevoking={isRevoking}
          onOpenChange={(open) => {
            if (!open && !isRevoking) setRevokingInvite(null);
          }}
          onConfirm={handleConfirmRevoke}
        />

        {/* Sheet for Inviting Member */}
        <InviteMemberSheet
          isOpen={isInviteSheetOpen}
          onClose={handleCloseInviteSheet}
          orgSlug={orgSlug}
          existingMembers={members}
          existingInvites={invites}
          onSuccess={handleInviteSuccess}
          onResendSuccess={handleResendSuccess}
        />

        {/* Sheet for Editing Member Role */}
        <MemberPermissionsSheet
          open={isPermissionsSheetOpen}
          onOpenChange={(open) => {
            if (!open) handleClosePermissionsSheet();
          }}
          orgSlug={orgSlug}
          member={activePermissionsMember}
          catalog={permissionCatalog}
          isSoloClinic={isSoloClinic}
        />

        <EditMemberSheet
          isOpen={isEditSheetOpen}
          onClose={handleCloseEditSheet}
          orgSlug={orgSlug}
          member={activeEditMember}
          activeAdminCount={adminMembers.length}
          onSuccess={handleMemberRoleUpdated}
          onInitiateRemoval={(member) => {
            setRemovalError(null);
            setRemovingMember(
              members.find((item) => item.id === member.id) ?? null,
            );
          }}
        />
        <RemoveMemberDialog
          member={removingMember}
          open={Boolean(removingMember)}
          isRemoving={isRemovingMember}
          errorMessage={removalError}
          onOpenChange={(open) => {
            if (!open && !isRemovingMember) {
              setRemovingMember(null);
              setRemovalError(null);
            }
          }}
          onConfirm={handleConfirmRemoveMember}
        />
      </div>
    </TooltipProvider>
  );
}
