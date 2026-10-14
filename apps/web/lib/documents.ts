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
