"use client";

import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RetryButton({ className }: { className?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => window.location.reload()}
      className={className}
    >
      <RotateCcw className="size-4" />
      Tentar novamente
    </Button>
  );
}
