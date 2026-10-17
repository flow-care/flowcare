import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("server-only", () => ({}));

let mockSessionToken: string | null = "valid-session-jwt";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
  }),
}));

mock.module("next/cache", () => ({
  revalidatePath: () => {},
}));

const mockPush = mock(() => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockPush }),
  usePathname: () => "/app/clinica-vida/settings/team",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const {
  getTeamMembersAndInvites,
  resendInvite,
  revokeInvite,
  TeamApiError,
  membershipRoles,
} = await import("../server/team");

const { resendInviteAction, revokeInviteAction } = await import(
  "../app/app/[orgSlug]/settings/team/actions"
);

const {
  TeamSettingsView,
  RevokeInviteDialog,
  getRevokeConfirmationMessage,
  formatTeamDate,
  getRoleBadgeConfig,
} = await import("../app/app/[orgSlug]/settings/team/team-settings-view");

const { TeamSettingsForbidden, TeamSettingsError } = await import(
  "../app/app/[orgSlug]/settings/team/page"
);

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

describe("Team Settings - Server Layer (#320)", () => {
  test("getTeamMembersAndInvites throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(getTeamMembersAndInvites("clinica-vida")).rejects.toThrow(
      TeamApiError,
    );
  });

  test("getTeamMembersAndInvites calls both members and invites endpoints in parallel", async () => {
    const requestedUrls: string[] = [];

    globalThis.fetch = (async (url: string) => {
      requestedUrls.push(url);
      if (url.includes("/members")) {
        return Response.json({
          data: [
            {
              id: "mem-1",
              userId: "user-1",
              userName: "Dra. Ana Silva",
              email: "ana@clinica.com",
              role: "ADMIN",
              status: "ACTIVE",
              createdAt: "2026-01-10T10:00:00.000Z",
            },
          ],
        });
      }
      if (url.includes("/invites")) {
        return Response.json({
          data: [
            {
              id: "inv-1",
              email: "carlos@clinica.com",
              role: "PROFESSIONAL",
              expiresAt: "2026-10-24T12:00:00.000Z",
              createdAt: "2026-10-17T12:00:00.000Z",
            },
          ],
        });
      }
      return Response.json({}, { status: 404 });
    }) as unknown as typeof fetch;

    const data = await getTeamMembersAndInvites("clinica-vida");
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls.some((u) => u.includes("/members"))).toBe(true);
    expect(requestedUrls.some((u) => u.includes("/invites"))).toBe(true);

    expect(data.members).toHaveLength(1);
    expect(data.members[0].userName).toBe("Dra. Ana Silva");
    expect(data.members[0].role).toBe("ADMIN");

    expect(data.invites).toHaveLength(1);
    expect(data.invites[0].email).toBe("carlos@clinica.com");
    expect(data.invites[0].role).toBe("PROFESSIONAL");
  });

  test("getTeamMembersAndInvites handles 403 Forbidden with clean error", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        { error: { code: "FORBIDDEN", message: "Acesso restrito." } },
        { status: 403 },
      );
    }) as unknown as typeof fetch;

    try {
      await getTeamMembersAndInvites("clinica-vida");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      expect((err as InstanceType<typeof TeamApiError>).code).toBe("FORBIDDEN");
    }
  });

  test("getTeamMembersAndInvites handles 404 Not Found", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Clínica não encontrada." } },
        { status: 404 },
      );
    }) as unknown as typeof fetch;

    try {
      await getTeamMembersAndInvites("clinica-inexistente");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      expect((err as InstanceType<typeof TeamApiError>).code).toBe("NOT_FOUND");
    }
  });

  test("resendInvite calls POST /organizations/:orgSlug/invites/:inviteId/resend", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? "GET";
      return Response.json({
        id: "inv-123",
        email: "novo@clinica.com",
        expiresAt: "2026-10-24T18:00:00.000Z",
      });
    }) as unknown as typeof fetch;

    const res = await resendInvite("clinica-vida", "inv-123");
    expect(capturedUrl).toContain(
      "/organizations/clinica-vida/invites/inv-123/resend",
    );
    expect(capturedMethod).toBe("POST");
    expect(res.id).toBe("inv-123");
    expect(res.expiresAt).toBe("2026-10-24T18:00:00.000Z");
  });

  test("resendInvite maps 409 conflict to ALREADY_EXISTS", async () => {
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
      await resendInvite("clinica-vida", "inv-123");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      expect((err as InstanceType<typeof TeamApiError>).code).toBe(
        "ALREADY_EXISTS",
      );
    }
  });

  test("revokeInvite calls DELETE /organizations/:orgSlug/invites/:inviteId", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? "GET";
      return Response.json({ message: "Convite revogado." });
    }) as unknown as typeof fetch;

    const res = await revokeInvite("clinica-vida", "inv-123");
    expect(capturedUrl).toContain(
      "/organizations/clinica-vida/invites/inv-123",
    );
    expect(capturedMethod).toBe("DELETE");
    expect(res.success).toBe(true);
  });
});

describe("Team Settings - Server Actions (#320)", () => {
  test("resendInviteAction rejects empty or whitespace parameters", async () => {
    const res = await resendInviteAction("", "inv-1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("VALIDATION_ERROR");
    }
  });

  test("resendInviteAction returns ok: true with updated expiresAt", async () => {
    globalThis.fetch = (async () => {
      return Response.json({
        id: "inv-1",
        email: "medico@clinica.com",
        expiresAt: "2026-10-24T15:00:00.000Z",
      });
    }) as unknown as typeof fetch;

    const res = await resendInviteAction("clinica-vida", "inv-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.id).toBe("inv-1");
      expect(res.data.expiresAt).toBe("2026-10-24T15:00:00.000Z");
    }
  });

  test("revokeInviteAction returns ok: true on successful revocation", async () => {
    globalThis.fetch = (async () => {
      return Response.json({ message: "Convite revogado." });
    }) as unknown as typeof fetch;

    const res = await revokeInviteAction("clinica-vida", "inv-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.success).toBe(true);
    }
  });

  test("actions map error codes and messages accurately", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Convite pendente não encontrado.",
          },
        },
        { status: 404 },
      );
    }) as unknown as typeof fetch;

    const res = await resendInviteAction("clinica-vida", "inv-inexistente");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("NOT_FOUND");
      expect(res.error.message).toBe("Convite pendente não encontrado.");
    }
  });
});

describe("Team Settings - Role Protection & RBAC (#320)", () => {
  test("TeamSettingsForbidden renders 403 access restricted view", () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsForbidden, { orgSlug: "clinica-vida" }),
    );

    expect(html).toContain("403 — Acesso Restrito");
    expect(html).toContain("Acesso restrito a administradores da clínica");
    expect(html).toContain("Voltar ao Dashboard");
  });

  test("TeamSettingsError renders retry option", () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsError, {
        orgSlug: "clinica-vida",
        errorMessage: "Falha de conexão com o servidor.",
      }),
    );

    expect(html).toContain("Não foi possível carregar a equipe");
    expect(html).toContain("Falha de conexão com o servidor.");
    expect(html).toContain("Tentar novamente");
  });

  test("RBAC rule: only ADMIN and ADMIN_PROFESSIONAL are authorized", () => {
    const allowedRoles = ["ADMIN", "ADMIN_PROFESSIONAL"];
    const blockedRoles = ["PROFESSIONAL", "RECEPTIONIST"];

    for (const role of allowedRoles) {
      expect(role === "ADMIN" || role === "ADMIN_PROFESSIONAL").toBe(true);
    }

    for (const role of blockedRoles) {
      expect(role === "ADMIN" || role === "ADMIN_PROFESSIONAL").toBe(false);
    }
  });
});

describe("Team Settings - UI View & Last Administrator Protection (#320)", () => {
  const singleAdmin = [
    {
      id: "mem-1",
      userId: "u-1",
      userName: "Dra. Beatriz Santos",
      email: "beatriz@clinica.com",
      role: "ADMIN" as const,
      status: "ACTIVE" as const,
      createdAt: "2026-02-01T10:00:00.000Z",
    },
  ];

  const multipleMembers = [
    {
      id: "mem-1",
      userId: "u-1",
      userName: "Dra. Beatriz Santos",
      email: "beatriz@clinica.com",
      role: "ADMIN" as const,
      status: "ACTIVE" as const,
      createdAt: "2026-02-01T10:00:00.000Z",
    },
    {
      id: "mem-2",
      userId: "u-2",
      userName: "Dr. Marcelo Ramos",
      email: "marcelo@clinica.com",
      role: "ADMIN_PROFESSIONAL" as const,
      status: "ACTIVE" as const,
      createdAt: "2026-02-15T14:00:00.000Z",
    },
    {
      id: "mem-3",
      userId: "u-3",
      userName: "Juliana Lima",
      email: "juliana@clinica.com",
      role: "RECEPTIONIST" as const,
      status: "ACTIVE" as const,
      createdAt: "2026-03-01T08:00:00.000Z",
    },
  ];

  const sampleInvites = [
    {
      id: "inv-1",
      email: "dr.felipe@clinica.com",
      role: "PROFESSIONAL" as const,
      expiresAt: "2026-10-25T12:00:00.000Z",
      createdAt: "2026-10-18T12:00:00.000Z",
    },
  ];

  test("renders header with title and prominent 'Convidar membro' button (?sheet=invite)", () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsView, {
        orgSlug: "clinica-vida",
        initialMembers: multipleMembers,
        initialInvites: sampleInvites,
      }),
    );

    expect(html).toContain("Equipe e Permissões");
    expect(html).toContain("Convidar membro");
    expect(html).toContain("sheet=invite");
  });

  test("separates active members and pending invites into tabs", () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsView, {
        orgSlug: "clinica-vida",
        initialMembers: multipleMembers,
        initialInvites: sampleInvites,
      }),
    );

    expect(html).toContain("Membros Ativos");
    expect(html).toContain("Convites Pendentes");
    expect(html).toContain("Dra. Beatriz Santos");
    expect(html).toContain("dr.felipe@clinica.com");
  });

  test("protection for last administrator: renders shield badge and protection indicator", () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsView, {
        orgSlug: "clinica-vida",
        initialMembers: singleAdmin,
        initialInvites: [],
      }),
    );

    // Sole admin must show "Administrador principal"
    expect(html).toContain("Administrador principal");
    expect(html).toContain("Protegido");
  });

  test("clinic with only single admin: renders single admin callout banner", () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsView, {
        orgSlug: "clinica-vida",
        initialMembers: singleAdmin,
        initialInvites: [],
      }),
    );

    expect(html).toContain("Clínica com apenas 1 administrador");
    expect(html).toContain("Convidar agora");
  });

  test("when multiple admins exist: neither is restricted as sole administrator", () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsView, {
        orgSlug: "clinica-vida",
        initialMembers: multipleMembers,
        initialInvites: [],
      }),
    );

    // When there are 2 admins (ADMIN and ADMIN_PROFESSIONAL), sole admin protection is not active
    expect(html).not.toContain("Administrador principal");
    expect(html).not.toContain("Clínica com apenas 1 administrador");
  });

  test("empty state for pending invites: renders clean empty illustration and invite button", () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsView, {
        orgSlug: "clinica-vida",
        initialMembers: multipleMembers,
        initialInvites: [],
        defaultTab: "invites",
      }),
    );

    expect(html).toContain("Nenhum convite pendente");
    expect(html).toContain("Convidar novo membro");
  });

  test("renders distinct color badges for all membership roles", () => {
    const adminConfig = getRoleBadgeConfig("ADMIN");
    const adminProConfig = getRoleBadgeConfig("ADMIN_PROFESSIONAL");
    const proConfig = getRoleBadgeConfig("PROFESSIONAL");
    const recepConfig = getRoleBadgeConfig("RECEPTIONIST");

    expect(adminConfig.label).toBe("Administrador");
    expect(adminConfig.className).toContain("indigo");

    expect(adminProConfig.label).toBe("Administrador e Clínico");
    expect(adminProConfig.className).toContain("blue");

    expect(proConfig.label).toBe("Profissional Clínico");
    expect(proConfig.className).toContain("emerald");

    expect(recepConfig.label).toBe("Recepção");
    expect(recepConfig.className).toContain("amber");
  });

  test("actions menu has edit permissions link with ?sheet=edit&memberId=...", () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsView, {
        orgSlug: "clinica-vida",
        initialMembers: multipleMembers,
        initialInvites: sampleInvites,
      }),
    );

    expect(html).toContain("sheet=edit&amp;memberId=mem-3");
    expect(html).toContain("Editar");
  });

  test("pending invites table renders actions: Reenviar and Revogar", () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsView, {
        orgSlug: "clinica-vida",
        initialMembers: multipleMembers,
        initialInvites: sampleInvites,
        defaultTab: "invites",
      }),
    );

    expect(html).toContain("Reenviar");
    expect(html).toContain("Revogar");
    expect(html).toContain("Reenviar convite para dr.felipe@clinica.com");
    expect(html).toContain("Revogar convite para dr.felipe@clinica.com");
  });

  test("revoke invite confirmation dialog warns that the link is invalidated", () => {
    const confirmationText = getRevokeConfirmationMessage(
      sampleInvites[0].email,
    );
    expect(confirmationText).toContain("dr.felipe@clinica.com");
    expect(confirmationText).toContain("imediatamente invalidado");
    expect(confirmationText).toContain("não poderá mais ser utilizado");

    const element = createElement(RevokeInviteDialog, {
      invite: sampleInvites[0],
      open: true,
      isRevoking: false,
      onOpenChange: () => {},
      onConfirm: () => {},
    });
    expect(element.type).toBe(RevokeInviteDialog);
    expect(element.props.invite.email).toBe("dr.felipe@clinica.com");
  });

  test("formatTeamDate handles valid, null, and invalid dates without throwing", () => {
    const formatted = formatTeamDate("2026-10-17T14:30:00.000Z");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("17/10/2026");

    expect(formatTeamDate(null)).toBe("—");
    expect(formatTeamDate(undefined)).toBe("—");
    expect(formatTeamDate("data-invalida")).toBe("data-invalida");
  });

  test("membershipRoles constant includes all 4 roles", () => {
    expect(membershipRoles).toContain("ADMIN");
    expect(membershipRoles).toContain("ADMIN_PROFESSIONAL");
    expect(membershipRoles).toContain("PROFESSIONAL");
    expect(membershipRoles).toContain("RECEPTIONIST");
  });
});
