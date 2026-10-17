"use client";

import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  MinusCircle,
  PlusCircle,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import {
  type EditableMember,
  getMemberRoleErrorMessage,
  getRoleChangeImpact,
  isLastAdminDowngradeBlocked,
  LAST_ADMIN_DOWNGRADE_ALERT,
  type MembershipRole,
  membershipRoles,
} from "@/lib/team-members";
import { updateMemberRoleAction } from "./actions";
import { formatTeamDate, getRoleBadgeConfig } from "./team-settings-view";

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export interface EditMemberFormProps {
  onClose: () => void;
  orgSlug: string;
  member: EditableMember;
  activeAdminCount: number;
  initialSelectedRole?: MembershipRole;
  onSuccess?: (updatedMember: {
    id: string;
    role: MembershipRole;
    version: number;
    userName?: string;
    email?: string;
  }) => void;
}

export function EditMemberForm({
  onClose,
  orgSlug,
  member,
  activeAdminCount,
  initialSelectedRole,
  onSuccess,
}: EditMemberFormProps) {
  const [selectedRole, setSelectedRole] = useState<MembershipRole>(
    initialSelectedRole ?? member.role,
  );
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedRole(initialSelectedRole ?? member.role);
    setIsConfirmed(false);
    setServerError(null);
  }, [member.role, initialSelectedRole]);

  const hasRoleChanged = selectedRole !== member.role;
  const isDowngradeBlocked = isLastAdminDowngradeBlocked(
    member.role,
    selectedRole,
    activeAdminCount,
  );

  const impact = getRoleChangeImpact(member.role, selectedRole);
  const currentBadge = getRoleBadgeConfig(member.role);
  const selectedBadge = getRoleBadgeConfig(selectedRole);

  const isSubmitDisabled =
    isSubmitting || !hasRoleChanged || isDowngradeBlocked || !isConfirmed;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitDisabled) return;

    setIsSubmitting(true);
    setServerError(null);

    try {
      const result = await updateMemberRoleAction(orgSlug, member.id, {
        role: selectedRole,
        version: member.version ?? 1,
      });

      if (result.ok) {
        const successMessage = `Papel de ${member.userName} atualizado para ${selectedBadge.label} com sucesso!`;
        toast.success(successMessage);
        onSuccess?.({
          id: result.data.id,
          role: result.data.role,
          version: result.data.version,
          userName: result.data.user?.fullName ?? member.userName,
          email: result.data.user?.email ?? member.email,
        });
        onClose();
      } else {
        const message = getMemberRoleErrorMessage(
          result.error.code,
          result.error.message,
        );
        setServerError(message);
        toast.error(message);
      }
    } catch {
      const genericMsg =
        "Falha de conexão ao atualizar o papel do colaborador. Tente novamente.";
      setServerError(genericMsg);
      toast.error(genericMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Header with Member Info */}
      <div className="p-6 pb-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Avatar className="size-12 border border-border">
            <AvatarFallback className="text-sm font-semibold bg-muted text-foreground">
              {getInitials(member.userName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-semibold text-foreground truncate">
                {member.userName}
              </h2>
              <Badge variant="outline" className={currentBadge.className}>
                {currentBadge.label}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {member.email}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Membro desde: {formatTeamDate(member.createdAt)}
            </p>
          </div>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex-1 flex flex-col justify-between overflow-y-auto"
      >
        <div className="p-6 space-y-6">
          {/* Server Error Alert */}
          {serverError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive"
            >
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span className="flex-1">{serverError}</span>
            </div>
          )}

          {/* Last Administrator Downgrade Guard Alert */}
          {isDowngradeBlocked && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive"
            >
              <ShieldAlert className="size-5 shrink-0 text-destructive mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-sm">
                  Rebaixamento não permitido
                </p>
                <p className="text-destructive/90 leading-relaxed">
                  {LAST_ADMIN_DOWNGRADE_ALERT}
                </p>
              </div>
            </div>
          )}

          {/* Role Selector */}
          <div className="space-y-2">
            <Label
              htmlFor="member-role-select"
              className="text-xs font-medium text-foreground"
            >
              Novo papel do colaborador
            </Label>
            <Select
              value={selectedRole}
              onValueChange={(val) => {
                setSelectedRole(val as MembershipRole);
                setIsConfirmed(false);
                if (serverError) setServerError(null);
              }}
              disabled={isSubmitting}
            >
              <SelectTrigger
                id="member-role-select"
                className="w-full h-10 text-sm bg-background border-border"
              >
                <SelectValue placeholder="Selecione o papel" />
              </SelectTrigger>
              <SelectContent>
                {membershipRoles.map((r) => {
                  const cfg = getRoleBadgeConfig(r);
                  return (
                    <SelectItem key={r} value={r} className="text-sm">
                      {cfg.label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Selecione o novo nível de acesso desejado para este colaborador.
            </p>
          </div>

          {/* Impact Warning Callout */}
          {hasRoleChanged ? (
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <Badge variant="outline" className={currentBadge.className}>
                  {currentBadge.label}
                </Badge>
                <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
                <Badge variant="outline" className={selectedBadge.className}>
                  {selectedBadge.label}
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">
                {impact.summary}
              </p>

              {/* Gained Permissions */}
              {impact.gainedPermissions.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border/60">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <PlusCircle className="size-3.5" />
                    <span>Permissões concedidas:</span>
                  </div>
                  <ul className="space-y-1.5 pl-1">
                    {impact.gainedPermissions.map((perm) => (
                      <li
                        key={perm}
                        className="flex items-start gap-2 text-xs text-foreground/80"
                      >
                        <Check className="size-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                        <span>{perm}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Lost Permissions */}
              {impact.lostPermissions.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-border/60">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                    <MinusCircle className="size-3.5" />
                    <span>Permissões revogadas:</span>
                  </div>
                  <ul className="space-y-1.5 pl-1">
                    {impact.lostPermissions.map((perm) => (
                      <li
                        key={perm}
                        className="flex items-start gap-2 text-xs text-foreground/80"
                      >
                        <MinusCircle className="size-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                        <span>{perm}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Clinical Qualification Requirement Warning */}
              {impact.clinicalQualificationNotice && (
                <div className="flex items-start gap-2.5 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-900 dark:text-blue-200">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                  <span className="leading-relaxed">
                    {impact.clinicalQualificationNotice}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary shrink-0" />
              <span>
                O papel selecionado é o mesmo atualmente atribuído a este
                colaborador.
              </span>
            </div>
          )}

          {/* Explicit Confirmation Checkbox */}
          {hasRoleChanged && !isDowngradeBlocked && (
            <div className="flex items-start gap-3 rounded-lg border border-border p-3.5 bg-muted/20">
              <Checkbox
                id="confirm-role-change"
                checked={isConfirmed}
                onCheckedChange={(checked) => setIsConfirmed(Boolean(checked))}
                disabled={isSubmitting}
                className="mt-0.5"
              />
              <Label
                htmlFor="confirm-role-change"
                className="text-xs text-foreground leading-normal cursor-pointer select-none font-normal"
              >
                Estou ciente das alterações de permissões e confirmo a
                atualização do papel deste colaborador.
              </Label>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-border bg-card flex flex-col sm:flex-row gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={onClose}
            className="w-full sm:w-auto"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={isSubmitDisabled}
            className="w-full sm:w-auto gap-2"
          >
            {isSubmitting ? (
              <>
                <Spinner className="size-4" />
                <span>Atualizando papel...</span>
              </>
            ) : (
              <>
                <UserCheck className="size-4" />
                <span>Salvar novo papel</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </>
  );
}

export interface EditMemberSheetProps {
  isOpen: boolean;
  onClose: () => void;
  orgSlug: string;
  member: EditableMember | null;
  activeAdminCount: number;
  onSuccess?: (updatedMember: {
    id: string;
    role: MembershipRole;
    version: number;
    userName?: string;
    email?: string;
  }) => void;
}

export function EditMemberSheet({
  isOpen,
  onClose,
  orgSlug,
  member,
  activeAdminCount,
  onSuccess,
}: EditMemberSheetProps) {
  return (
    <Sheet
      open={isOpen && Boolean(member)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col gap-0 p-0 overflow-hidden bg-card text-card-foreground border-l border-border"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Editar papel do colaborador</SheetTitle>
          <SheetDescription>
            Altere o papel e as permissões de acesso do colaborador na clínica.
          </SheetDescription>
        </SheetHeader>
        {member && (
          <EditMemberForm
            onClose={onClose}
            orgSlug={orgSlug}
            member={member}
            activeAdminCount={activeAdminCount}
            onSuccess={onSuccess}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
