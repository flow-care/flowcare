"use client";

import { MonitorSmartphone, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

const themes = [
  { value: "system", label: "Sistema", Icon: MonitorSmartphone },
  { value: "light", label: "Claro", Icon: Sun },
  { value: "dark", label: "Escuro", Icon: Moon },
] as const;

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const selectedIndex = Math.max(
    0,
    themes.findIndex((option) => option.value === theme),
  );

  return (
    <div className="relative grid h-8 w-[92px] grid-cols-3 items-center rounded-full border border-border">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-0.5 size-7 rounded-full border border-border bg-muted transition-transform duration-300 dark:bg-background"
        style={{ transform: `translateX(${selectedIndex * 100}%)` }}
      />
      {themes.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={`Tema: ${label}`}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className="relative flex h-full items-center justify-center text-muted-foreground hover:text-foreground aria-pressed:text-foreground"
        >
          <Icon size={16} strokeWidth={1.8} />
        </button>
      ))}
    </div>
  );
}
