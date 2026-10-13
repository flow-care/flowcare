import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <output className="w-full space-y-4" aria-label="Carregando clínica">
      <Skeleton className="h-9 w-52" />
      <Skeleton className="h-5 w-72" />
    </output>
  );
}
