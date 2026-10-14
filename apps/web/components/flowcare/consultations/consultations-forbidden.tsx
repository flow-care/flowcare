import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ConsultationsForbidden({ orgSlug }: { orgSlug: string }) {
  return (
    <div className="flex min-h-[420px] w-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldAlert className="size-6 text-muted-foreground" />
      </div>
      <Badge
        variant="outline"
        className="mb-3 text-xs font-semibold text-muted-foreground"
      >
        403 — Acesso Restrito
      </Badge>
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        Acesso restrito à equipe clínica
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Apenas profissionais de saúde autorizados possuem permissão para
        consultar e gerenciar atendimentos clínicos e prontuários.
      </p>
      <Button asChild variant="outline" className="mt-6">
        <Link href={`/app/${encodeURIComponent(orgSlug)}/dashboard`}>
          Voltar ao Dashboard
        </Link>
      </Button>
    </div>
  );
}
