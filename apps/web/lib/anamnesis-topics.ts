import { z } from "zod";

export const MANDATORY_TOPIC_KEYS = ["chief_complaint", "conduct"] as const;

export type MandatoryTopicKey = (typeof MANDATORY_TOPIC_KEYS)[number];

export function isMandatoryTopic(key: string): boolean {
  return key === "chief_complaint" || key === "conduct";
}

export const anamnesisTopicSchema = z.object({
  id: z.string().optional(),
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]{0,63}$/, {
      message:
        "Identificador deve iniciar com letra e conter apenas letras minúsculas, números e sublinhados.",
    }),
  label: z
    .string()
    .trim()
    .min(1, { message: "O título do tópico é obrigatório." })
    .max(120, { message: "O título não pode ter mais de 120 caracteres." }),
  description: z.string().trim().max(300).optional(),
  required: z.boolean().default(false),
  active: z.boolean().default(true),
  order: z.number().int().min(0),
});

export type AnamnesisTopic = z.infer<typeof anamnesisTopicSchema>;

export const doctorAnamnesisTopicsResponseSchema = z.object({
  professionalId: z.string(),
  version: z.number().int().min(0),
  revisionId: z.string().nullable().optional(),
  topics: z.array(anamnesisTopicSchema),
});

export type DoctorAnamnesisTopicsResponse = z.infer<
  typeof doctorAnamnesisTopicsResponseSchema
>;

export const updateDoctorAnamnesisTopicsPayloadSchema = z.object({
  version: z.number().int().min(0).optional(),
  topics: z.array(
    z.object({
      id: z.string().optional(),
      key: z.string().min(1).max(64),
      label: z.string().trim().min(1).max(120),
      description: z.string().optional(),
      required: z.boolean().optional(),
      active: z.boolean().optional(),
      order: z.number().int().min(0),
    }),
  ),
});

export type UpdateDoctorAnamnesisTopicsPayload = z.infer<
  typeof updateDoctorAnamnesisTopicsPayloadSchema
>;

export const DEFAULT_ANAMNESIS_TOPICS: AnamnesisTopic[] = [
  {
    key: "chief_complaint",
    label: "Queixa Principal",
    description: "Motivo relatado pelo paciente na consulta médica.",
    required: true,
    active: true,
    order: 0,
  },
  {
    key: "hda",
    label: "História da Doença Atual (HDA)",
    description:
      "Evolução cronológica dos sintomas, início, duração e fatores de piora/melhora.",
    required: false,
    active: true,
    order: 1,
  },
  {
    key: "antecedents",
    label: "Antecedentes Pessoais e Familiares",
    description:
      "Comorbidades prévias, histórico familiar, medicamentos em uso e alergias.",
    required: false,
    active: true,
    order: 2,
  },
  {
    key: "physical_exam",
    label: "Exame Físico",
    description:
      "Achados objetivos, sinais vitais e avaliação física do paciente.",
    required: false,
    active: true,
    order: 3,
  },
  {
    key: "conduct",
    label: "Conduta e Hipótese Diagnóstica",
    description:
      "Conclusão diagnóstica, prescrições, encaminhamentos e plano terapêutico.",
    required: true,
    active: true,
    order: 4,
  },
];

export function normalizeTopicKey(label: string): string {
  const normalized = label
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

  if (!normalized || !/^[a-z]/.test(normalized)) {
    return `topico_${normalized || Math.random().toString(36).slice(2, 8)}`;
  }
  return normalized;
}

export function reorderTopics(
  topics: AnamnesisTopic[],
  fromIndex: number,
  toIndex: number,
): AnamnesisTopic[] {
  if (
    fromIndex < 0 ||
    fromIndex >= topics.length ||
    toIndex < 0 ||
    toIndex >= topics.length ||
    fromIndex === toIndex
  ) {
    return topics;
  }

  const updated = [...topics];
  const [moved] = updated.splice(fromIndex, 1);
  if (!moved) return topics;
  updated.splice(toIndex, 0, moved);

  return updated.map((topic, index) => ({
    ...topic,
    order: index,
  }));
}

export function mergeWithDefaultTopics(
  topics?: AnamnesisTopic[] | null,
): AnamnesisTopic[] {
  if (!topics || topics.length === 0) {
    return DEFAULT_ANAMNESIS_TOPICS.map((t, idx) => ({
      ...t,
      order: idx,
      required: isMandatoryTopic(t.key),
      active: true,
    }));
  }

  // Ensure mandatory topics have required: true and active: true
  const list: AnamnesisTopic[] = topics.map((topic, index) => {
    const isMandatory = isMandatoryTopic(topic.key);
    const defaultMatch = DEFAULT_ANAMNESIS_TOPICS.find(
      (d) => d.key === topic.key,
    );
    return {
      ...topic,
      description: topic.description || defaultMatch?.description,
      required: isMandatory || topic.required,
      active: isMandatory ? true : (topic.active ?? true),
      order: topic.order ?? index,
    };
  });

  // Ensure required topics chief_complaint and conduct exist
  for (const mandatory of DEFAULT_ANAMNESIS_TOPICS.filter((t) => t.required)) {
    if (!list.some((t) => t.key === mandatory.key)) {
      list.push({
        ...mandatory,
        order: list.length,
      });
    }
  }

  return list
    .sort((a, b) => a.order - b.order)
    .map((t, idx) => ({
      ...t,
      order: idx,
    }));
}
