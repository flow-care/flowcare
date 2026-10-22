import { Skeleton } from "@/components/ui/skeleton";
import { WhatsAppSectionSkeleton } from "./whatsapp-states";

export default function WhatsAppLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Skeleton className="h-9 w-80 max-w-full" />
      <WhatsAppSectionSkeleton />
    </div>
  );
}
