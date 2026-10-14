import type { OrganizationSummary } from "@/server/organizations";

type Role = OrganizationSummary["role"];

export const appSections = [
  {
    segment: "dashboard",
    label: "Dashboard",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL", "PROFESSIONAL", "RECEPTIONIST"],
  },
  {
    segment: "appointments",
    label: "Agenda",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL", "PROFESSIONAL", "RECEPTIONIST"],
  },
  {
    segment: "patients",
    label: "Pacientes",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL", "PROFESSIONAL", "RECEPTIONIST"],
  },
  {
    segment: "consultations",
    label: "Consultas",
    roles: ["ADMIN_PROFESSIONAL", "PROFESSIONAL"],
  },
  {
    segment: "documents",
    label: "Documentos",
    roles: ["ADMIN_PROFESSIONAL", "PROFESSIONAL"],
  },
  {
    segment: "templates",
    label: "Modelos",
    roles: ["ADMIN_PROFESSIONAL", "PROFESSIONAL"],
  },
  {
    segment: "whatsapp",
    label: "WhatsApp",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL", "RECEPTIONIST"],
  },
  {
    segment: "settings",
    label: "Configurações",
    roles: ["ADMIN", "ADMIN_PROFESSIONAL"],
  },
] as const satisfies ReadonlyArray<{
  segment: string;
  label: string;
  roles: readonly Role[];
}>;

export type AppSection = (typeof appSections)[number]["segment"];

export const settingsSections = [
  { segment: "clinic", label: "Clínica" },
  { segment: "hours", label: "Horários" },
  { segment: "team", label: "Equipe" },
  { segment: "roles", label: "Papéis" },
  { segment: "usage", label: "Consumo" },
  { segment: "audit", label: "Auditoria" },
] as const;

export type SettingsSection = (typeof settingsSections)[number]["segment"];

export function canOpenSection(role: Role, segment: string): boolean {
  const section = appSections.find((item) => item.segment === segment);
  return Boolean(section?.roles.some((allowed) => allowed === role));
}

export function isClinicalRole(role?: Role | string | null): boolean {
  return role === "ADMIN_PROFESSIONAL" || role === "PROFESSIONAL";
}
