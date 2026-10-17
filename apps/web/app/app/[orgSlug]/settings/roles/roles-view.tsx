"use client";

import { Check, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatMemberCount,
  getMvpRoleCards,
  type OrganizationRolesData,
} from "@/lib/roles";

export interface RolesViewProps {
  orgSlug: string;
  rolesData: OrganizationRolesData;
}

export function RolesView({ rolesData }: RolesViewProps) {
  const roleCards = getMvpRoleCards(rolesData);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Papéis de Acesso
        </h1>
        <p className="text-sm text-muted-foreground">
          Matriz de permissões e perfis de acesso da clínica
        </p>
      </div>

      {/* Callout Notice */}
      <div className="flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-card-foreground">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        <div className="flex-1 space-y-1">
          <h2 className="font-medium text-foreground">
            Papéis fixos de conformidade
          </h2>
          <p className="text-xs/relaxed text-muted-foreground">
            Os papéis de acesso são fixos no MVP conforme diretrizes de
            conformidade. A customização de papéis personalizados estará
            disponível em breve (#325).
          </p>
        </div>
      </div>

      {/* Grid of MVP Roles */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {roleCards.map((roleCard) => (
          <Card
            key={roleCard.role}
            className="flex flex-col border border-border bg-card shadow-2xs"
          >
            <CardHeader className="gap-3 border-b border-border/50 pb-4">
              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant="outline"
                  className={`text-xs font-semibold px-2.5 py-0.5 ${roleCard.badgeClassName}`}
                >
                  {roleCard.badgeLabel}
                </Badge>
                <Badge variant="secondary" className="text-xs font-medium">
                  {formatMemberCount(roleCard.memberCount)}
                </Badge>
              </div>
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight text-foreground">
                  {roleCard.title}
                </CardTitle>
                <CardDescription className="mt-1 text-xs/relaxed text-muted-foreground">
                  {roleCard.productDescription}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex-1 space-y-4 pt-4">
              {roleCard.groupedCapabilities.map((group) => (
                <div key={group.category} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.category}
                  </h3>
                  <ul className="space-y-1.5">
                    {group.items.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2 text-xs text-foreground/90"
                      >
                        <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        <span className="leading-tight">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
