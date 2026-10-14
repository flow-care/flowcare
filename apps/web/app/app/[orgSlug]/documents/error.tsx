"use client";

import { useEffect } from "react";
import { DocumentsErrorView } from "@/components/flowcare/documents/documents-error";

export default function DocumentsErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return <DocumentsErrorView onRetry={reset} />;
}
