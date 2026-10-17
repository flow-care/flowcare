"use client";

import { AlertCircle, Building2, FileText, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  isNameConfirmationMatching,
  type MemberRemovalCandidate,
  memberRemovalExplanations,
} from "@/lib/team-removal";

export interface RemoveMemberDialogProps {
  member: MemberRemovalCandidate | null;
  open: boolean;
  isRemoving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  errorMessage?: string | null;
}

export function RemoveMemberDialog({
  member,
  open,
  isRemoving,
  onOpenChange,
  onConfirm,
  errorMessage,
}: RemoveMemberDialogProps) {
  const [typedName, setTypedName] = useState("");

  // Reset confirmation input when dialog is opened or closed
  useEffect(() => {
    if (open) {
      setTypedName("");
    }
  }, [open]);

  const targetName = member?.userName ?? "";
  const isConfirmed = isNameConfirmationMatching(typedName, targetName);

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen && !isRemoving) {
      setTypedName("");
      onOpenChange(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleClose}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive sm:mx-0">
            <Trash2 className="size-6" />
          </div>
          <AlertDialogTitle className="text-foreground">
            Remover membro da clínica
          </AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            Você está prestes a remover o acesso de{" "}
            <strong className="font-semibold text-foreground">
              {member?.userName}
            </strong>{" "}
            {member?.email ? `(${member.email})` : ""} à clínica.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Required Informative Explanations */}
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-4 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-foreground font-medium">
              {memberRemovalExplanations.accessRevocation}
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <FileText className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-muted-foreground leading-relaxed">
              {memberRemovalExplanations.clinicalHistoryPreserved}
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <Building2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <p className="text-muted-foreground leading-relaxed">
              {memberRemovalExplanations.personalAccountRetention}
            </p>
          </div>
        </div>

        {/* Inline Error Notice */}
        {errorMessage && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Safeguard: Require typing member's full name */}
        <Field className="text-left">
          <FieldLabel htmlFor="confirm-member-name-input">
            Para confirmar, digite o nome completo do membro:{" "}
            <span className="font-semibold text-foreground select-all">
              {targetName}
            </span>
          </FieldLabel>
          <Input
            id="confirm-member-name-input"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            placeholder={targetName}
            disabled={isRemoving}
            autoComplete="off"
          />
        </Field>

        <AlertDialogFooter className="mt-2">
          <AlertDialogCancel
            disabled={isRemoving}
            onClick={() => {
              setTypedName("");
              onOpenChange(false);
            }}
          >
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!isConfirmed || isRemoving}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
            className="gap-2"
          >
            {isRemoving ? (
              <>
                <Spinner className="size-3.5" />
                <span>Removendo...</span>
              </>
            ) : (
              <>
                <Trash2 className="size-3.5" />
                <span>Remover membro</span>
              </>
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
