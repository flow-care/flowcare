"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  acceptInviteAction,
  switchAccountAction,
} from "@/app/(auth)/accept-invite/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { formatInviteRole, type InviteDetails } from "@/lib/invites";
import type { CurrentUserProfile } from "@/server/invites";

interface AcceptInviteProps {
  token: string;
  invite: InviteDetails | null;
  currentUser: CurrentUserProfile | null;
}

export function AcceptInvite({
  token,
  invite,
  currentUser,
}: AcceptInviteProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const returnTo = `/accept-invite/${token}`;

  function handleAccept() {
    if (isPending) return;
    startTransition(async () => {
      try {
        const result = await acceptInviteAction(token);
        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }
        toast.success("Convite aceito com sucesso!");
        router.push(
          `/app/${encodeURIComponent(result.data.organizationSlug)}/dashboard`,
        );
        router.refresh();
      } catch {
        toast.error(
          "Não foi possível aceitar o convite no momento. Tente novamente.",
        );
      }
    });
  }

  function handleSwitchAccount() {
    if (isPending) return;
    startTransition(async () => {
      await switchAccountAction(returnTo);
    });
  }

  // Estado 1: Convite inválido, revogado ou expirado
  if (!invite) {
    return (
      <Card>
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-xl font-semibold tracking-tight text-foreground">
            Convite indisponível
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground mt-2">
            Este link de convite é inválido, expirou ou já foi aceito.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-2 text-center text-sm text-muted-foreground">
          <p>
            Caso você precise de acesso à clínica, solicite um novo convite ao
            administrador responsável.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 pt-2">
          <Button
            asChild
            className="h-[46px] w-full rounded-lg text-base font-normal"
          >
            <Link href="/login">Ir para o login</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // Estado 2: Usuário não autenticado
  if (!currentUser) {
    return (
      <Card>
        <CardHeader className="text-center pb-2">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Convite para clínica
          </p>
          <CardTitle className="text-2xl font-semibold tracking-tight text-foreground mt-1">
            {invite.organizationName}
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground mt-2">
            Você foi convidado para integrar a equipe desta clínica no Flowcare.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Função / Perfil:</span>
              <Badge variant="secondary" className="font-normal text-xs">
                {formatInviteRole(invite.role)}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">E-mail convidado:</span>
              <span className="font-medium text-foreground">
                {invite.email}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Para aceitar o convite, acesse sua conta existente ou crie uma conta
            com o e-mail indicado acima.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-3 pt-2">
          <Button
            asChild
            className="h-[46px] w-full rounded-lg text-base font-normal"
          >
            <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>
              Entrar na minha conta
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-[46px] w-full rounded-lg text-base font-normal"
          >
            <Link href={`/register?returnTo=${encodeURIComponent(returnTo)}`}>
              Criar nova conta
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // Estado 3: Usuário autenticado com e-mail diferente do convite
  const isEmailMismatch =
    currentUser.email.trim().toLowerCase() !==
    invite.email.trim().toLowerCase();

  if (isEmailMismatch) {
    return (
      <Card>
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-xl font-semibold tracking-tight text-foreground">
            E-mail incompatível
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground mt-2">
            Sua conta conectada não corresponde ao destinatário do convite.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2.5 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">
                Clínica
              </span>
              <span className="font-medium text-foreground">
                {invite.organizationName}
              </span>
            </div>
            <div>
              <span className="text-xs text-muted-foreground block">
                Convite emitido para
              </span>
              <span className="font-medium text-foreground">
                {invite.email}
              </span>
            </div>
            <div className="pt-2 border-t border-border">
              <span className="text-xs text-muted-foreground block">
                Sua sessão atual
              </span>
              <span className="font-medium text-foreground">
                {currentUser.email}
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Para aceitar este convite, saia da conta atual e entre utilizando o
            e-mail indicado no convite.
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleSwitchAccount}
            disabled={isPending}
            className="h-[46px] w-full rounded-lg text-base font-normal"
          >
            {isPending && <Spinner className="size-4 mr-2" />}
            Trocar de conta
          </Button>
        </CardFooter>
      </Card>
    );
  }

  // Estado 4: Usuário autenticado com e-mail correto — pronto para aceitar
  return (
    <Card>
      <CardHeader className="text-center pb-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Convite para clínica
        </p>
        <CardTitle className="text-2xl font-semibold tracking-tight text-foreground mt-1">
          {invite.organizationName}
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground mt-2">
          Você foi convidado para integrar a equipe desta clínica.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2.5 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Função / Perfil:</span>
            <Badge variant="secondary" className="font-normal text-xs">
              {formatInviteRole(invite.role)}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Conectado como:</span>
            <span className="font-medium text-foreground">
              {currentUser.fullName}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">E-mail:</span>
            <span className="text-foreground">{currentUser.email}</span>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 pt-2">
        <Button
          type="button"
          onClick={handleAccept}
          disabled={isPending}
          className="h-[46px] w-full rounded-lg text-base font-normal"
        >
          {isPending ? (
            <>
              <Spinner className="size-4 mr-2" />
              Aceitando convite...
            </>
          ) : (
            "Aceitar convite"
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
