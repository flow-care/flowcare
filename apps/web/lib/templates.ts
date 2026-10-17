import type { TemplateStatus, TemplateType } from "@/server/templates";

export const TEMPLATE_TYPE_LABELS: Record<TemplateType, string> = {
  PRESCRIPTION: "Receita",
  CERTIFICATE: "Atestado",
  REPORT: "Laudo",
  EXAM_REQUEST: "Exame",
};

export const TEMPLATE_STATUS_LABELS: Record<TemplateStatus, string> = {
  ACTIVE: "Ativo",
  ARCHIVED: "Arquivado",
};

export function formatTemplateType(type: string): string {
  const upper = type.toUpperCase();
  if (upper in TEMPLATE_TYPE_LABELS) {
    return TEMPLATE_TYPE_LABELS[upper as TemplateType];
  }
  if (upper === "EXAM") return "Exame";
  if (upper === "CUSTOM" || upper === "LIVRE") return "Livre";
  return type;
}

export function formatTemplateStatus(status: string): string {
  const upper = status.toUpperCase();
  if (upper in TEMPLATE_STATUS_LABELS) {
    return TEMPLATE_STATUS_LABELS[upper as TemplateStatus];
  }
  return status;
}

export function formatTemplateDate(
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
      timeZone: "America/Sao_Paulo",
    }).format(d);
  } catch {
    return "-";
  }
}

export function extractTemplateVariables(text?: string | null): string[] {
  if (!text) return [];
  const regex = /\{{1,2}([a-zA-Z0-9_]+)\}{1,2}/g;
  const matches = new Set<string>();
  let match: RegExpExecArray | null;

  while (true) {
    match = regex.exec(text);
    if (match === null) break;
    const varName = match[1];
    if (varName) {
      matches.add(`{${varName}}`);
    }
  }

  return Array.from(matches);
}

export function matchesTemplateSearch(
  template: { title: string; bodyTemplate?: string },
  query: string,
): boolean {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return true;

  const titleMatch = template.title.toLowerCase().includes(cleanQuery);
  const bodyMatch = template.bodyTemplate
    ? template.bodyTemplate.toLowerCase().includes(cleanQuery)
    : false;

  return titleMatch || bodyMatch;
}

export const TEMPLATE_TYPE_FILTER_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "prescription", label: "Receita" },
  { value: "certificate", label: "Atestado" },
  { value: "report", label: "Laudo" },
  { value: "exam", label: "Exame" },
  { value: "custom", label: "Livre" },
] as const;

export const TEMPLATE_STATUS_FILTER_OPTIONS = [
  { value: "active", label: "Ativos" },
  { value: "archived", label: "Arquivados" },
] as const;
