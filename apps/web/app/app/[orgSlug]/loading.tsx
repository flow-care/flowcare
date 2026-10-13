import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <output
      className="w-full px-5 py-8 md:px-8 md:py-10"
      aria-label="Carregando clínica"
    >
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-5 w-72" />
      </div>
    </output>
  );
}
