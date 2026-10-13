"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 shrink-0 text-white" />,
        info: <InfoIcon className="size-4 shrink-0 text-white" />,
        warning: <TriangleAlertIcon className="size-4 shrink-0 text-white" />,
        error: <OctagonXIcon className="size-4 shrink-0 text-white" />,
        loading: (
          <Loader2Icon className="size-4 shrink-0 animate-spin text-white" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "transparent",
          "--border-radius": "var(--radius)",
          "--error-bg": "#dc2626",
          "--error-text": "#ffffff",
          "--error-border": "transparent",
          "--success-bg": "#16a34a",
          "--success-text": "#ffffff",
          "--success-border": "transparent",
          "--info-bg": "#2563eb",
          "--info-text": "#ffffff",
          "--info-border": "transparent",
          "--warning-bg": "#d97706",
          "--warning-text": "#ffffff",
          "--warning-border": "transparent",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !border-0 !border-transparent ",
          error:
            "!border-0 !border-transparent !bg-red-600 dark:!bg-red-600 !text-white [&_[data-title]]:!text-white [&_[data-description]]:!text-white/80 [&_[data-icon]]:!text-white",
          success:
            "!border-0 !border-transparent !bg-emerald-600 dark:!bg-emerald-600 !text-white [&_[data-title]]:!text-white [&_[data-description]]:!text-white/80 [&_[data-icon]]:!text-white",
          info: "!border-0 !border-transparent !bg-blue-600 dark:!bg-blue-600 !text-white [&_[data-title]]:!text-white [&_[data-description]]:!text-white/80 [&_[data-icon]]:!text-white",
          warning:
            "!border-0 !border-transparent !bg-amber-600 dark:!bg-amber-600 !text-white [&_[data-title]]:!text-white [&_[data-description]]:!text-white/80 [&_[data-icon]]:!text-white",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
