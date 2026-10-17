import { Skeleton } from "@/components/ui/skeleton";

export default function AnamnesisSettingsLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 p-6 md:p-8">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Callout Skeleton */}
      <Skeleton className="h-20 w-full rounded-xl" />

      {/* Professional Selector Card Skeleton */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-10 w-full max-w-md rounded-md" />
      </div>

      {/* Topics Header Skeleton */}
      <div className="flex items-center justify-between pt-2">
        <div className="space-y-2">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-44 rounded-md" />
      </div>

      {/* Topic Items Skeletons */}
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: Static placeholder list
            key={i}
            className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-3.5"
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-5 rounded" />
              <Skeleton className="size-7 rounded-md" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="size-8 rounded-md" />
              <Skeleton className="h-5 w-10 rounded-full" />
              <Skeleton className="size-8 rounded-md" />
            </div>
          </div>
        ))}
      </div>

      {/* Save Button Skeleton */}
      <div className="flex justify-end pt-4 border-t border-border">
        <Skeleton className="h-10 w-44 rounded-md" />
      </div>
    </div>
  );
}
