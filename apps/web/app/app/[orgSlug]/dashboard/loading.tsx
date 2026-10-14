import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <output
      className="flex flex-1 flex-col space-y-6"
      aria-label="Carregando painel"
    >
      <div className="space-y-1">
        <Skeleton className="h-9 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>

      <Skeleton className="h-9 w-60 rounded-lg" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3 rounded-xl border border-border bg-card p-6">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-36" />
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-card p-6">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-card p-6">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-card p-6">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-28" />
        </div>
      </div>

      <div className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2 rounded-xl border border-border bg-card p-6">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
          </div>
          <div className="space-y-2 rounded-xl border border-border bg-card p-6">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
          </div>
          <div className="space-y-2 rounded-xl border border-border bg-card p-6">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
          </div>
        </div>
      </div>
    </output>
  );
}
