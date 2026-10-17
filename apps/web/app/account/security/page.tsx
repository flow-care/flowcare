import type { Metadata } from "next";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = {
  title: "Segurança da conta — Flowcare",
};

export default function AccountSecurityPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Segurança</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie a segurança da sua conta.
        </p>
      </div>
      <PasswordForm />
    </div>
  );
}
