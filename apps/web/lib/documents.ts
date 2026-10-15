import type { DocumentStatus, DocumentType } from "@/server/documents";

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  PRESCRIPTION: "Receita",
  CERTIFICATE: "Atestado",
  REPORT: "Laudo",
  EXAM_REQUEST: "Solicitação de exames",
};

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  DRAFT: "Rascunho",
  ISSUED: "Emitido",
  VOIDED: "Anulado",
};

export function formatDocumentType(type: string): string {
  if (type in DOCUMENT_TYPE_LABELS) {
    return DOCUMENT_TYPE_LABELS[type as DocumentType];
  }
  return type;
}

export function formatDocumentStatus(status: string): string {
  if (status in DOCUMENT_STATUS_LABELS) {
    return DOCUMENT_STATUS_LABELS[status as DocumentStatus];
  }
  return status;
}

export function formatDocumentDate(
  dateString: string | null | undefined,
): string {
  if (!dateString) return "-";
  try {
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return "-";
    return new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    }).format(d);
  } catch {
    return "-";
  }
}

export const VALID_DOCUMENT_CREATION_TYPES = [
  "prescription",
  "report",
  "certificate",
  "exam",
  "custom",
] as const;

export type DocumentCreationType =
  (typeof VALID_DOCUMENT_CREATION_TYPES)[number];

export interface DocumentCreationTypeConfig {
  key: DocumentCreationType;
  label: string;
  badgeLabel: string;
  shortDescription: string;
  defaultTitle: string;
  backendType: DocumentType;
}

export const DOCUMENT_CREATION_TYPE_CONFIGS: Record<
  DocumentCreationType,
  DocumentCreationTypeConfig
> = {
  prescription: {
    key: "prescription",
    label: "Receita simples",
    badgeLabel: "Receita",
    shortDescription:
      "Prescrição de medicamentos, dosagens, horários e orientações farmacológicas.",
    defaultTitle: "Receita Médica",
    backendType: "PRESCRIPTION",
  },
  report: {
    key: "report",
    label: "Laudo",
    badgeLabel: "Laudo",
    shortDescription:
      "Parecer técnico, evolução detalhada do paciente ou relatório descritivo.",
    defaultTitle: "Laudo Médico",
    backendType: "REPORT",
  },
  certificate: {
    key: "certificate",
    label: "Atestado",
    badgeLabel: "Atestado",
    shortDescription:
      "Atestado médico de afastamento, comparecimento, acompanhamento ou aptidão.",
    defaultTitle: "Atestado Médico",
    backendType: "CERTIFICATE",
  },
  exam: {
    key: "exam",
    label: "Pedido de exame",
    badgeLabel: "Solicitação de exames",
    shortDescription:
      "Solicitação de exames laboratoriais, de imagem ou procedimentos diagnósticos.",
    defaultTitle: "Solicitação de Exames",
    backendType: "EXAM_REQUEST",
  },
  custom: {
    key: "custom",
    label: "Personalizado",
    badgeLabel: "Personalizado",
    shortDescription:
      "Documento clínico avulso com formato livre para orientações e declarações diversas.",
    defaultTitle: "Documento Clínico",
    backendType: "REPORT",
  },
};

export function isValidDocumentCreationType(
  type: string | null | undefined,
): type is DocumentCreationType {
  if (!type) return false;
  return VALID_DOCUMENT_CREATION_TYPES.includes(
    type.toLowerCase() as DocumentCreationType,
  );
}

export function resolveTemplateVariables(
  content: string,
  variables: {
    paciente_nome?: string;
    data?: string;
    medico_nome?: string;
  },
): string {
  let result = content;

  if (variables.paciente_nome !== undefined) {
    result = result
      .replaceAll("{{paciente_nome}}", variables.paciente_nome)
      .replaceAll("{{paciente}}", variables.paciente_nome)
      .replaceAll("{paciente_nome}", variables.paciente_nome)
      .replaceAll("{paciente}", variables.paciente_nome);
  }

  if (variables.data !== undefined) {
    result = result
      .replaceAll("{{data_atual}}", variables.data)
      .replaceAll("{{data}}", variables.data)
      .replaceAll("{data_atual}", variables.data)
      .replaceAll("{data}", variables.data);
  }

  if (variables.medico_nome !== undefined) {
    result = result
      .replaceAll("{{medico_nome}}", variables.medico_nome)
      .replaceAll("{{medico}}", variables.medico_nome)
      .replaceAll("{medico_nome}", variables.medico_nome)
      .replaceAll("{medico}", variables.medico_nome);
  }

  return result;
}

export function isDocumentFormDirty(form: {
  patientId?: string | null;
  title: string;
  defaultTitle?: string;
  content: string;
  notes?: string;
}): boolean {
  if (form.patientId) return true;
  if (form.content.trim().length > 0) return true;
  if (form.notes && form.notes.trim().length > 0) return true;
  if (form.defaultTitle !== undefined) {
    return (
      form.title.trim().length > 0 &&
      form.title.trim() !== form.defaultTitle.trim()
    );
  }
  return form.title.trim().length > 0;
}
