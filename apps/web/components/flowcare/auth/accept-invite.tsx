"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import {
  acceptInviteAction,
  switchAccountAction,
} from "@/app/(auth)/accept-invite/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { InviteDetails } from "@/lib/invites";
import type { CurrentUserProfile } from "@/server/invites";

interface AcceptInviteProps {
  token: string;
  invite: InviteDetails | null;
  currentUser: CurrentUserProfile | null;
}

function dicebearInitialUrl(value: string) {
  const seed = value.includes("@") ? value.split("@")[0] : value.trim();
  return `https://api.dicebear.com/10.x/initials/svg?seed=${encodeURIComponent(seed || value)}&lettersVariant=single`;
}

function initialLetter(value: string) {
  return value.trim().charAt(0).toUpperCase() || "?";
}

function ClinicHeader({ organizationName }: { organizationName: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-1 text-center">
      <Avatar className="size-20">
        <AvatarImage
          src={dicebearInitialUrl(organizationName)}
          alt={organizationName}
          referrerPolicy="no-referrer"
        />
        <AvatarFallback className="text-2xl font-semibold">
          {initialLetter(organizationName)}
        </AvatarFallback>
      </Avatar>
      <h3 className="text-2xl font-semibold tracking-tight text-foreground">
        {organizationName}
      </h3>
    </div>
  );
}

function CurrentSessionBadge({
  currentUser,
}: {
  currentUser: CurrentUserProfile;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        Sua sessão atual
      </span>
      <div className="flex">
        <Badge
          variant="outline"
          className="inline-flex items-center gap-2 px-3 py-1.5 font-normal"
        >
          <Avatar className="size-5">
            <AvatarImage
              src={
                currentUser.photoUrl || dicebearInitialUrl(currentUser.email)
              }
              alt=""
              referrerPolicy="no-referrer"
            />
            <AvatarFallback className="text-[10px]">
              {initialLetter(currentUser.email)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate text-xs font-medium text-foreground">
            {currentUser.email}
          </span>
        </Badge>
      </div>
    </div>
  );
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
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Convite indisponível
          </h2>
          <p className="text-sm text-muted-foreground">
            Este link de convite é inválido, expirou ou já foi aceito.
          </p>
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Caso você precise de acesso à clínica, solicite um novo convite ao
          administrador responsável.
        </p>
        <Button asChild size="form" className="w-full">
          <Link href="/login">Ir para o login</Link>
        </Button>
      </div>
    );
  }

  // Estado 2: Usuário não autenticado
  if (!currentUser) {
    return (
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Convite para equipe
          </h2>
          <p className="text-sm text-muted-foreground">
            Você recebeu um link de convite para entrar na organização.
          </p>
        </div>
        <ClinicHeader organizationName={invite.organizationName} />
        <div className="flex items-center gap-3 rounded-lg bg-card p-3 shadow-none">
          <Avatar className="size-10">
            <AvatarImage
              src={dicebearInitialUrl(invite.email)}
              alt=""
              referrerPolicy="no-referrer"
            />
            <AvatarFallback>{initialLetter(invite.email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">
              Convite emitido para
            </span>
            <p className="truncate font-medium text-foreground">
              {invite.email}
            </p>
          </div>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Para aceitar o convite, acesse sua conta existente ou crie uma conta
          com o e-mail indicado acima.
        </p>
        <div className="flex flex-col gap-3">
          <Button asChild size="form" className="w-full">
            <Link href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>
              Entrar na minha conta
            </Link>
          </Button>
          <Button asChild variant="secondary" size="form" className="w-full">
            <Link href={`/register?returnTo=${encodeURIComponent(returnTo)}`}>
              Criar nova conta
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // Estado 3: Usuário autenticado com e-mail diferente do convite
  const isEmailMismatch =
    currentUser.email.trim().toLowerCase() !==
    invite.email.trim().toLowerCase();

  if (isEmailMismatch) {
    return (
      <div className="space-y-6">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            E-mail incompatível
          </h2>
          <p className="text-sm text-muted-foreground">
            Sua conta conectada não corresponde ao destinatário do convite.
          </p>
        </div>
        <ClinicHeader organizationName={invite.organizationName} />
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-card p-3 shadow-none">
            <Avatar className="size-10">
              <AvatarImage
                src={dicebearInitialUrl(invite.email)}
                alt=""
                referrerPolicy="no-referrer"
              />
              <AvatarFallback>{initialLetter(invite.email)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <span className="block text-xs text-muted-foreground">
                Convite emitido para
              </span>
              <p className="truncate font-medium text-foreground">
                {invite.email}
              </p>
            </div>
          </div>
          <CurrentSessionBadge currentUser={currentUser} />
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Para aceitar este convite, saia da conta atual e entre utilizando o
          e-mail indicado no convite.
        </p>
        <Button
          type="button"
          size="form"
          onClick={handleSwitchAccount}
          disabled={isPending}
          className="w-full"
        >
          {isPending && <Spinner className="mr-2 size-4" />}
          Trocar de conta
        </Button>
      </div>
    );
  }

  // Estado 4: Usuário autenticado com e-mail correto — pronto para aceitar
  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Convite para equipe
        </h2>
        <p className="text-sm text-muted-foreground">
          Você recebeu um link de convite para entrar na organização.
        </p>
      </div>
      <ClinicHeader organizationName={invite.organizationName} />
      <div className="space-y-4">
        <CurrentSessionBadge currentUser={currentUser} />
      </div>
      <Button
        type="button"
        size="form"
        onClick={handleAccept}
        disabled={isPending}
        className="w-full"
      >
        {isPending ? (
          <>
            <Spinner className="mr-2 size-4" />
            Aceitando convite...
          </>
        ) : (
          "Aceitar convite"
        )}
      </Button>
    </div>
  );
}
