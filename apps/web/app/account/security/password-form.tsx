"use client";

import { useForm } from "@tanstack/react-form";
import { Check, Eye, EyeOff, Loader2, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  passwordRequirements,
  validatePasswordChange,
} from "@/lib/account-password";
import { changePasswordAction } from "./actions";

type PasswordFieldName = "currentPassword" | "newPassword" | "confirmation";

function PasswordInput({
  name,
  label,
  placeholder,
  value,
  onChange,
  onBlur,
  disabled,
}: {
  name: PasswordFieldName;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  disabled: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <Field>
      <FieldLabel htmlFor={name} className="required">
        {label}
      </FieldLabel>
      <InputGroup data-disabled={disabled}>
        <InputGroupInput
          id={name}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={
            name === "currentPassword" ? "current-password" : "new-password"
          }
          placeholder={placeholder}
          maxLength={72}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          disabled={disabled}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            type="button"
            size="icon-sm"
            aria-label={
              visible
                ? `Ocultar ${label.toLowerCase()}`
                : `Mostrar ${label.toLowerCase()}`
            }
            aria-pressed={visible}
            onClick={() => setVisible((current) => !current)}
            disabled={disabled}
          >
            {visible ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}

export function PasswordForm() {
  const form = useForm({
    defaultValues: { currentPassword: "", newPassword: "", confirmation: "" },
    validators: { onSubmit: ({ value }) => validatePasswordChange(value) },
    onSubmitInvalid: ({ value }) =>
      toast.error(
        validatePasswordChange(value) ?? "Confira as senhas informadas.",
      ),
    onSubmit: async ({ value }) => {
      try {
        const result = await changePasswordAction(value);
        if (result.ok) {
          form.reset();
          toast.success("Senha alterada. As outras sessões foram encerradas.");
          return;
        }
        if (result.code === "INVALID_CREDENTIALS") {
          toast.error("Senha atual incorreta.");
        } else if (result.code === "UNAUTHENTICATED") {
          toast.error("Sua sessão expirou. Entre novamente.");
        } else if (result.code === "VALIDATION_ERROR") {
          toast.error("Confira os requisitos da nova senha.");
        } else {
          toast.error("Não foi possível alterar a senha. Tente novamente.");
        }
      } catch {
        toast.error("Não foi possível alterar a senha. Tente novamente.");
      }
    },
  });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <LockKeyhole className="size-5 text-primary" aria-hidden />
          <CardTitle>Alterar senha</CardTitle>
        </div>
        <CardDescription>
          Ao alterar sua senha, as outras sessões da sua conta serão encerradas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field name="currentPassword">
            {(field) => (
              <PasswordInput
                name={field.name}
                label="Senha atual"
                placeholder="Digite sua senha atual"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                disabled={form.state.isSubmitting}
              />
            )}
          </form.Field>
          <form.Field name="newPassword">
            {(field) => (
              <>
                <PasswordInput
                  name={field.name}
                  label="Nova senha"
                  placeholder="Digite sua nova senha"
                  value={field.state.value}
                  onChange={field.handleChange}
                  onBlur={field.handleBlur}
                  disabled={form.state.isSubmitting}
                />
                <ul
                  className="mt-2 space-y-1"
                  aria-label="Requisitos da nova senha"
                >
                  {passwordRequirements.map(({ label, test }) => {
                    const passed = test(field.state.value);
                    return (
                      <li
                        key={label}
                        className={`flex items-center gap-2 text-xs ${passed ? "text-primary" : "text-muted-foreground"}`}
                      >
                        <Check className="size-3.5" aria-hidden />
                        <span>{label}</span>
                        <span className="sr-only">
                          {passed ? "Atendido" : "Pendente"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </form.Field>
          <form.Field name="confirmation">
            {(field) => (
              <PasswordInput
                name={field.name}
                label="Confirmar nova senha"
                placeholder="Repita sua nova senha"
                value={field.state.value}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
                disabled={form.state.isSubmitting}
              />
            )}
          </form.Field>
          <div className="flex justify-end">
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(pending) => (
                <Button type="submit" disabled={pending}>
                  {pending && (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  )}
                  {pending ? "Alterando..." : "Alterar senha"}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
