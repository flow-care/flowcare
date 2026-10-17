import { Skeleton } from "@/components/ui/skeleton";

export default function UsageSettingsLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header Skeleton */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-10 w-44 rounded-md" />
      </div>

      {/* KPI Summary Cards Skeleton */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {["kpi-1", "kpi-2", "kpi-3"].map((id) => (
          <div
            key={id}
            className="flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-2xs"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="size-8 rounded-lg" />
            </div>
            <div className="mt-3 space-y-1.5">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-3.5 w-48" />
            </div>
          </div>
        ))}
      </div>

      {/* Explanatory Notice Skeleton */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
        <div className="flex items-start gap-3">
          <Skeleton className="size-5 shrink-0 rounded-full" />
          <Skeleton className="h-4 w-full max-w-2xl" />
        </div>
      </div>

      {/* Breakdown Table Skeleton */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-2xs">
        <div className="mb-4 flex flex-col gap-1">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
          {["row-1", "row-2", "row-3"].map((rowId) => (
            <div
              key={rowId}
              className="flex items-center justify-between py-3 border-b border-border/50 last:border-0"
            >
              <div className="space-y-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-2 w-28 rounded-full" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
