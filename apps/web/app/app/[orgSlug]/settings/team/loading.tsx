import { Skeleton } from "@/components/ui/skeleton";

export default function TeamSettingsLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>

      <div className="flex items-center gap-2 border-b border-border pb-2">
        <Skeleton className="h-9 w-36 rounded-md" />
        <Skeleton className="h-9 w-40 rounded-md" />
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
        <div className="space-y-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-12" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
            <div key={i} className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="size-8 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
