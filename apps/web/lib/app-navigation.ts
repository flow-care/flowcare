import type { OrganizationSummary } from "@/server/organizations";

type Role = OrganizationSummary["role"];

/**
 * Cada seção exige uma permissão. Os `roles` abaixo são apenas o fallback para
 * quando a lista de permissões não está disponível (payload antigo).
 */
export const appSections = [
  {
    segment: "dashboard",
    permission: "dashboard:read",
    label: "Dashboard",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL", "PROFESSIONAL", "RECEPTIONIST"],
  },
  {
    segment: "appointments",
    permission: "appointments:read",
    label: "Agenda",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL", "PROFESSIONAL", "RECEPTIONIST"],
  },
  {
    segment: "patients",
    permission: "patients:read",
    label: "Pacientes",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL", "PROFESSIONAL", "RECEPTIONIST"],
  },
  {
    segment: "consultations",
    permission: "consultations:read",
    label: "Consultas",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL", "PROFESSIONAL"],
  },
  {
    segment: "documents",
    permission: "documents:read",
    label: "Documentos",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL", "PROFESSIONAL"],
  },
  {
    segment: "templates",
    permission: "templates:read",
    label: "Modelos",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL", "PROFESSIONAL"],
  },
  {
    segment: "whatsapp",
    permission: "communications:read",
    label: "WhatsApp",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL", "RECEPTIONIST"],
  },
  {
    segment: "settings",
    permission: "settings:read",
    label: "Configurações",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL"],
  },
] as const satisfies ReadonlyArray<{
  segment: string;
  label: string;
  permission: string;
  roles: readonly Role[];
}>;

export type AppSection = (typeof appSections)[number]["segment"];

export const settingsSections = [
  { segment: "organization", label: "Clínica" },
  { segment: "hours", label: "Horários" },
  { segment: "team", label: "Equipe" },
  { segment: "anamnesis", label: "Anamnese" },
  { segment: "usage", label: "Consumo" },
  { segment: "audit", label: "Auditoria" },
] as const;

export type SettingsSection = (typeof settingsSections)[number]["segment"];

export function canOpenSection(
  role: Role,
  segment: string,
  permissions?: readonly string[] | null,
): boolean {
  const section = appSections.find((item) => item.segment === segment);
  if (!section) return false;
  // Permissões são a fonte de verdade; o papel é só o fallback.
  if (permissions && permissions.length > 0) {
    return permissions.includes(section.permission);
  }
  return section.roles.some((allowed) => allowed === role);
}

/** Quem pode abrir prontuário/documentos: tem a permissão clínica de leitura. */
export function hasClinicalAccess(
  role?: Role | string | null,
  permissions?: readonly string[] | null,
): boolean {
  if (permissions && permissions.length > 0) {
    return permissions.includes("consultations:read");
  }
  return (
    role === "ADMIN" || role === "ADMIN_PROFESSIONAL" || role === "PROFESSIONAL"
  );
}

export function isClinicalRole(role?: Role | string | null): boolean {
  return hasClinicalAccess(role);
}
