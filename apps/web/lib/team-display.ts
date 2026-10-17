export function formatTeamDate(isoString?: string | null): string {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return isoString;
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${day}/${month}/${year} às ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
}

export function getRoleBadgeConfig(role: string): {
  label: string;
  className: string;
} {
  switch (role) {
    case "ADMIN":
      return {
        label: "Administrador",
        className:
          "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800",
      };
    case "ADMIN_PROFESSIONAL":
      return {
        label: "Administrador e Clínico",
        className:
          "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
      };
    case "PROFESSIONAL":
      return {
        label: "Profissional Clínico",
        className:
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
      };
    case "RECEPTIONIST":
      return {
        label: "Recepção",
        className:
          "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
      };
    default:
      return {
        label: role,
        className: "bg-muted text-muted-foreground border-border",
      };
  }
}
