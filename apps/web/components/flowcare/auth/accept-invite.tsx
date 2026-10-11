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
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { formatInviteRole, type InviteDetails } from "@/lib/invites";
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

function InviteInfoCard({
  label,
  value,
  subvalue,
  avatarSeed,
  avatarUrl,
  badge,
}: {
  label: string;
  value: string;
  subvalue?: string;
  avatarSeed: string;
  avatarUrl?: string | null;
  badge?: string;
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar>
            <AvatarImage
              src={avatarUrl || dicebearInitialUrl(avatarSeed)}
              alt=""
              referrerPolicy="no-referrer"
            />
            <AvatarFallback>{initialLetter(avatarSeed)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <span className="block text-xs text-muted-foreground">{label}</span>
            <p className="truncate font-medium text-foreground">{value}</p>
            {subvalue && (
              <p className="truncate text-xs text-muted-foreground">
                {subvalue}
              </p>
            )}
          </div>
        </div>
        {badge && <Badge variant="outline">{badge}</Badge>}
      </CardContent>
    </Card>
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
            Convite para clínica
          </h2>
          <p className="text-sm text-muted-foreground">
            Você foi convidado para integrar a equipe desta clínica no Flowcare.
          </p>
        </div>
        <div className="space-y-3">
          <InviteInfoCard
            label="Clínica"
            value={invite.organizationName}
            avatarSeed={invite.organizationName}
            badge={formatInviteRole(invite.role)}
          />
          <InviteInfoCard
            label="Convite emitido para"
            value={invite.email}
            avatarSeed={invite.email}
          />
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
        <div className="space-y-3">
          <InviteInfoCard
            label="Clínica"
            value={invite.organizationName}
            avatarSeed={invite.organizationName}
            badge={formatInviteRole(invite.role)}
          />
          <InviteInfoCard
            label="Convite emitido para"
            value={invite.email}
            avatarSeed={invite.email}
          />
          <InviteInfoCard
            label="Sua sessão atual"
            value={currentUser.email}
            avatarSeed={currentUser.fullName || currentUser.email}
            avatarUrl={currentUser.photoUrl}
          />
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
          Convite para clínica
        </h2>
        <p className="text-sm text-muted-foreground">
          Você foi convidado para integrar a equipe desta clínica.
        </p>
      </div>
      <div className="space-y-3">
        <InviteInfoCard
          label="Clínica"
          value={invite.organizationName}
          avatarSeed={invite.organizationName}
          badge={formatInviteRole(invite.role)}
        />
        <InviteInfoCard
          label="Sua sessão atual"
          value={currentUser.fullName || currentUser.email}
          subvalue={currentUser.fullName ? currentUser.email : undefined}
          avatarSeed={currentUser.fullName || currentUser.email}
          avatarUrl={currentUser.photoUrl}
        />
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
