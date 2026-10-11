"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { chooseOrganization } from "@/app/select-organization/actions";
import type { OrganizationSummary } from "@/server/organizations";

export function OrganizationSelector({
  organizations,
}: {
  organizations: OrganizationSummary[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-8 space-y-3">
      {organizations.map((organization) => (
        <button
          key={organization.id}
          type="button"
          disabled={pending}
          className="block w-full cursor-pointer rounded-lg bg-card px-5 py-4 text-left font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() =>
            startTransition(async () => {
              try {
                const selected = await chooseOrganization(organization.slug);
                if (!selected) {
                  toast.error("Não foi possível selecionar a clínica.");
                  return;
                }
                router.replace(
                  `/app/${encodeURIComponent(organization.slug)}/dashboard`,
                );
              } catch {
                toast.error("Não foi possível selecionar a clínica.");
              }
            })
          }
        >
          {organization.name}
        </button>
      ))}
    </div>
  );
}
