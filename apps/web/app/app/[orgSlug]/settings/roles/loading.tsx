import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function RolesSettingsLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header Skeleton */}
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      {/* Notice Skeleton */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-2xs">
        <div className="flex items-start gap-3">
          <Skeleton className="size-5 shrink-0 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-3.5 w-full max-w-xl" />
          </div>
        </div>
      </div>

      {/* Cards Grid Skeleton */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
          <Card key={i} className="border border-border shadow-2xs">
            <CardHeader className="gap-3 pb-3">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-32 rounded-full" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <Skeleton className="h-6 w-44" />
              <div className="space-y-1">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              <div className="space-y-2">
                <Skeleton className="h-3 w-28" />
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-3.5 rounded-full" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-3.5 rounded-full" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-3.5 rounded-full" />
                    <Skeleton className="h-3 w-52" />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-32" />
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-3.5 rounded-full" />
                    <Skeleton className="h-3 w-44" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-3.5 rounded-full" />
                    <Skeleton className="h-3 w-50" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
