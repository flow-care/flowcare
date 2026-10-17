import { AlertCircle, RefreshCw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { UserProfile } from "@/lib/account-profile";
import { getProfile } from "@/server/account";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = {
  title: "Meu Perfil — Flowcare",
  description: "Gerencie seus dados pessoais e foto de identificação",
};

export default async function AccountProfilePage() {
  let profile: UserProfile | null = null;
  let loadError: string | null = null;

  try {
    profile = await getProfile();
  } catch (err) {
    loadError =
      err instanceof Error
        ? err.message
        : "Não foi possível carregar os dados do seu perfil.";
  }

  if (loadError || !profile) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Meu Perfil
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie seus dados pessoais e foto de identificação
          </p>
        </div>

        <Card className="border-destructive/20 bg-destructive/5 p-6 shadow-xs">
          <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertCircle className="size-5" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-destructive">
                Erro ao carregar seu perfil
              </h2>
              <p className="text-sm text-muted-foreground">{loadError}</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/account/profile">
                <RefreshCw className="mr-2 size-4" />
                Tentar novamente
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Meu Perfil
        </h1>
        <p className="text-sm text-muted-foreground">
          Gerencie seus dados pessoais e foto de identificação
        </p>
      </div>

      <ProfileForm initialProfile={profile} />
    </div>
  );
}
