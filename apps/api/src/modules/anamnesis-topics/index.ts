import { Elysia } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import * as m from "./model";
import { AnamnesisTopicsService } from "./service";

export function anamnesisTopicsModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
}) {
  const service = new AnamnesisTopicsService(deps.prisma);
  return new Elysia({ name: "anamnesis-topics" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
    .get(
      "/organizations/:orgSlug/professionals/:professionalId/anamnesis-topics",
      ({ auth, organizationAccess, params }) =>
        service.get(
          organizationAccess.organizationId,
          auth.userId,
          params.professionalId,
          organizationAccess.role,
        ),
      {
        params: m.params,
        organizationAccess: "organizations:read",
        response: { 200: m.topicsResponse },
      },
    )
    .put(
      "/organizations/:orgSlug/professionals/:professionalId/anamnesis-topics",
      ({ auth, organizationAccess, params, body }) =>
        service.put(
          organizationAccess.organizationId,
          auth.userId,
          params.professionalId,
          organizationAccess.role,
          body,
        ),
      {
        params: m.params,
        body: m.putTopicsBody,
        organizationAccess: "organizations:read",
        response: { 200: m.topicsResponse },
      },
    );
}
