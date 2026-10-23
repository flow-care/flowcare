"use client";

import { Loader2, RotateCcw, Save, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  PRESET_LABELS,
  type Preset,
  SENSITIVE_PERMISSION,
  SENSITIVE_PERMISSION_WARNING,
} from "@/lib/team-members";
import type { PermissionCatalog, TeamMember } from "@/server/team";
import { updateMemberPermissionsAction } from "./actions";

export function MemberPermissionsSheet({
  open,
  onOpenChange,
  orgSlug,
  member,
  catalog,
  isSoloClinic,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgSlug: string;
  member: TeamMember | null;
  catalog: PermissionCatalog | null;
  isSoloClinic: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(member?.permissions ?? []),
  );
  const [preset, setPreset] = useState<Preset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const catalogKey = catalog ? "ready" : "missing";
  const [loadedKey, setLoadedKey] = useState(catalogKey);
  if (loadedKey !== catalogKey) {
    setLoadedKey(catalogKey);
    setSelected(new Set(member?.permissions ?? []));
    setPreset(null);
    setError(null);
    setSaved(false);
  }

  const groups = catalog?.groups ?? [];
  const currentPreset = preset ?? member?.preset ?? "PROFESSIONAL";
  const presetPermissions = useMemo(
    () => new Set(catalog?.presets?.[currentPreset] ?? []),
    [catalog, currentPreset],
  );
  const changed =
    selected.size !== (member?.permissions?.length ?? 0) ||
    (member?.permissions ?? []).some((permission) => !selected.has(permission));
  const touchesSensitive = selected.has(SENSITIVE_PERMISSION);

  function toggle(permission: string) {
    setPreset(null);
    setSaved(false);
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }

  function applyPreset(next: Preset) {
    setPreset(next);
    setSaved(false);
    setSelected(new Set(catalog?.presets?.[next] ?? []));
  }

  function restoreCurrentPreset() {
    setPreset(null);
    setSaved(false);
    setSelected(new Set(member?.permissions ?? []));
  }

  function submit() {
    if (!member) return;
    setError(null);
    startTransition(async () => {
      const result = await updateMemberPermissionsAction(orgSlug, member.id, {
        permissions: [...selected],
        preset: preset ?? undefined,
        version: member.version,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            Permissões de {member?.userName ?? "colaborador"}
          </SheetTitle>
          <SheetDescription>
            O papel é só um ponto de partida. Marque o que esta pessoa pode
            fazer — vale na hora, sem criar outro papel.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
          {isSoloClinic && (
            <p
              className="rounded-md border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground"
              data-testid="solo-clinic-notice"
            >
              Clínica com um único membro: enquanto for assim, esta pessoa tem
              todas as permissões. As escolhas abaixo passam a valer quando
              entrar o segundo membro.
            </p>
          )}

          {!catalog && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              Não foi possível carregar a lista de permissões. Recarregue a
              página para tentar de novo.
            </p>
          )}

          <section className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              Começar de uma predefinição
            </h3>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PRESET_LABELS) as Preset[]).map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={preset === option ? "default" : "outline"}
                  size="sm"
                  onClick={() => applyPreset(option)}
                  data-testid={`apply-preset-${option}`}
                >
                  {PRESET_LABELS[option]}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={restoreCurrentPreset}
                disabled={!changed}
                data-testid="restore-permissions"
              >
                <RotateCcw className="size-3.5" />
                Desfazer
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Aplicar uma predefinição substitui as marcações abaixo. Depois
              você pode ajustar item por item.
            </p>
          </section>

          {groups.map((group) => (
            <section key={group.id} className="space-y-2">
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  {group.label}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {group.description}
                </p>
              </div>
              <ul className="space-y-1">
                {group.permissions.map((permission) => {
                  const isPresetItem = presetPermissions.has(permission.name);
                  const isSensitive = permission.name === SENSITIVE_PERMISSION;
                  return (
                    <li key={permission.name}>
                      <label
                        htmlFor={`permission-${permission.name}`}
                        className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/60"
                      >
                        <Checkbox
                          id={`permission-${permission.name}`}
                          checked={selected.has(permission.name)}
                          onCheckedChange={() => toggle(permission.name)}
                          className="mt-0.5"
                        />
                        <span className="flex-1">
                          <span className="flex items-center gap-2 text-sm text-foreground">
                            {permission.label}
                            {isSensitive && (
                              <Badge
                                variant="outline"
                                className="gap-1 border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400"
                              >
                                <ShieldAlert className="size-3" />
                                sensível
                              </Badge>
                            )}
                            {isPresetItem && !selected.has(permission.name) && (
                              <span className="text-[11px] text-muted-foreground">
                                (no preset)
                              </span>
                            )}
                          </span>
                          {permission.description && (
                            <span className="block text-xs text-muted-foreground">
                              {permission.description}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          {touchesSensitive && (
            <p
              className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300"
              data-testid="sensitive-permission-warning"
            >
              {SENSITIVE_PERMISSION_WARNING}
            </p>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
            >
              {error}
            </p>
          )}
          {saved && !error && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              Permissões atualizadas.
            </p>
          )}
        </div>

        <SheetFooter className="gap-2 border-t px-4 py-3 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Fechar
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={isPending || !member || !catalog || !changed}
            data-testid="save-permissions"
          >
            {isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Save className="mr-2 size-4" />
            )}
            Salvar permissões
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
