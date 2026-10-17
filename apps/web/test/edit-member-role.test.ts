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

const { updateMemberRole, TeamApiError } = await import("../server/team");

const { updateMemberRoleAction } = await import(
  "../app/app/[orgSlug]/settings/team/actions"
);

const {
  membershipRoles,
  isAdministratorRole,
  isClinicalRole,
  isLastAdminDowngradeBlocked,
  LAST_ADMIN_DOWNGRADE_ALERT,
  getRoleChangeImpact,
  updateMemberRoleSchema,
  getMemberRoleErrorMessage,
} = await import("../lib/team-members");

const { EditMemberForm, EditMemberSheet } = await import(
  "../app/app/[orgSlug]/settings/team/edit-member-sheet"
);

const { TeamSettingsView } = await import(
  "../app/app/[orgSlug]/settings/team/team-settings-view"
);

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
  mockPush.mockClear();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

describe("Team Members - Domain & Helper Rules (#322)", () => {
  test("membershipRoles constant defines the 4 official roles", () => {
    expect(membershipRoles).toHaveLength(4);
    expect(membershipRoles).toContain("ADMIN");
    expect(membershipRoles).toContain("ADMIN_PROFESSIONAL");
    expect(membershipRoles).toContain("PROFESSIONAL");
    expect(membershipRoles).toContain("RECEPTIONIST");
  });

  test("isAdministratorRole classifies administrative roles correctly", () => {
    expect(isAdministratorRole("ADMIN")).toBe(true);
    expect(isAdministratorRole("ADMIN_PROFESSIONAL")).toBe(true);
    expect(isAdministratorRole("PROFESSIONAL")).toBe(false);
    expect(isAdministratorRole("RECEPTIONIST")).toBe(false);
  });

  test("isClinicalRole classifies clinical roles correctly", () => {
    expect(isClinicalRole("PROFESSIONAL")).toBe(true);
    expect(isClinicalRole("ADMIN_PROFESSIONAL")).toBe(true);
    expect(isClinicalRole("ADMIN")).toBe(false);
    expect(isClinicalRole("RECEPTIONIST")).toBe(false);
  });

  describe("Last Admin Downgrade Guard", () => {
    test("blocks downgrade from ADMIN to non-admin when sole admin (count <= 1)", () => {
      expect(isLastAdminDowngradeBlocked("ADMIN", "PROFESSIONAL", 1)).toBe(
        true,
      );
      expect(isLastAdminDowngradeBlocked("ADMIN", "RECEPTIONIST", 1)).toBe(
        true,
      );
      expect(
        isLastAdminDowngradeBlocked("ADMIN_PROFESSIONAL", "PROFESSIONAL", 1),
      ).toBe(true);
      expect(
        isLastAdminDowngradeBlocked("ADMIN_PROFESSIONAL", "RECEPTIONIST", 1),
      ).toBe(true);
    });

    test("allows transition between admin roles even if sole admin", () => {
      // ADMIN <-> ADMIN_PROFESSIONAL does not reduce the admin count to 0
      expect(
        isLastAdminDowngradeBlocked("ADMIN", "ADMIN_PROFESSIONAL", 1),
      ).toBe(false);
      expect(
        isLastAdminDowngradeBlocked("ADMIN_PROFESSIONAL", "ADMIN", 1),
      ).toBe(false);
    });

    test("allows downgrade when there are multiple active admins in the clinic", () => {
      expect(isLastAdminDowngradeBlocked("ADMIN", "PROFESSIONAL", 2)).toBe(
        false,
      );
      expect(
        isLastAdminDowngradeBlocked("ADMIN_PROFESSIONAL", "RECEPTIONIST", 3),
      ).toBe(false);
    });

    test("allows role changes for non-admin members regardless of admin count", () => {
      expect(
        isLastAdminDowngradeBlocked("PROFESSIONAL", "RECEPTIONIST", 1),
      ).toBe(false);
      expect(
        isLastAdminDowngradeBlocked("RECEPTIONIST", "PROFESSIONAL", 1),
      ).toBe(false);
    });

    test("LAST_ADMIN_DOWNGRADE_ALERT message contains the required guard wording", () => {
      expect(LAST_ADMIN_DOWNGRADE_ALERT).toContain(
        "A clínica deve manter ao menos um administrador ativo.",
      );
      expect(LAST_ADMIN_DOWNGRADE_ALERT).toContain(
        "Promova outro membro a administrador antes de alterar o papel deste colaborador.",
      );
    });
  });

  describe("Impact Warning Analysis (getRoleChangeImpact)", () => {
    test("returns hasChanged = false when target role matches current role", () => {
      const impact = getRoleChangeImpact("ADMIN", "ADMIN");
      expect(impact.hasChanged).toBe(false);
      expect(impact.gainedPermissions).toHaveLength(0);
      expect(impact.lostPermissions).toHaveLength(0);
    });

    test("ADMIN -> PROFESSIONAL loses admin and gains clinical permissions", () => {
      const impact = getRoleChangeImpact("ADMIN", "PROFESSIONAL");
      expect(impact.hasChanged).toBe(true);
      expect(impact.lostAdmin).toBe(true);
      expect(impact.gainedClinical).toBe(true);
      expect(impact.gainedAdmin).toBe(false);
      expect(impact.lostClinical).toBe(false);

      expect(
        impact.lostPermissions.some((p) => p.includes("administrativas")),
      ).toBe(true);
      expect(
        impact.gainedPermissions.some((p) => p.includes("prontuários")),
      ).toBe(true);
      expect(impact.clinicalQualificationNotice).toBeDefined();
    });

    test("PROFESSIONAL -> ADMIN loses clinical and gains admin permissions", () => {
      const impact = getRoleChangeImpact("PROFESSIONAL", "ADMIN");
      expect(impact.hasChanged).toBe(true);
      expect(impact.gainedAdmin).toBe(true);
      expect(impact.lostClinical).toBe(true);

      expect(
        impact.gainedPermissions.some((p) => p.includes("Gestão completa")),
      ).toBe(true);
      expect(
        impact.lostPermissions.some((p) => p.includes("Atendimento clínico")),
      ).toBe(true);
    });

    test("RECEPTIONIST -> ADMIN gains admin permissions without losing clinical", () => {
      const impact = getRoleChangeImpact("RECEPTIONIST", "ADMIN");
      expect(impact.hasChanged).toBe(true);
      expect(impact.gainedAdmin).toBe(true);
      expect(impact.lostAdmin).toBe(false);
      expect(impact.lostClinical).toBe(false);
    });

    test("ADMIN -> ADMIN_PROFESSIONAL retains admin and gains clinical permissions", () => {
      const impact = getRoleChangeImpact("ADMIN", "ADMIN_PROFESSIONAL");
      expect(impact.hasChanged).toBe(true);
      expect(impact.gainedAdmin).toBe(false); // already admin
      expect(impact.lostAdmin).toBe(false);
      expect(impact.gainedClinical).toBe(true);
      expect(impact.clinicalQualificationNotice).toBeDefined();
    });
  });

  describe("updateMemberRoleSchema validation", () => {
    test("accepts valid role and integer version >= 1", () => {
      const valid = updateMemberRoleSchema.safeParse({
        role: "ADMIN",
        version: 1,
      });
      expect(valid.success).toBe(true);
    });

    test("rejects invalid role", () => {
      const invalid = updateMemberRoleSchema.safeParse({
        role: "SUPERADMIN",
        version: 1,
      });
      expect(invalid.success).toBe(false);
    });

    test("rejects version <= 0", () => {
      const invalid = updateMemberRoleSchema.safeParse({
        role: "PROFESSIONAL",
        version: 0,
      });
      expect(invalid.success).toBe(false);
    });
  });

  describe("Error code mapping helper", () => {
    test("maps 409 VERSION_CONFLICT accurately", () => {
      expect(getMemberRoleErrorMessage("VERSION_CONFLICT")).toBe(
        "O membro foi modificado por outro usuário. Recarregue os dados e tente novamente.",
      );
    });

    test("maps 409 LAST_ADMIN_REQUIRED accurately", () => {
      expect(getMemberRoleErrorMessage("LAST_ADMIN_REQUIRED")).toBe(
        "A clínica deve manter ao menos um administrador ativo.",
      );
    });

    test("maps 403 FORBIDDEN accurately", () => {
      expect(getMemberRoleErrorMessage("FORBIDDEN")).toBe(
        "Não é permitido alterar o próprio papel por esta rota.",
      );
    });

    test("maps 422 CLINICAL_QUALIFICATION_REQUIRED accurately", () => {
      expect(getMemberRoleErrorMessage("CLINICAL_QUALIFICATION_REQUIRED")).toBe(
        "Dados profissionais exigidos para atribuição de papel clínico.",
      );
    });

    test("returns fallback message for unknown code", () => {
      expect(
        getMemberRoleErrorMessage("CUSTOM_ERROR", "Erro customizado"),
      ).toBe("Erro customizado");
    });
  });
});

describe("Team Members - Server Layer (updateMemberRole) (#322)", () => {
  test("throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(
      updateMemberRole("clinica-vida", "mem-1", {
        role: "PROFESSIONAL",
        version: 1,
      }),
    ).rejects.toThrow(TeamApiError);
  });

  test("calls PATCH /organizations/:orgSlug/members/:memberId/role with bearer token and body", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? "GET";
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = (init?.body as string) ?? "";
      return Response.json({
        id: "mem-1",
        userId: "user-1",
        organizationId: "org-1",
        role: "PROFESSIONAL",
        status: "ACTIVE",
        version: 2,
        createdAt: "2026-01-10T10:00:00.000Z",
        updatedAt: "2026-10-17T15:00:00.000Z",
        user: {
          id: "user-1",
          fullName: "Dra. Ana Silva",
          email: "ana@clinica.com",
          professionalRole: "Médica",
          professionalTitle: "Cardiologista",
          registrationNumber: "CRM-SP 123456",
        },
      });
    }) as unknown as typeof fetch;

    const res = await updateMemberRole("clinica-vida", "mem-1", {
      role: "PROFESSIONAL",
      version: 1,
    });

    expect(capturedUrl).toContain(
      "/organizations/clinica-vida/members/mem-1/role",
    );
    expect(capturedMethod).toBe("PATCH");
    expect(capturedHeaders.Authorization).toBe("Bearer valid-session-jwt");
    expect(JSON.parse(capturedBody)).toEqual({
      role: "PROFESSIONAL",
      version: 1,
    });

    expect(res.id).toBe("mem-1");
    expect(res.role).toBe("PROFESSIONAL");
    expect(res.version).toBe(2);
    expect(res.user?.fullName).toBe("Dra. Ana Silva");
  });

  test("handles 409 VERSION_CONFLICT with specific message", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "VERSION_CONFLICT",
            message:
              "O membro foi modificado por outro usuário. Recarregue os dados e tente novamente.",
          },
        },
        { status: 409 },
      );
    }) as unknown as typeof fetch;

    try {
      await updateMemberRole("clinica-vida", "mem-1", {
        role: "PROFESSIONAL",
        version: 1,
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      const apiErr = err as InstanceType<typeof TeamApiError>;
      expect(apiErr.code).toBe("VERSION_CONFLICT");
      expect(apiErr.message).toContain(
        "O membro foi modificado por outro usuário",
      );
    }
  });

  test("handles 409 LAST_ADMIN_REQUIRED with specific message", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "LAST_ADMIN_REQUIRED",
            message: "A clínica deve manter ao menos um administrador ativo.",
          },
        },
        { status: 409 },
      );
    }) as unknown as typeof fetch;

    try {
      await updateMemberRole("clinica-vida", "mem-1", {
        role: "PROFESSIONAL",
        version: 1,
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      const apiErr = err as InstanceType<typeof TeamApiError>;
      expect(apiErr.code).toBe("LAST_ADMIN_REQUIRED");
      expect(apiErr.message).toBe(
        "A clínica deve manter ao menos um administrador ativo.",
      );
    }
  });

  test("handles 403 FORBIDDEN when user attempts self-role alteration", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Não é permitido alterar o próprio papel por esta rota.",
          },
        },
        { status: 403 },
      );
    }) as unknown as typeof fetch;

    try {
      await updateMemberRole("clinica-vida", "mem-1", {
        role: "RECEPTIONIST",
        version: 1,
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      const apiErr = err as InstanceType<typeof TeamApiError>;
      expect(apiErr.code).toBe("FORBIDDEN");
      expect(apiErr.message).toBe(
        "Não é permitido alterar o próprio papel por esta rota.",
      );
    }
  });

  test("handles 422 CLINICAL_QUALIFICATION_REQUIRED when user lacks medical credentials", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "CLINICAL_QUALIFICATION_REQUIRED",
            message:
              "Dados profissionais exigidos para atribuição de papel clínico.",
          },
        },
        { status: 422 },
      );
    }) as unknown as typeof fetch;

    try {
      await updateMemberRole("clinica-vida", "mem-1", {
        role: "PROFESSIONAL",
        version: 1,
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      const apiErr = err as InstanceType<typeof TeamApiError>;
      expect(apiErr.code).toBe("CLINICAL_QUALIFICATION_REQUIRED");
      expect(apiErr.message).toBe(
        "Dados profissionais exigidos para atribuição de papel clínico.",
      );
    }
  });

  test("handles 404 NOT_FOUND", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Membro não encontrado." } },
        { status: 404 },
      );
    }) as unknown as typeof fetch;

    try {
      await updateMemberRole("clinica-vida", "mem-nao-existe", {
        role: "RECEPTIONIST",
        version: 1,
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      expect((err as InstanceType<typeof TeamApiError>).code).toBe("NOT_FOUND");
    }
  });

  test("handles network failure with UNAVAILABLE", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Network down");
    }) as unknown as typeof fetch;

    try {
      await updateMemberRole("clinica-vida", "mem-1", {
        role: "ADMIN",
        version: 1,
      });
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      expect((err as InstanceType<typeof TeamApiError>).code).toBe(
        "UNAVAILABLE",
      );
    }
  });
});

describe("Team Members - Server Action (updateMemberRoleAction) (#322)", () => {
  test("rejects missing or empty orgSlug or memberId", async () => {
    const res1 = await updateMemberRoleAction("", "mem-1", {
      role: "ADMIN",
      version: 1,
    });
    expect(res1.ok).toBe(false);
    if (!res1.ok) expect(res1.error.code).toBe("VALIDATION_ERROR");

    const res2 = await updateMemberRoleAction("clinica-vida", "   ", {
      role: "ADMIN",
      version: 1,
    });
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects invalid role in payload", async () => {
    const res = await updateMemberRoleAction("clinica-vida", "mem-1", {
      role: "NON_EXISTENT_ROLE",
      version: 1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_ERROR");
  });

  test("returns ok: true with updated data on success", async () => {
    globalThis.fetch = (async () => {
      return Response.json({
        id: "mem-1",
        userId: "user-1",
        organizationId: "org-1",
        role: "ADMIN_PROFESSIONAL",
        status: "ACTIVE",
        version: 2,
        createdAt: "2026-01-10T10:00:00.000Z",
        updatedAt: "2026-10-17T15:00:00.000Z",
      });
    }) as unknown as typeof fetch;

    const res = await updateMemberRoleAction("clinica-vida", "mem-1", {
      role: "ADMIN_PROFESSIONAL",
      version: 1,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.id).toBe("mem-1");
      expect(res.data.role).toBe("ADMIN_PROFESSIONAL");
      expect(res.data.version).toBe(2);
    }
  });

  test("returns mapped error when API returns VERSION_CONFLICT", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "VERSION_CONFLICT",
            message:
              "O membro foi modificado por outro usuário. Recarregue os dados e tente novamente.",
          },
        },
        { status: 409 },
      );
    }) as unknown as typeof fetch;

    const res = await updateMemberRoleAction("clinica-vida", "mem-1", {
      role: "RECEPTIONIST",
      version: 1,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("VERSION_CONFLICT");
      expect(res.error.message).toContain("O membro foi modificado");
    }
  });
});

describe("Team Members - UI Components (EditMemberSheet) (#322)", () => {
  const sampleMember = {
    id: "mem-1",
    userId: "user-1",
    userName: "Dr. Roberto Martins",
    email: "roberto@clinica.com",
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
    version: 1,
    createdAt: "2026-03-01T10:00:00.000Z",
  };

  test("EditMemberForm renders member avatar initials, name, email, and current role badge", () => {
    const html = renderToStaticMarkup(
      createElement(EditMemberForm, {
        onClose: () => {},
        orgSlug: "clinica-vida",
        member: sampleMember,
        activeAdminCount: 2,
      }),
    );

    expect(html).toContain("DM");
    expect(html).toContain("Dr. Roberto Martins");
    expect(html).toContain("roberto@clinica.com");
    expect(html).toContain("Administrador");
    expect(html).toContain("Membro desde:");
    expect(html).toContain("Novo papel do colaborador");
  });

  test("EditMemberForm displays last admin downgrade guard alert when sole admin attempts non-admin selection", () => {
    const html = renderToStaticMarkup(
      createElement(EditMemberForm, {
        onClose: () => {},
        orgSlug: "clinica-vida",
        member: sampleMember,
        activeAdminCount: 1,
        initialSelectedRole: "PROFESSIONAL",
      }),
    );

    expect(html).toContain("Rebaixamento não permitido");
    expect(html).toContain(
      "A clínica deve manter ao menos um administrador ativo. Promova outro membro a administrador antes de alterar o papel deste colaborador.",
    );
    expect(
      isLastAdminDowngradeBlocked(sampleMember.role, "PROFESSIONAL", 1),
    ).toBe(true);
    expect(
      isLastAdminDowngradeBlocked(sampleMember.role, "RECEPTIONIST", 1),
    ).toBe(true);
  });

  test("EditMemberForm renders impact callout and confirmation checkbox when role is modified", () => {
    const html = renderToStaticMarkup(
      createElement(EditMemberForm, {
        onClose: () => {},
        orgSlug: "clinica-vida",
        member: sampleMember,
        activeAdminCount: 2,
        initialSelectedRole: "ADMIN_PROFESSIONAL",
      }),
    );

    expect(html).toContain("Permissões concedidas:");
    expect(html).toContain("Atenção: A atribuição de papel clínico exige");
    expect(html).toContain(
      "Estou ciente das alterações de permissões e confirmo a atualização do papel deste colaborador.",
    );
  });

  test("EditMemberForm disables submit when role has not changed", () => {
    const html = renderToStaticMarkup(
      createElement(EditMemberForm, {
        onClose: () => {},
        orgSlug: "clinica-vida",
        member: sampleMember,
        activeAdminCount: 2,
      }),
    );

    expect(html).toContain(
      "O papel selecionado é o mesmo atualmente atribuído a este colaborador.",
    );
    expect(html).toContain('disabled=""');
  });

  test("EditMemberSheet does not render when member is null", () => {
    const html = renderToStaticMarkup(
      createElement(EditMemberSheet, {
        isOpen: true,
        onClose: () => {},
        orgSlug: "clinica-vida",
        member: null,
        activeAdminCount: 1,
      }),
    );

    expect(html).not.toContain("Dr. Roberto Martins");
  });

  test("TeamSettingsView renders edit link in table with sheet=edit&memberId=...", () => {
    const html = renderToStaticMarkup(
      createElement(TeamSettingsView, {
        orgSlug: "clinica-vida",
        initialMembers: [sampleMember],
        initialInvites: [],
      }),
    );

    expect(html).toContain("Dr. Roberto Martins");
    expect(html).toContain("sheet=edit&amp;memberId=mem-1");
    expect(html).toContain("Editar");
  });
});
