"use client";

import { useForm } from "@tanstack/react-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { loginAction } from "@/app/(auth)/actions";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { destinationAfterLogin, unwrapActionResult } from "@/lib/auth";
import {
  AuthSubmitButton,
  authLinkClass,
  emailSchema,
  firstError,
  showAuthError,
  showValidationError,
} from "./shared";

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe sua senha.").max(72),
});

export function LoginForm({ returnTo }: { returnTo?: string | null }) {
  const router = useRouter();
  const [success, setSuccess] = useState(false);
  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: {
      onSubmit: ({ value }) =>
        firstError(loginSchema, { ...value, email: value.email.trim() }),
    },
    onSubmitInvalid: ({ value }) =>
      showValidationError(
        firstError(loginSchema, { ...value, email: value.email.trim() }),
      ),
    onSubmit: async ({ value }) => {
      if (success) return;
      const email = value.email.trim();
      try {
        const result = unwrapActionResult(
          await loginAction({ email, password: value.password }),
        );
        setSuccess(true);
        router.replace(destinationAfterLogin(result, returnTo ?? null));
        router.refresh();
      } catch (cause) {
        if (cause instanceof Error && cause.name === "ACCOUNT_NOT_VERIFIED") {
          router.push(`/verify-email?email=${encodeURIComponent(email)}`);
        } else {
          showAuthError(cause);
        }
      }
    },
  });

  return (
    <form
      className="space-y-[11px]"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Field name="email">
        {(field) => (
          <Field className="gap-[3px]">
            <FieldLabel
              htmlFor={field.name}
              className="required text-base font-normal leading-5"
            >
              Email
            </FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              type="email"
              autoComplete="username"
              maxLength={254}
              placeholder="seu@email.com"
              required
              disabled={success}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="password">
        {(field) => (
          <Field className="gap-[3px]">
            <FieldLabel
              htmlFor={field.name}
              className="required text-base font-normal leading-5"
            >
              Senha
            </FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              type="password"
              autoComplete="current-password"
              maxLength={72}
              placeholder="Digite sua senha"
              required
              disabled={success}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>
      <div className="text-right text-sm leading-5">
        <Link
          href="/forgot-password"
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          esqueceu a senha
        </Link>
      </div>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <AuthSubmitButton
            pending={pending}
            success={success}
            label="Entrar"
            pendingLabel="Entrando..."
            successLabel="Entrando..."
          />
        )}
      </form.Subscribe>
      <p className="pt-1 text-center text-sm text-muted-foreground">
        Não tem uma conta?{" "}
        <Link
          href={
            returnTo
              ? `/register?returnTo=${encodeURIComponent(returnTo)}`
              : "/register"
          }
          className={authLinkClass}
        >
          Criar Conta
        </Link>
      </p>
    </form>
  );
}
