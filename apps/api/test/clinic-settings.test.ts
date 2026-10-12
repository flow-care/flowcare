import { describe, expect, mock, test } from "bun:test";
import { createApp } from "../src/app";
import type { Env } from "../src/config/env";
import type {
  MembershipRole,
  MembershipStatus,
  PrismaClient,
} from "../src/generated/prisma/client";
import type {
  ClinicLogoUrlResponse,
  ClinicSettingsResponse,
} from "../src/modules/organizations/model";
import { PROFILE_PHOTO_MAX_BYTES } from "../src/services/profile-photo-store";
import { signSessionToken } from "../src/services/session-token";

const env: Env = {
  port: 0,
  nodeEnv: "test",
  version: "test",
  jwtSecret: "clinic-settings-test-secret",
  databaseUrl: "postgresql://unused",
  corsOrigin: "http://localhost:3000",
  trustProxy: false,
  wahaBaseUrl: "http://127.0.0.1:1",
  wahaApiKey: null,
  webAppUrl: "http://localhost:3000",
  sesRegion: null,
  mailProvider: "disabled",
  mailFrom: null,
};

const VALID_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1,
]);

const VALID_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff,
  0xd9,
]);

const VALID_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x14, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56,
  0x50, 0x38, 0x20, 0x08, 0x00, 0x00, 0x00, 0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a,
  0x01, 0x00, 0x01, 0x00,
]);

interface OrgRecord {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  legalName: string | null;
  taxId: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  postalCode: string | null;
  state: string | null;
  city: string | null;
  district: string | null;
  street: string | null;
  streetNumber: string | null;
  addressComplement: string | null;
  logoObjectKey: string | null;
  logoContentType: string | null;
  logoSizeBytes: number | null;
  logoUpdatedAt: Date | null;
  detailsVersion: number;
  detailsCompletedAt: Date | null;
}

interface MembershipRecord {
  id: string;
  userId: string;
  organizationId: string;
  role: MembershipRole;
  status: MembershipStatus;
}

interface AuditRecord {
  organizationId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
}

function setup(options?: { storageAvailable?: boolean }) {
  const organizations = new Map<string, OrgRecord>([
    [
      "org-a",
      {
        id: "org-a",
        name: "Clínica Vida",
        slug: "clinica-vida",
        ownerId: "user-admin",
        legalName: "Clínica Vida Ltda",
        taxId: "11222333000181",
        contactEmail: "contato@vida.com.br",
        contactPhone: "85999990000",
        postalCode: "60000000",
        state: "CE",
        city: "Fortaleza",
        district: "Aldeota",
        street: "Av. Santos Dumont",
        streetNumber: "1000",
        addressComplement: "Sala 10",
        logoObjectKey: null,
        logoContentType: null,
        logoSizeBytes: null,
        logoUpdatedAt: null,
        detailsVersion: 2,
        detailsCompletedAt: new Date("2026-10-01T12:00:00.000Z"),
      },
    ],
    [
      "org-b",
      {
        id: "org-b",
        name: "Clínica Sul",
        slug: "clinica-sul",
        ownerId: "user-other-admin",
        legalName: "Clínica Sul S/A",
        taxId: null,
        contactEmail: "contato@sul.com.br",
        contactPhone: "11988887777",
        postalCode: "01310100",
        state: "SP",
        city: "São Paulo",
        district: "Bela Vista",
        street: "Av. Paulista",
        streetNumber: "500",
        addressComplement: null,
        logoObjectKey: "organizations/org-b/logo/existing-b",
        logoContentType: "image/png",
        logoSizeBytes: 120,
        logoUpdatedAt: new Date("2026-10-02T10:00:00.000Z"),
        detailsVersion: 0,
        detailsCompletedAt: null,
      },
    ],
  ]);

  const memberships: MembershipRecord[] = [
    {
      id: "mem-admin",
      userId: "user-admin",
      organizationId: "org-a",
      role: "ADMIN",
      status: "ACTIVE",
    },
    {
      id: "mem-admin-prof",
      userId: "user-admin-prof",
      organizationId: "org-a",
      role: "ADMIN_PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-prof",
      userId: "user-prof",
      organizationId: "org-a",
      role: "PROFESSIONAL",
      status: "ACTIVE",
    },
    {
      id: "mem-recep",
      userId: "user-recep",
      organizationId: "org-a",
      role: "RECEPTIONIST",
      status: "ACTIVE",
    },
    {
      id: "mem-suspended",
      userId: "user-suspended",
      organizationId: "org-a",
      role: "ADMIN",
      status: "SUSPENDED",
    },
    {
      id: "mem-other-admin",
      userId: "user-other-admin",
      organizationId: "org-b",
      role: "ADMIN",
      status: "ACTIVE",
    },
  ];

  const auditLogs: AuditRecord[] = [];
  const put = mock(
    async (_key: string, _body: Uint8Array, _type: string) => {},
  );
  const del = mock(async (_key: string) => {});
  const downloadUrl = mock(
    async (key: string) => `https://private-storage.example/${key}?sig=1`,
  );

  const findMembership = (where: Record<string, any>) => {
    return (
      memberships.find((m) => {
        if (where.userId && m.userId !== where.userId) return false;
        if (where.organizationId && m.organizationId !== where.organizationId)
          return false;
        if (typeof where.status === "string" && m.status !== where.status)
          return false;
        if (where.role?.in && !where.role.in.includes(m.role)) return false;
        const org = organizations.get(m.organizationId);
        if (!org) return false;
        if (where.organization?.slug && org.slug !== where.organization.slug)
          return false;
        return true;
      }) ?? null
    );
  };

  const prisma = {
    session: {
      findFirst: async () => ({ id: "session-1", lastActiveAt: new Date() }),
    },
    membership: {
      findFirst: async ({ where }: { where: Record<string, any> }) => {
        const found = findMembership(where);
        if (!found) return null;
        const org = organizations.get(found.organizationId)!;
        return {
          ...found,
          organization: { ...org },
        };
      },
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      return fn({
        membership: {
          findFirst: async ({ where }: { where: Record<string, any> }) =>
            findMembership(where),
        },
        organization: {
          updateMany: async ({
            where,
            data,
          }: {
            where: { id: string; detailsVersion?: number };
            data: Record<string, any>;
          }) => {
            const org = organizations.get(where.id);
            if (!org) return { count: 0 };
            if (
              where.detailsVersion !== undefined &&
              org.detailsVersion !== where.detailsVersion
            ) {
              return { count: 0 };
            }
            for (const [key, value] of Object.entries(data)) {
              if (key === "detailsVersion") continue;
              (org as Record<string, any>)[key] = value;
            }
            if (data.detailsVersion?.increment) {
              org.detailsVersion += data.detailsVersion.increment;
            }
            return { count: 1 };
          },
        },
        auditLog: {
          create: async ({ data }: { data: AuditRecord }) => {
            auditLogs.push(data);
            return { id: `audit-${auditLogs.length}`, ...data };
          },
        },
      });
    },
  } as unknown as PrismaClient;

  const app = createApp(env, {
    prisma,
    mailer: { send: async () => {} },
    profilePhotoStore:
      options?.storageAvailable === false
        ? null
        : {
            put,
            downloadUrl,
            delete: del,
          },
  });

  const tokenFor = (userId: string) =>
    signSessionToken({ sid: "session-1", sub: userId }, env.jwtSecret, 3600);

  const request = (
    path: string,
    init: RequestInit & { userId?: string | null } = {},
  ) => {
    const { userId = "user-admin", headers, ...rest } = init;
    const mergedHeaders = new Headers(headers);
    if (userId) {
      mergedHeaders.set("authorization", `Bearer ${tokenFor(userId)}`);
    }
    return app.handle(
      new Request(`http://localhost/api${path}`, {
        ...rest,
        headers: mergedHeaders,
      }),
    );
  };

  return {
    request,
    organizations,
    memberships,
    auditLogs,
    put,
    del,
    downloadUrl,
  };
}

describe("#303 institutional clinic settings and logo", () => {
  test("reads and updates institutional data and address for the active clinic with audit trail", async () => {
    const { request, organizations, auditLogs } = setup();

    const getRes = await request("/organizations/clinica-vida/settings");
    expect(getRes.status).toBe(200);
    const initial = (await getRes.json()) as ClinicSettingsResponse;
    expect(initial).toEqual({
      id: "org-a",
      name: "Clínica Vida",
      slug: "clinica-vida",
      version: 2,
      completed: true,
      legalName: "Clínica Vida Ltda",
      taxId: "11222333000181",
      contactEmail: "contato@vida.com.br",
      contactPhone: "85999990000",
      postalCode: "60000000",
      state: "CE",
      city: "Fortaleza",
      district: "Aldeota",
      street: "Av. Santos Dumont",
      streetNumber: "1000",
      addressComplement: "Sala 10",
      logo: null,
    });

    const patchRes = await request("/organizations/clinica-vida/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 2,
        name: "  Clínica Vida & Saúde  ",
        contactEmail: "ATENDIMENTO@VIDA.COM.BR",
        contactPhone: "(85) 98888-1111",
        postalCode: "60115-000",
        state: "ce",
        streetNumber: " 2000 ",
        addressComplement: "   ",
      }),
    });
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as ClinicSettingsResponse;
    expect(updated).toMatchObject({
      id: "org-a",
      name: "Clínica Vida & Saúde",
      slug: "clinica-vida",
      version: 3,
      contactEmail: "atendimento@vida.com.br",
      contactPhone: "85988881111",
      postalCode: "60115000",
      state: "CE",
      streetNumber: "2000",
      addressComplement: "",
    });

    expect(organizations.get("org-b")?.name).toBe("Clínica Sul");
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toEqual({
      organizationId: "org-a",
      actorUserId: "user-admin",
      action: "ORGANIZATION_SETTINGS_UPDATED",
      targetType: "ORGANIZATION",
      targetId: "org-a",
      metadata: {
        changedFields: [
          "name",
          "contactEmail",
          "contactPhone",
          "postalCode",
          "state",
          "streetNumber",
          "addressComplement",
        ],
        version: 3,
      },
    });

    const putRes = await request("/organizations/clinica-vida/settings", {
      userId: "user-admin-prof",
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 3,
        name: "Clínica Vida Integral",
        legalName: "Clínica Vida Integral Ltda",
        taxId: "11.222.333/0001-81",
        contactEmail: "diretoria@vida.com.br",
        contactPhone: "(85) 3222-3333",
        postalCode: "60000-000",
        state: "CE",
        city: "Fortaleza",
        district: "Meireles",
        street: "Rua Silva Jatahy",
        streetNumber: "400",
        addressComplement: "Andar 3",
      }),
    });
    expect(putRes.status).toBe(200);
    const afterPut = (await putRes.json()) as ClinicSettingsResponse;
    expect(afterPut.version).toBe(4);
    expect(afterPut.name).toBe("Clínica Vida Integral");
    expect(afterPut.district).toBe("Meireles");
    expect(auditLogs).toHaveLength(2);
    expect(auditLogs[1]?.actorUserId).toBe("user-admin-prof");
  });

  test("rejects concurrent updates with 409 VERSION_CONFLICT and records no audit log", async () => {
    const { request, auditLogs, organizations } = setup();

    const conflictRes = await request("/organizations/clinica-vida/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        name: "Edição Concorrente Desatualizada",
      }),
    });
    expect(conflictRes.status).toBe(409);
    expect(await conflictRes.json()).toEqual({
      error: {
        code: "VERSION_CONFLICT",
        message: "A clínica foi alterada em outra sessão. Recarregue os dados.",
      },
    });
    expect(organizations.get("org-a")?.name).toBe("Clínica Vida");
    expect(auditLogs).toHaveLength(0);
  });

  test("validates fields declaratively and rejects immutable or empty payloads before database write", async () => {
    const { request, auditLogs } = setup();

    const fieldCases: Array<{
      payload: Record<string, unknown>;
      field: string;
    }> = [
      { payload: { version: 2, name: " a " }, field: "name" },
      { payload: { version: 2, legalName: "   " }, field: "legalName" },
      {
        payload: { version: 2, taxId: "11.111.111/1111-11" },
        field: "taxId",
      },
      {
        payload: { version: 2, contactEmail: "email-invalido" },
        field: "contactEmail",
      },
      { payload: { version: 2, contactPhone: "12345" }, field: "contactPhone" },
      { payload: { version: 2, postalCode: "1234" }, field: "postalCode" },
      { payload: { version: 2, state: "CEA" }, field: "state" },
      { payload: { version: 2, city: " x " }, field: "city" },
      { payload: { version: 2, district: " y " }, field: "district" },
      { payload: { version: 2, street: " z " }, field: "street" },
      { payload: { version: 2, streetNumber: "   " }, field: "streetNumber" },
    ];

    for (const item of fieldCases) {
      const res = await request("/organizations/clinica-vida/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(item.payload),
      });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: { field: item.field },
        },
      });
    }

    for (const badPayload of [
      { version: 2 },
      { version: 2, name: "Clínica Vida", slug: "novo-slug" },
      { version: 2, name: "Clínica Vida", organizationId: "org-b" },
      { version: 2, name: "Clínica Vida", id: "org-b" },
    ]) {
      const res = await request("/organizations/clinica-vida/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(badPayload),
      });
      expect(res.status).toBe(400);
    }

    expect(auditLogs).toHaveLength(0);
  });

  test("enforces RBAC and tenant isolation across roles and organizations", async () => {
    const { request, organizations, auditLogs } = setup();

    // Active non-admin members can read active clinic summary via GET /organizations/:orgSlug
    for (const userId of ["user-prof", "user-recep"]) {
      const summaryRes = await request("/organizations/clinica-vida", {
        userId,
      });
      expect(summaryRes.status).toBe(200);

      // But cannot access or mutate settings or upload logo
      const getSettings = await request(
        "/organizations/clinica-vida/settings",
        { userId },
      );
      expect(getSettings.status).toBe(403);
      expect(await getSettings.json()).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });

      const patchSettings = await request(
        "/organizations/clinica-vida/settings",
        {
          userId,
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version: 2, name: "Tentativa Sem Permissão" }),
        },
      );
      expect(patchSettings.status).toBe(403);
      expect(await patchSettings.json()).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });

      const form = new FormData();
      form.append(
        "file",
        new File([VALID_PNG], "logo.png", { type: "image/png" }),
      );
      const uploadRes = await request(
        "/organizations/clinica-vida/settings/logo",
        {
          userId,
          method: "POST",
          body: form,
        },
      );
      expect(uploadRes.status).toBe(403);
      expect(await uploadRes.json()).toMatchObject({
        error: { code: "PERMISSION_DENIED" },
      });
    }

    // Suspended admin is denied with 403 MEMBERSHIP_INACTIVE
    const suspendedRes = await request("/organizations/clinica-vida/settings", {
      userId: "user-suspended",
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 2, name: "Suspenso" }),
    });
    expect(suspendedRes.status).toBe(403);
    expect(await suspendedRes.json()).toMatchObject({
      error: { code: "MEMBERSHIP_INACTIVE" },
    });

    // Unauthenticated request is denied with 401
    const unauthRes = await request("/organizations/clinica-vida/settings", {
      userId: null,
    });
    expect(unauthRes.status).toBe(401);

    // Admin of Clinic B cannot read, update, or access logo of Clinic A
    const foreignGet = await request("/organizations/clinica-vida/settings", {
      userId: "user-other-admin",
    });
    expect(foreignGet.status).toBe(404);

    const foreignPatch = await request("/organizations/clinica-vida/settings", {
      userId: "user-other-admin",
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 2, name: "Invasão" }),
    });
    expect(foreignPatch.status).toBe(404);

    const foreignLogoDownload = await request(
      "/organizations/clinica-sul/settings/logo/download-url",
      { userId: "user-admin" },
    );
    expect(foreignLogoDownload.status).toBe(404);

    expect(organizations.get("org-a")?.name).toBe("Clínica Vida");
    expect(auditLogs).toHaveLength(0);
  });

  test("uploads, replaces, and signs private logo URLs isolated per clinic with audit trail", async () => {
    const { request, organizations, auditLogs, put, del, downloadUrl } =
      setup();

    // Before upload, download-url returns 404
    const missingLogo = await request(
      "/organizations/clinica-vida/settings/logo/download-url",
    );
    expect(missingLogo.status).toBe(404);

    // Upload initial PNG logo
    const pngForm = new FormData();
    pngForm.append(
      "file",
      new File([VALID_PNG], "logo.png", { type: "image/png" }),
    );
    const firstUpload = await request(
      "/organizations/clinica-vida/settings/logo",
      {
        method: "POST",
        body: pngForm,
      },
    );
    expect(firstUpload.status).toBe(200);
    const firstBody = (await firstUpload.json()) as ClinicSettingsResponse;
    expect(firstBody.version).toBe(3);
    expect(firstBody.logo).toMatchObject({
      contentType: "image/png",
      sizeBytes: VALID_PNG.length,
    });
    expect(typeof firstBody.logo?.updatedAt).toBe("string");
    expect(JSON.stringify(firstBody)).not.toContain("organizations/org-a/logo");

    expect(put).toHaveBeenCalledTimes(1);
    const firstKey = put.mock.calls[0]?.[0] as string;
    expect(firstKey).toMatch(/^organizations\/org-a\/logo\//);
    expect(organizations.get("org-b")?.logoObjectKey).toBe(
      "organizations/org-b/logo/existing-b",
    );

    // Replace with JPEG logo via /organizations/:orgSlug/logo alias
    const jpegForm = new FormData();
    jpegForm.append(
      "file",
      new File([VALID_JPEG], "logo.jpg", { type: "image/jpeg" }),
    );
    const secondUpload = await request("/organizations/clinica-vida/logo", {
      userId: "user-admin-prof",
      method: "POST",
      body: jpegForm,
    });
    expect(secondUpload.status).toBe(200);
    const secondBody = (await secondUpload.json()) as ClinicSettingsResponse;
    expect(secondBody.version).toBe(4);
    expect(secondBody.logo).toMatchObject({
      contentType: "image/jpeg",
      sizeBytes: VALID_JPEG.length,
    });
    expect(del).toHaveBeenCalledWith(firstKey);

    // Replace with WebP logo
    const webpForm = new FormData();
    webpForm.append(
      "file",
      new File([VALID_WEBP], "logo.webp", { type: "image/webp" }),
    );
    const thirdUpload = await request(
      "/organizations/clinica-vida/settings/logo",
      {
        method: "POST",
        body: webpForm,
      },
    );
    expect(thirdUpload.status).toBe(200);
    const thirdBody = (await thirdUpload.json()) as ClinicSettingsResponse;
    expect(thirdBody.logo?.contentType).toBe("image/webp");

    // Active members of the clinic can obtain a short-lived signed download URL
    for (const userId of ["user-admin", "user-prof", "user-recep"]) {
      const signedRes = await request(
        "/organizations/clinica-vida/settings/logo/download-url",
        { userId },
      );
      expect(signedRes.status).toBe(200);
      const signedBody = (await signedRes.json()) as ClinicLogoUrlResponse;
      expect(signedBody.expiresInSeconds).toBe(900);
      expect(signedBody.downloadUrl).toContain("organizations/org-a/logo/");
    }
    expect(downloadUrl).toHaveBeenCalledTimes(3);

    // Verify audit logs for all 3 logo uploads
    expect(auditLogs).toHaveLength(3);
    expect(auditLogs[0]).toMatchObject({
      organizationId: "org-a",
      actorUserId: "user-admin",
      action: "ORGANIZATION_LOGO_UPDATED",
      targetType: "ORGANIZATION",
      targetId: "org-a",
      metadata: {
        contentType: "image/png",
        sizeBytes: VALID_PNG.length,
        replacedPreviousLogo: false,
      },
    });
    expect(auditLogs[1]).toMatchObject({
      organizationId: "org-a",
      actorUserId: "user-admin-prof",
      action: "ORGANIZATION_LOGO_UPDATED",
      metadata: {
        contentType: "image/jpeg",
        sizeBytes: VALID_JPEG.length,
        replacedPreviousLogo: true,
      },
    });
  });

  test("rejects forged MIME types, empty files, oversized logos, and unavailable storage", async () => {
    const { request, put, auditLogs } = setup();

    const invalidFiles: Array<{ file: File; status: number }> = [
      {
        file: new File([], "empty.png", { type: "image/png" }),
        status: 400,
      },
      {
        file: new File(["not-an-image"], "fake.png", { type: "image/png" }),
        status: 400,
      },
      {
        file: new File([VALID_PNG], "spoofed.jpg", { type: "image/jpeg" }),
        status: 400,
      },
      {
        file: new File(["<svg></svg>"], "logo.svg", { type: "image/svg+xml" }),
        status: 400,
      },
      {
        file: new File(
          [new Uint8Array(PROFILE_PHOTO_MAX_BYTES + 1)],
          "huge.png",
          { type: "image/png" },
        ),
        status: 413,
      },
    ];

    for (const item of invalidFiles) {
      const form = new FormData();
      form.append("file", item.file);
      const res = await request("/organizations/clinica-vida/settings/logo", {
        method: "POST",
        body: form,
      });
      expect(res.status).toBe(item.status);
    }

    expect(put).not.toHaveBeenCalled();
    expect(auditLogs).toHaveLength(0);

    // Storage unavailable returns 503
    const unavailable = setup({ storageAvailable: false });
    const form = new FormData();
    form.append(
      "file",
      new File([VALID_PNG], "logo.png", { type: "image/png" }),
    );
    const unavailableRes = await unavailable.request(
      "/organizations/clinica-vida/settings/logo",
      {
        method: "POST",
        body: form,
      },
    );
    expect(unavailableRes.status).toBe(503);
    expect(await unavailableRes.json()).toMatchObject({
      error: { code: "STORAGE_UNAVAILABLE" },
    });
  });
});
