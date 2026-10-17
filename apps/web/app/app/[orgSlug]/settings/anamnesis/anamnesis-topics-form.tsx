"use client";

import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Loader2,
  Lock,
  Plus,
  Save,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  type AnamnesisTopic,
  DEFAULT_ANAMNESIS_TOPICS,
  isMandatoryTopic,
  normalizeTopicKey,
  reorderTopics,
} from "@/lib/anamnesis-topics";
import { updateAnamnesisTopicsAction } from "./actions";

export interface ProfessionalOption {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
}

interface AnamnesisTopicsFormProps {
  orgSlug: string;
  professionals: ProfessionalOption[];
  selectedProfessionalId: string;
  initialTopics: AnamnesisTopic[];
  initialVersion: number;
  currentUserId: string;
  currentUserRole?: string;
}

const QUICK_SUGGESTIONS = [
  {
    label: "Histórico Vacinal",
    description:
      "Registro de imunizações, vacinas aplicadas e doses de reforço.",
  },
  {
    label: "Hábitos de Vida",
    description:
      "Tabagismo, etilismo, atividade física, qualidade do sono e dieta.",
  },
  {
    label: "Exames Complementares",
    description:
      "Resultados recentes de exames laboratoriais, de imagem e testes gráficos.",
  },
  {
    label: "Histórico Cirúrgico",
    description:
      "Procedimentos cirúrgicos prévios, internações e intercorrências.",
  },
  {
    label: "Alergias e Reações",
    description:
      "Alergias medicamentosas, alimentares e reações adversas conhecidas.",
  },
];

export function AnamnesisTopicsForm({
  orgSlug,
  professionals,
  selectedProfessionalId,
  initialTopics,
  initialVersion,
  currentUserId,
  currentUserRole: _currentUserRole,
}: AnamnesisTopicsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [topics, setTopics] = useState<AnamnesisTopic[]>(initialTopics);
  const [version, setVersion] = useState<number>(initialVersion);
  const [isSaving, setIsSaving] = useState(false);

  // Drag and drop state
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Custom topic modal state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [customLabel, setCustomLabel] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);

  const selectedProfessional = professionals.find(
    (p) => p.userId === selectedProfessionalId,
  );

  const handleProfessionalChange = (newUserId: string) => {
    if (newUserId === selectedProfessionalId) return;
    startTransition(() => {
      router.push(
        `/app/${encodeURIComponent(orgSlug)}/settings/anamnesis?professionalId=${encodeURIComponent(newUserId)}`,
      );
    });
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const reordered = reorderTopics(topics, index, index - 1);
    setTopics(reordered);
  };

  const handleMoveDown = (index: number) => {
    if (index >= topics.length - 1) return;
    const reordered = reorderTopics(topics, index, index + 1);
    setTopics(reordered);
  };

  const handleToggleActive = (index: number, active: boolean) => {
    const topic = topics[index];
    if (!topic || isMandatoryTopic(topic.key)) return;

    const updated = [...topics];
    updated[index] = { ...topic, active };
    setTopics(updated);
  };

  const handleRemoveTopic = (index: number) => {
    const topic = topics[index];
    if (!topic || isMandatoryTopic(topic.key)) return;

    const updated = topics
      .filter((_, idx) => idx !== index)
      .map((t, idx) => ({ ...t, order: idx }));
    setTopics(updated);
    toast.info(`Tópico "${topic.label}" removido da estrutura.`);
  };

  const handleDragStart = (index: number, e: React.DragEvent) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (index: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (dropIndex: number, e: React.DragEvent) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const reordered = reorderTopics(topics, draggedIndex, dropIndex);
    setTopics(reordered);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleAddCustomTopic = (e: React.FormEvent) => {
    e.preventDefault();
    const label = customLabel.trim();
    if (!label) {
      setDialogError("Informe um título para o tópico.");
      return;
    }

    const key = normalizeTopicKey(label);
    if (topics.some((t) => t.key === key)) {
      setDialogError(
        "Já existe um tópico com identificador semelhante nesta lista.",
      );
      return;
    }

    const newTopic: AnamnesisTopic = {
      key,
      label,
      description: customDescription.trim() || undefined,
      required: false,
      active: true,
      order: topics.length,
    };

    setTopics([...topics, newTopic]);
    setIsDialogOpen(false);
    setCustomLabel("");
    setCustomDescription("");
    setDialogError(null);
    toast.success(`Tópico "${label}" adicionado à estrutura.`);
  };

  const handleSave = async () => {
    if (isSaving) return;

    // Safety validation
    const missingMandatory = DEFAULT_ANAMNESIS_TOPICS.filter(
      (t) => t.required,
    ).some(
      (mandatory) => !topics.some((t) => t.key === mandatory.key && t.active),
    );

    if (missingMandatory) {
      toast.error(
        "Tópicos obrigatórios (Queixa Principal e Conduta) devem estar presentes e ativos.",
      );
      return;
    }

    setIsSaving(true);
    try {
      const result = await updateAnamnesisTopicsAction(
        orgSlug,
        selectedProfessionalId,
        {
          version,
          topics: topics.map((t, idx) => ({
            key: t.key,
            label: t.label,
            description: t.description,
            active: isMandatoryTopic(t.key) ? true : (t.active ?? true),
            required: isMandatoryTopic(t.key),
            order: idx,
          })),
        },
      );

      if (result.ok) {
        toast.success("Estrutura de anamnese salva com sucesso!");
        setVersion(result.data.version);
        setTopics(result.data.topics);
      } else {
        toast.error(
          result.error.message || "Erro ao salvar estrutura de anamnese.",
        );
      }
    } catch {
      toast.error("Ocorreu um erro inesperado ao salvar os tópicos.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Informational Callout */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-2xs">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </div>
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">
            Configuração assistida por IA
          </p>
          <p className="text-muted-foreground">
            A estrutura configurada orienta as sugestões geradas por IA para
            este médico. Atendimentos já aprovados permanecem inalterados.
          </p>
        </div>
      </div>

      {/* Professional Selector */}
      <Card className="border-border bg-card text-card-foreground">
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-1">
            <CardTitle className="text-base font-semibold">
              Profissional Médico
            </CardTitle>
            <CardDescription>
              Selecione o profissional para visualizar e personalizar os tópicos
              clínicos de anamnese.
              {selectedProfessional && (
                <span className="block mt-1 font-medium text-foreground">
                  Configurações ativas para: {selectedProfessional.name}
                </span>
              )}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-w-md">
            <Label htmlFor="professional-select" className="sr-only">
              Selecione o médico
            </Label>
            {professionals.length > 0 ? (
              <Select
                value={selectedProfessionalId}
                onValueChange={handleProfessionalChange}
                disabled={isPending || isSaving}
              >
                <SelectTrigger
                  id="professional-select"
                  className="w-full justify-between"
                  aria-label="Selecionar profissional médico"
                >
                  <SelectValue placeholder="Selecione um profissional">
                    {selectedProfessional?.name}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {professionals.map((prof) => (
                    <SelectItem key={prof.userId} value={prof.userId}>
                      <div className="flex items-center gap-2">
                        <User className="size-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">
                          {prof.name}
                        </span>
                        {prof.userId === currentUserId && (
                          <span className="text-xs text-muted-foreground">
                            (Você)
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Nenhum profissional médico ativo encontrado nesta clínica.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Topics Management Section */}
      <div className="space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Ordem e Tópicos Clínicos
            </h2>
            <p className="text-sm text-muted-foreground">
              Arraste os itens ou use as setas para ajustar a ordem das seções
              na anamnese.
            </p>
          </div>

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={isSaving}
              >
                <Plus className="size-4" />
                Adicionar tópico customizado
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <form onSubmit={handleAddCustomTopic}>
                <DialogHeader>
                  <DialogTitle>Adicionar Tópico Customizado</DialogTitle>
                  <DialogDescription>
                    Crie uma seção específica para atender aos protocolos da sua
                    especialidade.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                  {dialogError && (
                    <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                      {dialogError}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="custom-label">Nome do Tópico</Label>
                    <Input
                      id="custom-label"
                      placeholder="ex: Histórico Vacinal"
                      value={customLabel}
                      onChange={(e) => {
                        setCustomLabel(e.target.value);
                        setDialogError(null);
                      }}
                      maxLength={120}
                      autoFocus
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="custom-description">
                      Descrição ou Orientações (opcional)
                    </Label>
                    <Textarea
                      id="custom-description"
                      placeholder="Oriente a IA sobre o que deve ser destacado nesta seção..."
                      value={customDescription}
                      onChange={(e) => setCustomDescription(e.target.value)}
                      maxLength={300}
                      rows={3}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Sugestões clínicas rápidas
                    </Label>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_SUGGESTIONS.map((suggestion) => (
                        <button
                          key={suggestion.label}
                          type="button"
                          className="rounded-full border border-border bg-secondary/50 px-2.5 py-1 text-xs text-secondary-foreground hover:bg-secondary transition-colors"
                          onClick={() => {
                            setCustomLabel(suggestion.label);
                            setCustomDescription(suggestion.description);
                            setDialogError(null);
                          }}
                        >
                          + {suggestion.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setIsDialogOpen(false);
                      setDialogError(null);
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit">Adicionar Tópico</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Topics List */}
        <ul
          className="space-y-2.5 list-none p-0 m-0"
          aria-label="Lista de tópicos de anamnese"
        >
          {topics.map((topic, index) => {
            const isMandatory = isMandatoryTopic(topic.key) || topic.required;
            const isDragging = draggedIndex === index;
            const isOver = dragOverIndex === index;

            return (
              <li
                key={topic.key}
                draggable={!isSaving}
                onDragStart={(e) => handleDragStart(index, e)}
                onDragOver={(e) => handleDragOver(index, e)}
                onDrop={(e) => handleDrop(index, e)}
                onDragEnd={handleDragEnd}
                className={`group flex items-center justify-between gap-3 rounded-xl border p-3.5 transition-all ${
                  isOver
                    ? "border-primary bg-primary/5 scale-[1.01]"
                    : "border-border bg-card text-card-foreground hover:border-border/80"
                } ${isDragging ? "opacity-40" : ""} ${
                  !topic.active ? "opacity-60 bg-muted/40" : ""
                }`}
              >
                {/* Left: Drag handle & order number */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none p-1 rounded hover:bg-muted"
                    aria-label={`Arrastar tópico ${topic.label}`}
                    title="Arrastar para reordenar"
                  >
                    <GripVertical className="size-4" />
                  </button>

                  <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">
                    {index + 1}
                  </div>

                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground">
                        {topic.label}
                      </span>
                      {isMandatory && (
                        <Badge
                          variant="secondary"
                          className="gap-1 text-[11px] font-medium"
                          title="Tópico obrigatório pelo prontuário clínico"
                        >
                          <Lock className="size-3" />
                          Obrigatório
                        </Badge>
                      )}
                      {!topic.active && (
                        <Badge
                          variant="outline"
                          className="text-[11px] text-muted-foreground"
                        >
                          Inativo
                        </Badge>
                      )}
                    </div>
                    {topic.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1 max-w-lg">
                        {topic.description}
                      </p>
                    )}
                  </div>
                </div>

                {/* Right: Reorder buttons, toggle & delete */}
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <div className="flex items-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0 || isSaving}
                      aria-label={`Mover ${topic.label} para cima`}
                      title="Mover para cima"
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-foreground"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === topics.length - 1 || isSaving}
                      aria-label={`Mover ${topic.label} para baixo`}
                      title="Mover para baixo"
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                  </div>

                  <div className="h-4 w-px bg-border mx-1" />

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={topic.active}
                      onCheckedChange={(checked) =>
                        handleToggleActive(index, checked)
                      }
                      disabled={isMandatory || isSaving}
                      aria-label={`Ativar ou desativar tópico ${topic.label}`}
                    />

                    {!isMandatory ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => handleRemoveTopic(index)}
                        disabled={isSaving}
                        aria-label={`Remover tópico ${topic.label}`}
                        title="Remover tópico customizado"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : (
                      <div className="size-8 flex items-center justify-center text-muted-foreground/40">
                        <Lock className="size-3.5" />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Save Button & Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
        <Button
          type="button"
          onClick={handleSave}
          disabled={isSaving || isPending}
          className="gap-2 min-w-44"
          aria-label="Salvar estrutura de tópicos"
        >
          {isSaving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Salvando alterações...
            </>
          ) : (
            <>
              <Save className="size-4" />
              Salvar Estrutura
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
