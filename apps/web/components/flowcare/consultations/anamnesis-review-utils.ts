import type { ConsultationProfessional } from "@/server/consultations";

export interface ClinicalTopicConfig {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
  description: string;
}

export const CLINICAL_ANAMNESIS_TOPICS: ClinicalTopicConfig[] = [
  {
    key: "chief_complaint",
    label: "Queixa principal",
    placeholder: "Descreva a queixa principal e o motivo da consulta...",
    required: true,
    description: "Motivo relatado pelo paciente na consulta.",
  },
  {
    key: "hda",
    label: "História da doença atual (HDA)",
    placeholder:
      "Evolução cronológica dos sintomas, início, duração e fatores de piora/melhora...",
    required: true,
    description:
      "Evolução cronológica dos sintomas, início e fatores de piora/melhora.",
  },
  {
    key: "antecedents",
    label: "Antecedentes pessoais e familiares",
    placeholder:
      "Comorbidades prévias, cirurgias, medicações em uso, histórico familiar e alergias...",
    required: false,
    description:
      "Comorbidades, histórico familiar, medicamentos em uso e alergias.",
  },
  {
    key: "physical_exam",
    label: "Exame físico",
    placeholder:
      "Sinais vitais (PA, FC, Temperatura), inspeção e achados do exame clínico...",
    required: false,
    description: "Achados objetivos, sinais vitais e avaliação física.",
  },
  {
    key: "conduct",
    label: "Conduta e hipótese diagnóstica",
    placeholder:
      "Hipóteses diagnósticas (CID-10), exames solicitados, plano terapêutico e orientações...",
    required: true,
    description:
      "Conclusão diagnóstica, prescrições, encaminhamentos e plano terapêutico.",
  },
];

export function validateAnamnesisTopics(topics: Record<string, string>): {
  valid: boolean;
  missingTopics: string[];
} {
  const missing: string[] = [];

  for (const topic of CLINICAL_ANAMNESIS_TOPICS) {
    if (topic.required) {
      const val = topics[topic.key]?.trim();
      if (!val) {
        missing.push(topic.label);
      }
    }
  }

  return {
    valid: missing.length === 0,
    missingTopics: missing,
  };
}

export function resolveTopicInitialValue(
  key: string,
  draftTopics: Record<string, string>,
  chiefComplaint?: string | null,
  clinicalNotes?: string | null,
): string {
  // Check direct key
  if (draftTopics[key] !== undefined && draftTopics[key] !== "") {
    return draftTopics[key];
  }

  // Aliases for standard clinical topics
  switch (key) {
    case "chief_complaint":
      return (
        draftTopics.chiefComplaint ||
        draftTopics.queixa_principal ||
        draftTopics.queixaPrincipal ||
        chiefComplaint ||
        ""
      );
    case "hda":
      return (
        draftTopics.historia_da_doenca_atual ||
        draftTopics.historiaDoencaAtual ||
        draftTopics.hda_content ||
        ""
      );
    case "antecedents":
      return (
        draftTopics.antecedentes ||
        draftTopics.antecedentes_pessoais_e_familiares ||
        draftTopics.antecedentesPessoaisFamiliares ||
        ""
      );
    case "physical_exam":
      return (
        draftTopics.physicalExam ||
        draftTopics.exame_fisico ||
        draftTopics.exameFisico ||
        ""
      );
    case "conduct":
      return (
        draftTopics.conduta ||
        draftTopics.conduta_e_hipotese_diagnostica ||
        draftTopics.condutaHipoteseDiagnostica ||
        draftTopics.clinical_notes ||
        draftTopics.clinicalNotes ||
        clinicalNotes ||
        ""
      );
    default:
      return draftTopics[key] || "";
  }
}

export function formatDoctorVerificationStamp(
  professional?: ConsultationProfessional | null,
  signedBy?: string | null,
): {
  doctorName: string;
  registration: string;
} {
  const doctorName =
    professional?.fullName || signedBy || "Profissional Clínico";
  const registration =
    professional?.registrationNumber ||
    (signedBy?.includes("CRM") ? signedBy : "") ||
    "CRM/SP não informado";

  return {
    doctorName,
    registration,
  };
}

export function extractTopicsFromDraft(
  draft: unknown,
  snapshot?: unknown,
  chiefComplaint?: string | null,
  clinicalNotes?: string | null,
): Record<string, string> {
  const result: Record<string, string> = {};

  const source =
    snapshot && typeof snapshot === "object"
      ? (snapshot as Record<string, unknown>)
      : draft && typeof draft === "object"
        ? (draft as Record<string, unknown>)
        : null;

  if (source) {
    if (source.topics && typeof source.topics === "object") {
      if (Array.isArray(source.topics)) {
        for (const item of source.topics) {
          if (
            item &&
            typeof item.key === "string" &&
            typeof item.value === "string"
          ) {
            result[item.key] = item.value;
          }
        }
      } else {
        for (const [k, v] of Object.entries(source.topics)) {
          if (typeof v === "string") {
            result[k] = v;
          }
        }
      }
    }

    for (const [k, v] of Object.entries(source)) {
      if (k !== "topics" && typeof v === "string") {
        result[k] = v;
      }
    }
  }

  if (
    chiefComplaint &&
    !result.chief_complaint &&
    !result.chiefComplaint &&
    !result.queixa_principal
  ) {
    result.chief_complaint = chiefComplaint;
  }

  if (
    clinicalNotes &&
    !result.conduct &&
    !result.conduta &&
    !result.clinicalNotes &&
    !result.clinical_notes
  ) {
    result.conduct = clinicalNotes;
  }

  return result;
}
