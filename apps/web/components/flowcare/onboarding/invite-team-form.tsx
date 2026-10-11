"use client";

import { useForm } from "@tanstack/react-form";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  finishTeamInvites,
  sendTeamInvite,
  updateTeamInvite,
} from "@/app/onboarding/invite-team/actions";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  formatInviteRole,
  type InviteRole,
  inviteFormSchema,
  type PendingInvite,
} from "@/lib/invites";

type InviteList = { data: PendingInvite[]; roles: InviteRole[] };
const buttonClass = "h-[46px] rounded-lg px-5 text-base font-normal";

export function InviteTeamForm({
  initial,
  loadError = false,
}: {
  initial: InviteList;
  loadError?: boolean;
}) {
  const router = useRouter();
  const [invites, setInvites] = useState(initial.data);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const form = useForm({
    defaultValues: {
      email: "",
      role: initial.roles.includes("PROFESSIONAL")
        ? "PROFESSIONAL"
        : (initial.roles[0] ?? "PROFESSIONAL"),
    },
    validators: {
      onSubmit: ({ value }) => {
        const parsed = inviteFormSchema.safeParse(value);
        return parsed.success ? undefined : parsed.error.issues[0]?.message;
      },
    },
    onSubmitInvalid: ({ value }) => {
      const parsed = inviteFormSchema.safeParse(value);
      toast.error(
        parsed.success
          ? "Confira os dados do convite."
          : parsed.error.issues[0]?.message,
      );
    },
    onSubmit: async ({ value }) => {
      const result = await sendTeamInvite(value);
      if (!result.ok) {
        if ("data" in result && result.data) setInvites(result.data.data);
        toast.error(
          result.code === "ALREADY_EXISTS"
            ? "Esta pessoa já pertence à clínica ou tem um convite pendente."
            : result.message,
        );
        return;
      }
      setInvites(result.data.data);
      form.setFieldValue("email", "");
      toast.success("Convite enviado.");
    },
  });

  async function update(id: string, operation: "resend" | "revoke") {
    setBusyId(id);
    try {
      const result = await updateTeamInvite(id, operation);
      if (!result.ok) {
        if ("data" in result && result.data) setInvites(result.data.data);
        toast.error(result.message);
        return;
      }
      setInvites(result.data.data);
      toast.success(
        operation === "resend" ? "Convite reenviado." : "Convite revogado.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function finish() {
    setFinishing(true);
    try {
      const result = await finishTeamInvites();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.replace("/app");
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="mt-8 space-y-7">
      {loadError && (
        <output className="block text-sm text-muted-foreground">
          Não foi possível carregar os convites. Você pode continuar e convidar
          a equipe depois.
        </output>
      )}
      {!loadError && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
          noValidate
          className="space-y-5"
        >
          <form.Field name="email">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="invite-email" className="required">
                  E-mail
                </FieldLabel>
                <Input
                  id="invite-email"
                  name={field.name}
                  type="email"
                  autoComplete="email"
                  placeholder="pessoa@exemplo.com"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={!field.state.meta.isValid}
                  required
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="role">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="invite-role" className="required">
                  Papel
                </FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as InviteRole)
                  }
                >
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue placeholder="Selecione um papel" />
                  </SelectTrigger>
                  <SelectContent>
                    {initial.roles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {formatInviteRole(role)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>
          <div className="flex justify-end">
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(pending) => (
                <Button
                  type="submit"
                  className={buttonClass}
                  disabled={pending || finishing || Boolean(busyId)}
                >
                  {pending ? (
                    <>
                      <Spinner className="mr-2 size-4" />
                      Enviando...
                    </>
                  ) : (
                    "Enviar convite"
                  )}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      )}

      <section aria-labelledby="pending-invites-title" className="space-y-3">
        <h2 id="pending-invites-title" className="text-base font-medium">
          Convites pendentes
        </h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum convite pendente.
          </p>
        ) : (
          <ul className="space-y-3">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-card p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{invite.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatInviteRole(invite.role)} · Aguardando aceite
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={Boolean(busyId) || finishing}
                    onClick={() => void update(invite.id, "resend")}
                  >
                    {busyId === invite.id ? (
                      <Spinner className="size-4" />
                    ) : (
                      "Reenviar"
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={Boolean(busyId) || finishing}
                    onClick={() => void update(invite.id, "revoke")}
                  >
                    Revogar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex items-center justify-end gap-3 pt-2">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(pending) => (
            <Button
              type="button"
              className={buttonClass}
              disabled={finishing || pending || Boolean(busyId)}
              onClick={() => void finish()}
            >
              {finishing ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  Concluindo...
                </>
              ) : invites.length ? (
                "Continuar"
              ) : (
                "Pular por enquanto"
              )}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </div>
  );
}
