"use client";

import { EditorContent, type JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  CheckCheck,
  CloudOff,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveNotesAction } from "@/app/app/[orgSlug]/consultations/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const EMPTY_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
const LOCAL_PREFIX = "flowcare:notes:";
const SERVER_SAVE_DELAY_MS = 4000;

type SaveState = "idle" | "saving" | "saved" | "offline" | "error";

interface LocalDraft {
  rich: JSONContent;
  text: string;
  savedAt: number;
}

function draftKey(consultationId: string): string {
  return `${LOCAL_PREFIX}${consultationId}`;
}

function readLocalDraft(consultationId: string): LocalDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(consultationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalDraft>;
    if (!parsed || typeof parsed.savedAt !== "number") return null;
    if (!parsed.rich) return null;
    return {
      rich: parsed.rich as JSONContent,
      text: typeof parsed.text === "string" ? parsed.text : "",
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

function writeLocalDraft(consultationId: string, draft: LocalDraft): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      draftKey(consultationId),
      JSON.stringify(draft),
    );
  } catch {
    // Storage cheio/bloqueado: o autosave do servidor continua valendo.
  }
}

function clearLocalDraft(consultationId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(consultationId));
  } catch {
    // ignora
  }
}

function isEmptyDoc(rich: unknown): boolean {
  if (!rich || typeof rich !== "object") return true;
  const doc = rich as JSONContent;
  const content = doc.content;
  if (!Array.isArray(content) || content.length === 0) return true;
  return content.every(
    (node) =>
      node.type === "paragraph" && (!node.content || node.content.length === 0),
  );
}

function formatTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface ConsultationNotesEditorProps {
  orgSlug: string;
  consultationId: string;
  /** Documento salvo no servidor (ProseMirror JSON). */
  initialRich?: unknown;
  initialText?: string | null;
  serverSavedAt?: string | null;
  readOnly?: boolean;
}

export function ConsultationNotesEditor({
  orgSlug,
  consultationId,
  initialRich,
  initialText,
  serverSavedAt,
  readOnly = false,
}: ConsultationNotesEditorProps) {
  const serverSavedAtMs = serverSavedAt ? new Date(serverSavedAt).getTime() : 0;

  // Recupera o rascunho local mais recente que o servidor (queda de internet,
  // fechar o notebook, aba fechada por acidente).
  const [recovered] = useState<LocalDraft | null>(() => {
    const local = readLocalDraft(consultationId);
    if (!local) return null;
    return local.savedAt > serverSavedAtMs + 1500 ? local : null;
  });

  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(
    serverSavedAtMs || null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const serverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<{ rich: JSONContent; text: string }>({
    rich: EMPTY_DOC,
    text: "",
  });
  const savedText = useRef<string>(initialText ?? "");

  const initialContent: JSONContent =
    recovered && !recoveryDismissed
      ? recovered.rich
      : !isEmptyDoc(initialRich)
        ? (initialRich as JSONContent)
        : EMPTY_DOC;

  const flushServer = useCallback(async () => {
    const { rich, text } = latest.current;
    if (readOnly) return;
    if (text === savedText.current) return;

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSaveState("offline");
      return;
    }

    setSaveState("saving");
    const result = await saveNotesAction(orgSlug, consultationId, {
      rich,
      text,
    });
    if (result.success) {
      savedText.current = text;
      setSaveState("saved");
      setLastSavedAt(Date.now());
      setErrorMessage(null);
      clearLocalDraft(consultationId);
    } else {
      setSaveState("error");
      setErrorMessage(result.error ?? null);
    }
  }, [consultationId, orgSlug, readOnly]);

  const scheduleServerSave = useCallback(() => {
    if (readOnly) return;
    if (serverTimer.current) clearTimeout(serverTimer.current);
    serverTimer.current = setTimeout(() => {
      void flushServer();
    }, SERVER_SAVE_DELAY_MS);
  }, [flushServer, readOnly]);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent,
    editable: !readOnly,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "tiptap min-h-[22rem] w-full px-4 py-3 text-sm leading-relaxed text-foreground focus:outline-none",
      },
    },
    onUpdate: ({ editor: instance }) => {
      const rich = instance.getJSON();
      const text = instance.getText();
      latest.current = { rich, text };

      // Local primeiro (síncrono): nada se perde se a aba morrer agora.
      writeLocalDraft(consultationId, { rich, text, savedAt: Date.now() });
      if (saveState !== "saving") setSaveState("idle");
      scheduleServerSave();
    },
  });

  useEffect(() => {
    if (editor) {
      latest.current = {
        rich: editor.getJSON(),
        text: editor.getText(),
      };
      savedText.current = initialText ?? "";
    }
  }, [editor, initialText]);

  useEffect(() => {
    const handleOffline = () => setSaveState("offline");
    const handleOnline = () => {
      setSaveState("idle");
      void flushServer();
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [flushServer]);

  useEffect(() => {
    return () => {
      if (serverTimer.current) clearTimeout(serverTimer.current);
    };
  }, []);

  const status = (() => {
    if (readOnly) return { icon: null, text: "Somente leitura" };
    if (saveState === "saving")
      return { icon: Loader2, text: "Salvando…", spin: true };
    if (saveState === "offline")
      return {
        icon: WifiOff,
        text: "Sem internet — salvo neste dispositivo",
      };
    if (saveState === "error")
      return {
        icon: CloudOff,
        text: errorMessage ?? "Falha ao enviar — salvo neste dispositivo",
      };
    if (lastSavedAt)
      return { icon: CheckCheck, text: `Salvo às ${formatTime(lastSavedAt)}` };
    return { icon: null, text: "As alterações são salvas automaticamente" };
  })();

  const StatusIcon = status.icon;

  return (
    <div className="rounded-xl border border-border bg-card shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <ToolbarButton
            label="Negrito"
            active={editor?.isActive("bold")}
            disabled={readOnly || !editor}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Itálico"
            active={editor?.isActive("italic")}
            disabled={readOnly || !editor}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Tachado"
            active={editor?.isActive("strike")}
            disabled={readOnly || !editor}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >
            <Strikethrough className="size-4" />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton
            label="Título"
            active={editor?.isActive("heading", { level: 2 })}
            disabled={readOnly || !editor}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            <Heading2 className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Lista"
            active={editor?.isActive("bulletList")}
            disabled={readOnly || !editor}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Lista numerada"
            active={editor?.isActive("orderedList")}
            disabled={readOnly || !editor}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Citação"
            active={editor?.isActive("blockquote")}
            disabled={readOnly || !editor}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote className="size-4" />
          </ToolbarButton>
          <span className="mx-1 h-5 w-px bg-border" />
          <ToolbarButton
            label="Desfazer"
            disabled={readOnly || !editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 className="size-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Refazer"
            disabled={readOnly || !editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 className="size-4" />
          </ToolbarButton>
        </div>

        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs",
            saveState === "error" || saveState === "offline"
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground",
          )}
          data-testid="notes-save-status"
        >
          {StatusIcon ? (
            <StatusIcon
              className={cn("size-3.5", status.spin && "animate-spin")}
            />
          ) : null}
          {status.text}
        </span>
      </div>

      {recovered && !recoveryDismissed ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200"
          data-testid="notes-recovery-banner"
        >
          <span>
            Recuperamos o que você escreveu às {formatTime(recovered.savedAt)},
            que ainda não tinha chegado ao servidor.
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              clearLocalDraft(consultationId);
              setRecoveryDismissed(true);
            }}
          >
            Descartar recuperação
          </Button>
        </div>
      ) : null}

      <EditorContent editor={editor} />

      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <span>
          Escreva livremente: queixa, história, exame, conduta. A IA organiza no
          documento ao finalizar.
        </span>
        <span>
          {latest.current.text.trim()
            ? `${latest.current.text.trim().split(/\s+/).length} palavras`
            : ""}
        </span>
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "size-8 rounded-md",
        active && "bg-primary/10 text-primary hover:bg-primary/15",
      )}
    >
      {children}
    </Button>
  );
}
