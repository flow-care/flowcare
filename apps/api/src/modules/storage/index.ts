import { Elysia, t } from "elysia";
import type { PrismaClient } from "../../generated/prisma/client";
import { authPlugin } from "../../plugins/auth";
import { organizationAccessPlugin } from "../../plugins/organization-access";
import * as m from "./model";
import { StorageService } from "./service";

export function storageModule(deps: {
  prisma: PrismaClient;
  jwtSecret: string;
  config: {
    endpoint: string | null;
    bucket: string | null;
    region: string;
    accessKeyId: string | null;
    secretAccessKey: string | null;
  };
}) {
  const service = new StorageService({
    prisma: deps.prisma,
    config: deps.config,
  });
  return new Elysia({ name: "storage" })
    .use(authPlugin(deps))
    .use(organizationAccessPlugin(deps))
    .group("/organizations/:orgSlug/storage", (group) =>
      group
        .post(
          "/upload-url",
          ({ organizationAccess, body }) =>
            service.createUpload(organizationAccess.organizationId, body),
          {
            params: t.Object({ orgSlug: t.String() }),
            body: m.uploadBody,
            organizationAccess: "patients:attachments:write",
            response: { 200: m.storageResponse },
          },
        )
        .post(
          "/:objectId/download-url",
          ({ organizationAccess, params }) =>
            service.createDownload(
              organizationAccess.organizationId,
              params.objectId,
            ),
          {
            params: t.Object({ orgSlug: t.String(), objectId: t.String() }),
            organizationAccess: "patients:attachments:read",
            response: { 200: m.downloadResponse },
          },
        ),
    );
}
