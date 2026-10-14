import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function DocumentsLoading() {
  return (
    <output
      className="block w-full space-y-6"
      aria-label="Carregando documentos clínicos"
    >
      {/* Header skeleton */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>

      {/* Filters skeleton */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <Skeleton className="h-[47px] w-full rounded-lg md:w-56" />
        <Skeleton className="h-[47px] w-full rounded-lg md:w-52" />
        <Skeleton className="h-[47px] flex-1 rounded-lg" />
      </div>

      {/* Table skeleton */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[170px]">
                <Skeleton className="h-4 w-16" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-4 w-24" />
              </TableHead>
              <TableHead>
                <Skeleton className="h-4 w-28" />
              </TableHead>
              <TableHead className="w-[190px]">
                <Skeleton className="h-4 w-36" />
              </TableHead>
              <TableHead className="w-[130px] text-right">
                <Skeleton className="ml-auto h-4 w-20" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Static placeholder skeletons
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-5 w-24 rounded-full" />
                </TableCell>
                <TableCell>
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell>
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <Skeleton className="ml-auto h-5 w-20 rounded-full" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Footer skeleton */}
      <div className="flex flex-col items-center justify-between gap-4 py-2 sm:flex-row">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-9 w-48 rounded-lg" />
      </div>
    </output>
  );
}
