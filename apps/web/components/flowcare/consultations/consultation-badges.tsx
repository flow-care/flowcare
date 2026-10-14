import { Badge } from "@/components/ui/badge";
import type {
  AnamnesisStatus,
  ConsultationStatus,
} from "@/server/consultations";

export function ConsultationStatusBadge({
  status,
}: {
  status: ConsultationStatus;
}) {
  switch (status) {
    case "SCHEDULED":
      return (
        <Badge
          variant="outline"
          className="border-border bg-muted/40 text-muted-foreground"
        >
          Agendada
        </Badge>
      );
    case "IN_PROGRESS":
      return (
        <Badge className="border-primary/20 bg-primary/10 text-primary hover:bg-primary/15">
          Em andamento
        </Badge>
      );
    case "COMPLETED":
      return (
        <Badge
          variant="secondary"
          className="border border-border bg-secondary text-secondary-foreground"
        >
          Concluída
        </Badge>
      );
    case "CANCELLED":
      return <Badge variant="destructive">Cancelada</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function AnamnesisStatusBadge({ status }: { status: AnamnesisStatus }) {
  switch (status) {
    case "PENDING":
      return (
        <Badge
          variant="outline"
          className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        >
          Pendente
        </Badge>
      );
    case "DRAFT":
      return (
        <Badge
          variant="outline"
          className="border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300"
        >
          Rascunho
        </Badge>
      );
    case "APPROVED":
      return (
        <Badge
          variant="outline"
          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        >
          Aprovada
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
