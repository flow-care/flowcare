import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/flowcare/auth/login-form";
import { getOnboardingProgress } from "@/server/onboarding";
import { getSessionToken } from "@/server/session";

export const metadata: Metadata = { title: "Entrar | Flowcare" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;

  // Sessão expirada deixa o cookie no navegador: só pula o formulário quando a
  // API confirma que a sessão ainda vale. Sem isto o usuário entra em laço.
  const token = await getSessionToken();
  if (token && (await getOnboardingProgress())) {
    redirect("/");
  }

  return (
    <section aria-labelledby="auth-title">
      <h1
        id="auth-title"
        className="mb-3 text-center text-4xl font-normal leading-[44px] tracking-[-0.04em]"
      >
        Entrar
      </h1>
      <LoginForm returnTo={returnTo} />
    </section>
  );
}
