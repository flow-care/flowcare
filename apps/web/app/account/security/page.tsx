import { listAccountSessions } from "@/server/account-sessions";
import { PasswordForm } from "./password-form";
import { ActiveSessionsList } from "./sessions-list";

export const metadata: Metadata = {
  title: "Segurança da conta — Flowcare",
};

export default async function AccountSecurityPage() {
  const sessionsResult = await listAccountSessions();
  const initialSessions = sessionsResult.ok ? sessionsResult.sessions : [];

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Segurança</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie a segurança da sua conta, credenciais e dispositivos
          conectados.
        </p>
      </div>

      <PasswordForm />

      <ActiveSessionsList initialSessions={initialSessions} />
    </div>
  );
}
