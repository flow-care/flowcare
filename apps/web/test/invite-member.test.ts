import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Rule 5: mock.module("server-only", () => ({})) at the top and dynamic import
mock.module("server-only", () => ({}));

let mockSessionToken: string | null = "test-session-jwt";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
  }),
}));

let revalidatedPaths: string[] = [];
mock.module("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidatedPaths.push(path);
  },
}));

const mockPush = mock(() => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockPush }),
  usePathname: () => "/app/clinica-central/settings/team",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

// Dynamic imports after server-only mock
const {
  createInviteSchema,
  getRolePermissions,
  checkEmailCollision,
  ROLE_PERMISSIONS,
  inviteMembershipRoles,
  INVITE_VALIDITY_DAYS,
  INVITE_VALIDITY_LABEL,
} = await import("../lib/team-invites");

const { createInvite, TeamApiError } = await import("../server/team");

const { createInviteAction } = await import(
  "../app/app/[orgSlug]/settings/team/actions"
);

const { InviteMemberSheet, InviteMemberForm } = await import(
  "../app/app/[orgSlug]/settings/team/invite-member-sheet"
);

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "test-session-jwt";
  revalidatedPaths = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

describe("Team Invites - Validation & Shared Logic (#321)", () => {
  test("createInviteSchema validates corporate email formats", () => {
    // Valid emails
    const valid1 = createInviteSchema.safeParse({
      email: "dra.julia@clinica.med.br",
      role: "PROFESSIONAL",
    });
    expect(valid1.success).toBe(true);
    if (valid1.success) {
      expect(valid1.data.email).toBe("dra.julia@clinica.med.br");
      expect(valid1.data.expiresInDays).toBe(7);
    }

    // Normalizes to lowercase and trims
    const validWithCaps = createInviteSchema.safeParse({
      email: "  MARCOS.SILVA@CLINICA.COM  ",
      role: "ADMIN",
    });
    expect(validWithCaps.success).toBe(true);
    if (validWithCaps.success) {
      expect(validWithCaps.data.email).toBe("marcos.silva@clinica.com");
    }

    // Invalid emails
    expect(
      createInviteSchema.safeParse({ email: "", role: "PROFESSIONAL" }).success,
    ).toBe(false);
    expect(
      createInviteSchema.safeParse({ email: "   ", role: "PROFESSIONAL" })
        .success,
    ).toBe(false);
    expect(
      createInviteSchema.safeParse({
        email: "invalid-email",
        role: "PROFESSIONAL",
      }).success,
    ).toBe(false);
    expect(
      createInviteSchema.safeParse({
        email: "@nodomain.com",
        role: "PROFESSIONAL",
      }).success,
    ).toBe(false);
    expect(
      createInviteSchema.safeParse({ email: "user@", role: "PROFESSIONAL" })
        .success,
    ).toBe(false);
  });

  test("createInviteSchema restricts role to membership roles", () => {
    for (const role of inviteMembershipRoles) {
      const res = createInviteSchema.safeParse({
        email: "colaborador@clinica.com",
        role,
      });
      expect(res.success).toBe(true);
    }

    // Invalid roles rejected
    expect(
      createInviteSchema.safeParse({
        email: "colaborador@clinica.com",
        role: "SUPERADMIN",
      }).success,
    ).toBe(false);
    expect(
      createInviteSchema.safeParse({
        email: "colaborador@clinica.com",
        role: "GUEST",
      }).success,
    ).toBe(false);
  });

  test("ROLE_PERMISSIONS provides explanatory permissions preview for all roles", () => {
    expect(inviteMembershipRoles).toEqual([
      "ADMIN",
      "ADMIN_PROFESSIONAL",
      "PROFESSIONAL",
      "RECEPTIONIST",
    ]);

    for (const r of inviteMembershipRoles) {
      const config = getRolePermissions(r);
      expect(config.role).toBe(r);
      expect(config.label.length).toBeGreaterThan(0);
      expect(config.shortDescription.length).toBeGreaterThan(0);
      expect(config.permissions.length).toBeGreaterThanOrEqual(3);
      expect(ROLE_PERMISSIONS[r].role).toBe(r);
    }

    // Check specific role capabilities
    const adminConfig = getRolePermissions("ADMIN");
    expect(adminConfig.label).toBe("Administrador");
    expect(adminConfig.permissions.some((p) => p.includes("membros"))).toBe(
      true,
    );

    const profConfig = getRolePermissions("PROFESSIONAL");
    expect(profConfig.label).toBe("Profissional Clínico");
    expect(profConfig.permissions.some((p) => p.includes("prontuários"))).toBe(
      true,
    );

    const recepConfig = getRolePermissions("RECEPTIONIST");
    expect(recepConfig.label).toBe("Recepção");
    expect(recepConfig.permissions.some((p) => p.includes("Sem acesso"))).toBe(
      true,
    );
  });

  test("checkEmailCollision identifies active members and blocks duplicates", () => {
    const activeMembers = [
      { email: "doutor@clinica.com", userName: "Dr. Roberto" },
      { email: "recepcao@clinica.com", userName: "Ana" },
    ];
    const pendingInvites = [{ id: "inv-99", email: "pedro@clinica.com" }];

    // Clean email
    expect(
      checkEmailCollision("novo@clinica.com", activeMembers, pendingInvites),
    ).toEqual({ status: "clean" });

    // Active member collision (case-insensitive & trimmed)
    const collisionActive = checkEmailCollision(
      "  DOUTOR@clinica.com  ",
      activeMembers,
      pendingInvites,
    );
    expect(collisionActive.status).toBe("active_member");
    expect(collisionActive.message).toContain("colaborador ativo");

    // Pending invite collision
    const collisionPending = checkEmailCollision(
      "PEDRO@CLINICA.COM",
      activeMembers,
      pendingInvites,
    );
    expect(collisionPending.status).toBe("pending_invite");
    expect(collisionPending.existingInviteId).toBe("inv-99");
    expect(collisionPending.message).toContain("convite pendente");
  });

  test("invitation validity constants are 7 calendar days", () => {
    expect(INVITE_VALIDITY_DAYS).toBe(7);
    expect(INVITE_VALIDITY_LABEL).toContain("7 dias");
  });
});

describe("Team Invites - Server Layer createInvite (#321)", () => {
  test("throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(
      createInvite("clinica-central", {
        email: "novo@clinica.com",
        role: "PROFESSIONAL",
      }),
    ).rejects.toThrow(TeamApiError);
  });

  test("calls POST /organizations/:orgSlug/invites with token and normalized payload", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown = null;

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? "GET";
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = init?.body ? JSON.parse(init.body as string) : null;

      return Response.json({
        id: "inv-new-123",
        email: "marina@clinica.com",
        expiresAt: "2026-10-24T18:00:00.000Z",
      });
    }) as unknown as typeof fetch;

    const result = await createInvite("clinica-central", {
      email: "  MARINA@CLINICA.COM ",
      role: "ADMIN_PROFESSIONAL",
      expiresInDays: 7,
    });

    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-central/invites",
    );
    expect(capturedMethod).toBe("POST");
    expect(capturedHeaders.Authorization).toBe("Bearer test-session-jwt");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
    expect(capturedBody).toEqual({
      email: "marina@clinica.com",
      role: "ADMIN_PROFESSIONAL",
    });

    expect(result).toEqual({
      id: "inv-new-123",
      email: "marina@clinica.com",
      expiresAt: "2026-10-24T18:00:00.000Z",
    });
  });

  test("maps 409 collision from backend with descriptive error message", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "ALREADY_EXISTS",
            message: "Esta pessoa já está vinculada à clínica.",
          },
        },
        { status: 409 },
      );
    }) as unknown as typeof fetch;

    try {
      await createInvite("clinica-central", {
        email: "existente@clinica.com",
        role: "PROFESSIONAL",
      });
      expect(true).toBe(false); // Should not be reached
    } catch (err) {
      expect(err instanceof TeamApiError).toBe(true);
      const apiErr = err as InstanceType<typeof TeamApiError>;
      expect(apiErr.code).toBe("ALREADY_EXISTS");
      expect(apiErr.message).toBe("Esta pessoa já está vinculada à clínica.");
    }
  });

  test("maps 403 Forbidden to permission error", async () => {
    globalThis.fetch = (async () => {
      return Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 });
    }) as unknown as typeof fetch;

    try {
      await createInvite("clinica-central", {
        email: "novo@clinica.com",
        role: "ADMIN",
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof TeamApiError).toBe(true);
      const apiErr = err as InstanceType<typeof TeamApiError>;
      expect(apiErr.code).toBe("FORBIDDEN");
      expect(apiErr.message).toContain("Permissão insuficiente");
    }
  });

  test("maps network failure to UNAVAILABLE", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Network offline");
    }) as unknown as typeof fetch;

    try {
      await createInvite("clinica-central", {
        email: "novo@clinica.com",
        role: "PROFESSIONAL",
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err instanceof TeamApiError).toBe(true);
      const apiErr = err as InstanceType<typeof TeamApiError>;
      expect(apiErr.code).toBe("UNAVAILABLE");
    }
  });
});

describe("Team Invites - Server Action createInviteAction (#321)", () => {
  test("rejects invalid or missing orgSlug", async () => {
    const res = await createInviteAction("", {
      email: "colaborador@clinica.com",
      role: "PROFESSIONAL",
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("VALIDATION_ERROR");
      expect(res.error.message).toContain("clínica");
    }
  });

  test("rejects invalid email via schema validation without calling API", async () => {
    let apiCalled = false;
    globalThis.fetch = (async () => {
      apiCalled = true;
      return Response.json({});
    }) as unknown as typeof fetch;

    const res = await createInviteAction("clinica-central", {
      email: "not-an-email",
      role: "PROFESSIONAL",
    });

    expect(apiCalled).toBe(false);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("VALIDATION_ERROR");
      expect(res.error.message).toContain("e-mail");
    }
  });

  test("successfully creates invite, revalidates team path and returns data", async () => {
    globalThis.fetch = (async () => {
      return Response.json({
        id: "inv-created-456",
        email: "novo.medico@clinica.com",
        expiresAt: "2026-10-24T12:00:00.000Z",
      });
    }) as unknown as typeof fetch;

    const res = await createInviteAction("clinica-central", {
      email: "novo.medico@clinica.com",
      role: "PROFESSIONAL",
      expiresInDays: 7,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.id).toBe("inv-created-456");
      expect(res.data.email).toBe("novo.medico@clinica.com");
      expect(res.data.role).toBe("PROFESSIONAL");
      expect(res.data.expiresAt).toBe("2026-10-24T12:00:00.000Z");
    }

    expect(revalidatedPaths).toContain("/app/clinica-central/settings/team");
  });

  test("maps TeamApiError appropriately in ActionResult", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "ALREADY_EXISTS",
            message: "Já existe um convite pendente para este e-mail.",
          },
        },
        { status: 409 },
      );
    }) as unknown as typeof fetch;

    const res = await createInviteAction("clinica-central", {
      email: "convidado@clinica.com",
      role: "RECEPTIONIST",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("ALREADY_EXISTS");
      expect(res.error.message).toBe(
        "Já existe um convite pendente para este e-mail.",
      );
    }
  });
});

describe("Team Invites - UI Sheet Component (#321)", () => {
  const dummyMembers = [
    { email: "dr.marcelo@clinica.com", userName: "Dr. Marcelo" },
  ];
  const dummyInvites = [
    {
      id: "inv-existing",
      email: "patricia@clinica.com",
      role: "RECEPTIONIST",
      expiresAt: "2026-10-24T12:00:00Z",
    },
  ];

  test("renders sheet with title, email field, role selector and validity indicator", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMemberForm, {
        onClose: () => {},
        orgSlug: "clinica-central",
        existingMembers: dummyMembers,
        existingInvites: dummyInvites,
      }),
    );

    expect(html).toContain("Convidar membro");
    expect(html).toContain("E-mail corporativo");
    expect(html).toContain("Papel pré-atribuído");
    expect(html).toContain("Válido por 7 dias corridos");
    expect(html).toContain("Permissões incluídas");
    expect(html).toContain("Enviar convite");
  });

  test("renders active member duplicate collision warning when email matches existing member", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMemberForm, {
        onClose: () => {},
        orgSlug: "clinica-central",
        existingMembers: dummyMembers,
        existingInvites: dummyInvites,
        initialEmail: "dr.marcelo@clinica.com",
      }),
    );
    expect(html).toContain("Colaborador já ativo");
    expect(html).toContain(
      "Este e-mail já pertence a um colaborador ativo da clínica",
    );
  });

  test("renders pending invite duplicate warning with quick resend button", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMemberForm, {
        onClose: () => {},
        orgSlug: "clinica-central",
        existingMembers: dummyMembers,
        existingInvites: dummyInvites,
        initialEmail: "patricia@clinica.com",
      }),
    );
    expect(html).toContain("Convite pendente encontrado");
    expect(html).toContain("Reenviar convite agora");
  });

  test("disables submit button when email is empty or invalid (double-click / idempotency guard)", () => {
    const htmlEmpty = renderToStaticMarkup(
      createElement(InviteMemberForm, {
        onClose: () => {},
        orgSlug: "clinica-central",
        existingMembers: dummyMembers,
        existingInvites: dummyInvites,
        initialEmail: "",
      }),
    );
    expect(htmlEmpty).toContain("disabled");
  });

  test("does not render sheet contents when isOpen is false", () => {
    const html = renderToStaticMarkup(
      createElement(InviteMemberSheet, {
        isOpen: false,
        onClose: () => {},
        orgSlug: "clinica-central",
        existingMembers: dummyMembers,
        existingInvites: dummyInvites,
      }),
    );

    expect(html).not.toContain("Convidar membro");
  });
});
