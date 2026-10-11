import type { Metadata } from "next";
import { RegisterForm } from "@/components/flowcare/auth/register-form";

export const metadata: Metadata = { title: "Cadastro | Flowcare" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const { returnTo } = await searchParams;
  return (
    <section aria-labelledby="auth-title">
      <h1
        id="auth-title"
        className="mb-3 text-center text-4xl font-normal leading-[44px] tracking-[-0.04em]"
      >
        Cadastro
      </h1>
      <RegisterForm returnTo={returnTo} />
    </section>
  );
}
