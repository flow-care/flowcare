import { Skeleton } from "@/components/ui/skeleton";

export default function ConsultationDetailLoading() {
  return (
    <output
      className="flex flex-col gap-6 p-6"
      aria-label="Carregando detalhes do atendimento"
    >
      {/* Top back button skeleton */}
      <div>
        <Skeleton className="mb-4 h-4 w-40" />

        {/* Header skeleton */}
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <Skeleton className="size-11 shrink-0 rounded-xl" />
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-7 w-56" />
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
      </div>

      {/* Tabs list skeleton */}
      <Skeleton className="h-10 w-72 rounded-lg" />

      {/* Overview 3 Skeleton Cards */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Card 1 */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
          <div className="space-y-2 pb-4">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-52" />
          </div>
          <div className="space-y-4 pt-2">
            <div>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-4 w-full" />
              <Skeleton className="mt-1 h-4 w-4/5" />
            </div>
            <div className="border-t border-border/60 pt-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-2 h-4 w-36" />
            </div>
            <div className="border-t border-border/60 pt-3">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-2 h-4 w-48" />
              <Skeleton className="mt-1 h-3 w-32" />
            </div>
          </div>
        </div>

        {/* Card 2 */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
          <div className="space-y-2 pb-4">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="space-y-4 pt-2">
            <div>
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-2 h-4 w-40" />
            </div>
            <div className="border-t border-border/60 pt-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="mt-2 h-4 w-32" />
            </div>
            <div className="border-t border-border/60 pt-3">
              <Skeleton className="h-3 w-20" />
              <div className="mt-2 flex gap-1.5">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>
            <div className="border-t border-border/60 pt-3">
              <Skeleton className="h-3 w-24" />
              <div className="mt-2 flex gap-1.5">
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
            </div>
          </div>
        </div>

        {/* Card 3 */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-xs">
          <div className="space-y-2 pb-4">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="space-y-4 pt-2">
            <div className="flex gap-2">
              <Skeleton className="h-6 w-24 rounded-full" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <div className="border-t border-border/60 pt-3 space-y-3">
              <div className="flex justify-between">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-4 w-32" />
              </div>
              <div className="flex justify-between">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </output>
  );
}
