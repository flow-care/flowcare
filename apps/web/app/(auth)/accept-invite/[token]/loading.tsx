import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function Loading() {
  return (
    <Card aria-busy="true">
      <CardHeader className="text-center pb-2 items-center flex flex-col gap-2">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div className="h-7 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="h-24 w-full animate-pulse rounded-lg bg-muted/50" />
      </CardContent>
      <div className="p-6 pt-2">
        <div className="h-[46px] w-full animate-pulse rounded-lg bg-muted" />
      </div>
      <span className="sr-only">Carregando convite</span>
    </Card>
  );
}
