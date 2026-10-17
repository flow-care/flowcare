"use client";

import {
  AlertCircle,
  AlertTriangle,
  Check,
  Clock,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  checkEmailCollision,
  createInviteSchema,
  getRolePermissions,
  INVITE_VALIDITY_LABEL,
  type InviteMembershipRole,
  inviteMembershipRoles,
} from "@/lib/team-invites";
import {
  type CreateInviteActionResult,
  createInviteAction,
  resendInviteAction,
} from "./actions";

export interface InviteMemberFormProps {
  onClose: () => void;
  orgSlug: string;
  existingMembers: Array<{ email: string; userName?: string }>;
  existingInvites: Array<{
    id: string;
    email: string;
    role?: string;
    expiresAt?: string;
  }>;
  initialEmail?: string;
  initialRole?: InviteMembershipRole;
  onSuccess?: (newInvite: CreateInviteActionResult) => void;
  onResendSuccess?: (updatedInvite: {
    id: string;
    email: string;
    expiresAt: string;
  }) => void;
}

export function InviteMemberForm({
  onClose,
  orgSlug,
  existingMembers,
  existingInvites,
  initialEmail = "",
  initialRole = "PROFESSIONAL",
  onSuccess,
  onResendSuccess,
}: InviteMemberFormProps) {
  const [email, setEmail] = useState(initialEmail);
  const [role, setRole] = useState<InviteMembershipRole>(initialRole);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [emailTouched, setEmailTouched] = useState(Boolean(initialEmail));
  const [serverError, setServerError] = useState<string | null>(null);

  // Validation
  const emailValidation = createInviteSchema.shape.email.safeParse(email);
  const emailValidationError =
    emailTouched && !emailValidation.success
      ? "Informe um e-mail corporativo válido."
      : null;

  // Duplicate guards
  const collision = checkEmailCollision(
    email,
    existingMembers,
    existingInvites,
  );
  const isDuplicate = collision.status !== "clean";

  const selectedRoleConfig = getRolePermissions(role);

  const resetForm = () => {
    setEmail("");
    setRole("PROFESSIONAL");
    setEmailTouched(false);
    setServerError(null);
  };

  const handleClose = () => {
    if (isSubmitting || isResending) return;
    resetForm();
    onClose();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmitting) return;

    setEmailTouched(true);
    setServerError(null);

    const parsed = createInviteSchema.safeParse({
      email,
      role,
      expiresInDays: 7,
    });
    if (!parsed.success) {
      return;
    }

    if (collision.status === "active_member") {
      setServerError(
        "Este e-mail já pertence a um colaborador ativo da clínica.",
      );
      return;
    }

    if (collision.status === "pending_invite") {
      setServerError("Já existe um convite pendente para este e-mail.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createInviteAction(orgSlug, {
        email: parsed.data.email,
        role: parsed.data.role,
        expiresInDays: 7,
      });

      if (result.ok) {
        toast.success(`Convite enviado com sucesso para ${result.data.email}!`);
        onSuccess?.(result.data);
        resetForm();
        onClose();
      } else {
        const errorMsg =
          result.error.message || "Não foi possível enviar o convite.";
        setServerError(errorMsg);
        toast.error(errorMsg);
      }
    } catch {
      const genericMsg =
        "Falha de conexão ao enviar o convite. Tente novamente.";
      setServerError(genericMsg);
      toast.error(genericMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendExisting = async (inviteId: string) => {
    if (isResending) return;
    setIsResending(true);
    setServerError(null);

    try {
      const result = await resendInviteAction(orgSlug, inviteId);
      if (result.ok) {
        toast.success(
          `Convite existente reenviado com sucesso para ${result.data.email}!`,
        );
        onResendSuccess?.({
          id: result.data.id,
          email: result.data.email,
          expiresAt: result.data.expiresAt,
        });
        resetForm();
        onClose();
      } else {
        const errorMsg =
          result.error.message ||
          "Não foi possível reenviar o convite existente.";
        setServerError(errorMsg);
        toast.error(errorMsg);
      }
    } catch {
      const genericMsg = "Falha ao reenviar o convite. Tente novamente.";
      setServerError(genericMsg);
      toast.error(genericMsg);
    } finally {
      setIsResending(false);
    }
  };

  const isSubmitDisabled =
    isSubmitting ||
    isResending ||
    !email.trim() ||
    !emailValidation.success ||
    isDuplicate;

  return (
    <>
      <div className="p-6 pb-4 border-b border-border bg-card">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Mail className="size-5 text-primary" />
          <span>Convidar membro</span>
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Envie um convite de acesso por e-mail para integrar um novo
          colaborador à equipe da clínica.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex-1 flex flex-col justify-between overflow-y-auto"
      >
        <div className="p-6 space-y-6">
          {/* General Server Error Banner */}
          {serverError && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="size-4 shrink-0 mt-0.5" />
              <span className="flex-1">{serverError}</span>
            </div>
          )}

          {/* Email Field */}
          <div className="space-y-2">
            <Label
              htmlFor="invite-email"
              className="text-xs font-medium text-foreground"
            >
              E-mail corporativo <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <Input
                id="invite-email"
                type="email"
                placeholder="exemplo@clinica.com.br"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (serverError) setServerError(null);
                }}
                onBlur={() => setEmailTouched(true)}
                disabled={isSubmitting || isResending}
                className="h-10 text-sm bg-background border-border"
                aria-invalid={Boolean(
                  emailValidationError || collision.status === "active_member",
                )}
              />
            </div>

            {emailValidationError && (
              <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                <AlertCircle className="size-3 shrink-0" />
                <span>{emailValidationError}</span>
              </p>
            )}

            {/* Active Member Collision Alert */}
            {collision.status === "active_member" && (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive mt-2">
                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold">Colaborador já ativo</p>
                  <p>
                    Este e-mail já pertence a um colaborador ativo da clínica.
                    Não é possível enviar novo convite.
                  </p>
                </div>
              </div>
            )}

            {/* Pending Invite Notice with Quick Resend */}
            {collision.status === "pending_invite" && (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200 mt-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                  <div className="space-y-0.5 flex-1">
                    <p className="font-semibold">Convite pendente encontrado</p>
                    <p>
                      Já existe um convite pendente para este e-mail aguardando
                      ativação.
                    </p>
                  </div>
                </div>
                {collision.existingInviteId && (
                  <div className="flex justify-end pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isResending || isSubmitting}
                      onClick={() => {
                        const existingId = collision.existingInviteId;
                        if (existingId) {
                          handleResendExisting(existingId);
                        }
                      }}
                      className="h-7 text-xs border-amber-500/40 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 gap-1.5"
                    >
                      {isResending ? (
                        <>
                          <Spinner className="size-3" />
                          <span>Reenviando...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="size-3" />
                          <span>Reenviar convite agora</span>
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Role Selection */}
          <div className="space-y-2">
            <Label
              htmlFor="invite-role"
              className="text-xs font-medium text-foreground"
            >
              Papel pré-atribuído <span className="text-destructive">*</span>
            </Label>
            <Select
              value={role}
              onValueChange={(val) => {
                setRole(val as InviteMembershipRole);
                if (serverError) setServerError(null);
              }}
              disabled={isSubmitting || isResending}
            >
              <SelectTrigger
                id="invite-role"
                className="w-full h-10 text-sm bg-background border-border"
              >
                <SelectValue placeholder="Selecione o papel" />
              </SelectTrigger>
              <SelectContent>
                {inviteMembershipRoles.map((r) => {
                  const cfg = getRolePermissions(r);
                  return (
                    <SelectItem key={r} value={r} className="text-sm">
                      {cfg.label}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Explanatory Permissions Card */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-primary shrink-0" />
                <span className="text-xs font-semibold text-foreground">
                  {selectedRoleConfig.label}
                </span>
              </div>
              <Badge
                variant="outline"
                className={selectedRoleConfig.badgeClass}
              >
                {selectedRoleConfig.role}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              {selectedRoleConfig.shortDescription}
            </p>

            <div className="space-y-1.5 pt-1 border-t border-border/60">
              <p className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground">
                Permissões incluídas na clínica:
              </p>
              <ul className="space-y-1.5">
                {selectedRoleConfig.permissions.map((perm) => (
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
          </div>

          {/* Validity Indicator */}
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            <Clock className="size-4 text-muted-foreground shrink-0" />
            <span>
              <strong>{INVITE_VALIDITY_LABEL}</strong> — Após 7 dias, o link de
              ativação expirará automaticamente caso não seja aceito.
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-border bg-card flex flex-col sm:flex-row gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting || isResending}
            onClick={handleClose}
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
                <span>Enviando convite...</span>
              </>
            ) : (
              <>
                <Mail className="size-4" />
                <span>Enviar convite</span>
              </>
            )}
          </Button>
        </div>
      </form>
    </>
  );
}

export interface InviteMemberSheetProps extends InviteMemberFormProps {
  isOpen: boolean;
}

export function InviteMemberSheet({
  isOpen,
  onClose,
  ...formProps
}: InviteMemberSheetProps) {
  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-md flex flex-col gap-0 p-0 overflow-hidden bg-card text-card-foreground border-l border-border"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Convidar membro</SheetTitle>
          <SheetDescription>
            Envie um convite de acesso por e-mail para integrar um novo
            colaborador à equipe da clínica.
          </SheetDescription>
        </SheetHeader>
        <InviteMemberForm onClose={onClose} {...formProps} />
      </SheetContent>
    </Sheet>
  );
}
