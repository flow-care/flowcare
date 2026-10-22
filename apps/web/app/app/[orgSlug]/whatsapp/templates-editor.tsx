"use client";

import { useForm } from "@tanstack/react-form";
import {
  AlertCircleIcon,
  CheckCheckIcon,
  Loader2Icon,
  RotateCcwIcon,
  SaveIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buildPreviewSegments,
  DEFAULT_TEMPLATE_CONTENT,
  insertTemplateVariable,
  TEMPLATE_MAX_LENGTH,
  TEMPLATE_META,
  TEMPLATE_VARIABLES,
  VARIABLE_DESCRIPTIONS,
  validateTemplateContent,
  type WhatsAppTemplateItem,
  type WhatsAppTemplateType,
} from "@/lib/whatsapp";
import { saveTemplateAction } from "./actions";

interface TemplateEntry {
  type: WhatsAppTemplateType;
  saved: WhatsAppTemplateItem | null;
}

export function TemplatesEditor({
  orgSlug,
  templates,
}: {
  orgSlug: string;
  templates: TemplateEntry[];
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        <p>
          Estes são os três textos enviados automaticamente aos pacientes que
          autorizaram contato por WhatsApp.{" "}
          <strong>
            Salvar um texto equivale a revisá-lo e ativá-lo imediatamente
          </strong>
          : não há rascunho. Use apenas informações logísticas e nunca inclua
          diagnóstico, medicamento ou dados clínicos.
        </p>
      </div>
      {templates.map((entry) => (
        <TemplateCard
          key={`${entry.type}:${entry.saved?.version ?? 0}`}
          orgSlug={orgSlug}
          entry={entry}
        />
      ))}
    </div>
  );
}

function TemplateCard({
  orgSlug,
  entry,
}: {
  orgSlug: string;
  entry: TemplateEntry;
}) {
  const { type } = entry;
  const router = useRouter();
  const meta = TEMPLATE_META[type];
  const maxLength = entry.saved?.maxLength ?? TEMPLATE_MAX_LENGTH;
  const defaultContent = DEFAULT_TEMPLATE_CONTENT[type];

  const [saved, setSaved] = useState({
    content: entry.saved?.content ?? defaultContent,
    version: entry.saved?.version ?? 0,
  });
  const [confirmRestore, setConfirmRestore] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const savingRef = useRef(false);

  const form = useForm({
    defaultValues: { content: saved.content },
    validators: {
      onChange: ({ value }) => {
        const result = validateTemplateContent(type, value.content, maxLength);
        return result.ok ? undefined : result.issues[0]?.message;
      },
    },
    onSubmit: async ({ value }) => {
      if (savingRef.current) return;
      savingRef.current = true;
      try {
        const result = await saveTemplateAction(orgSlug, type, {
          content: value.content,
          version: saved.version,
        });
        if (result.ok) {
          setSaved({
            content: result.template.content,
            version: result.template.version,
          });
          form.reset({ content: result.template.content });
          toast.success(`${meta.label}: texto salvo e ativado.`);
          router.refresh();
          return;
        }
        toast.error(result.message);
        if (result.code === "VERSION_CONFLICT") router.refresh();
      } catch {
        toast.error("Não foi possível salvar o texto. Tente novamente.");
      } finally {
        savingRef.current = false;
      }
    },
  });

  const insertVariable = (variable: string, current: string) => {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? current.length;
    const end = element?.selectionEnd ?? current.length;
    const next = insertTemplateVariable(current, start, end, variable);
    form.setFieldValue("content", next.content);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const textareaId = `template-${type}`;
  const isConfigured = saved.version > 0;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <form.Subscribe
        selector={(state) => ({
          content: state.values.content,
          isSubmitting: state.isSubmitting,
        })}
      >
        {({ content, isSubmitting }) => {
          const validation = validateTemplateContent(type, content, maxLength);
          const dirty = content !== saved.content;
          const overLimit = validation.length > maxLength;
          const nearLimit = !overLimit && validation.length > maxLength * 0.9;
          const unchangedConfigured = !dirty && isConfigured;
          const canSave =
            validation.ok && !isSubmitting && !unchangedConfigured;

          return (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle>{meta.label}</CardTitle>
                    <CardDescription>{meta.description}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {dirty ? (
                      <Badge variant="outline">Alterações não salvas</Badge>
                    ) : null}
                    {isConfigured ? (
                      <Badge variant="secondary">Versão {saved.version}</Badge>
                    ) : (
                      <Badge variant="destructive">
                        Não configurado — nada é enviado
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label
                      htmlFor={textareaId}
                      className="text-sm font-medium text-foreground"
                    >
                      Texto da mensagem
                    </label>
                    <Textarea
                      id={textareaId}
                      ref={textareaRef}
                      rows={6}
                      value={content}
                      onChange={(event) =>
                        form.setFieldValue("content", event.target.value)
                      }
                      aria-invalid={!validation.ok}
                      aria-describedby={`${textareaId}-help`}
                      disabled={isSubmitting}
                      className={cn(
                        !validation.ok &&
                          "border-destructive focus-visible:ring-destructive/30",
                      )}
                    />
                    <div
                      id={`${textareaId}-help`}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="text-muted-foreground">
                        {isConfigured
                          ? "Ao salvar, a nova versão passa a valer para os próximos envios."
                          : "Texto sugerido. Revise e salve para ativar o envio."}
                      </span>
                      <span
                        className={cn(
                          "tabular-nums",
                          overLimit
                            ? "font-semibold text-destructive"
                            : nearLimit
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground",
                        )}
                      >
                        {validation.length}/{maxLength}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      Clique para inserir uma variável
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {TEMPLATE_VARIABLES[type].map((variable) => (
                        <button
                          key={variable}
                          type="button"
                          title={VARIABLE_DESCRIPTIONS[variable]}
                          disabled={isSubmitting}
                          onClick={() => insertVariable(variable, content)}
                          className="rounded-full border border-border bg-muted/60 px-2.5 py-1 font-mono text-xs text-foreground transition-colors hover:border-primary hover:bg-primary/10 disabled:opacity-50"
                        >
                          {`{${variable}}`}
                        </button>
                      ))}
                    </div>
                    {type === "APPOINTMENT_CANCELLATION" ? (
                      <p className="text-xs text-muted-foreground">
                        {"{medico_nome}"} não está disponível na mensagem de
                        cancelamento.
                      </p>
                    ) : null}
                  </div>

                  {validation.issues.length > 0 ? (
                    <ul
                      role="alert"
                      className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                    >
                      {validation.issues.map((issue) => (
                        <li key={issue.kind} className="flex gap-2">
                          <AlertCircleIcon
                            className="mt-0.5 size-4 shrink-0"
                            aria-hidden
                          />
                          <span>{issue.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                <PhonePreview type={type} content={content} />
              </CardContent>

              <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t border-border">
                <Button
                  type="button"
                  variant="ghost"
                  className="gap-2 text-muted-foreground"
                  disabled={isSubmitting || content === defaultContent}
                  onClick={() => setConfirmRestore(true)}
                >
                  <RotateCcwIcon className="size-4" aria-hidden />
                  Restaurar padrão
                </Button>
                <Button type="submit" disabled={!canSave} className="gap-2">
                  {isSubmitting ? (
                    <Loader2Icon className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <SaveIcon className="size-4" aria-hidden />
                  )}
                  {isSubmitting ? "Salvando…" : "Salvar e ativar"}
                </Button>
              </CardFooter>
            </Card>
          );
        }}
      </form.Subscribe>

      <AlertDialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar o texto padrão?</AlertDialogTitle>
            <AlertDialogDescription>
              O texto atual de “{meta.label}” será substituído pelo texto padrão
              do sistema no editor. Nada muda para os pacientes até que você
              clique em “Salvar e ativar”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                form.setFieldValue("content", defaultContent);
                toast.info("Texto padrão restaurado. Salve para ativar.");
              }}
            >
              Restaurar padrão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

function PhonePreview({
  type,
  content,
}: {
  type: WhatsAppTemplateType;
  content: string;
}) {
  const segments = buildPreviewSegments(type, content);
  return (
    <section
      className="mx-auto w-full max-w-xs"
      aria-label="Prévia da mensagem"
    >
      <p className="mb-2 text-center text-xs font-medium text-muted-foreground">
        Prévia com dados fictícios
      </p>
      <div className="overflow-hidden rounded-[2rem] border-4 border-foreground/80 bg-[#efeae2] shadow-md dark:bg-[#0b141a]">
        <div className="flex items-center gap-2 bg-[#008069] px-4 py-2.5 text-white dark:bg-[#202c33]">
          <div className="flex size-7 items-center justify-center rounded-full bg-white/25 text-xs font-semibold">
            C
          </div>
          <div className="leading-tight">
            <p className="text-sm font-medium">Clínica Exemplo</p>
            <p className="text-[10px] opacity-80">conta comercial</p>
          </div>
        </div>
        <div className="min-h-44 p-3">
          <div className="max-w-[90%] rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm dark:bg-[#202c33] dark:text-neutral-100">
            <p className="whitespace-pre-wrap break-words">
              {segments.length === 0 ? (
                <span className="text-neutral-400">
                  A mensagem aparecerá aqui.
                </span>
              ) : (
                segments.map((segment, index) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and have no stable identity
                    key={index}
                    className={cn(
                      segment.kind === "value" && "font-semibold",
                      segment.kind === "invalid" &&
                        "rounded bg-red-100 px-0.5 font-mono text-red-700 underline decoration-wavy dark:bg-red-950 dark:text-red-300",
                    )}
                  >
                    {segment.text}
                  </span>
                ))
              )}
            </p>
            <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-neutral-500">
              14:30
              <CheckCheckIcon className="size-3 text-sky-500" aria-hidden />
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
