import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Rule 5: mock.module("server-only", () => ({})) at the top and dynamic import
mock.module("server-only", () => ({}));

let mockSessionToken: string | null = "valid-session-jwt";
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
  usePathname: () => "/app/clinica-vida/settings/team",
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
  isSoleAdminMember,
  isNameConfirmationMatching,
  memberRemovalExplanations,
  LAST_ADMIN_BLOCK_MESSAGE,
  MEMBER_REMOVAL_ERRORS,
} = await import("../lib/team-removal");

const { removeMember, TeamApiError } = await import("../server/team");

const { removeMemberAction } = await import(
  "../app/app/[orgSlug]/settings/team/actions"
);

const { EditMemberForm } = await import(
  "../app/app/[orgSlug]/settings/team/edit-member-sheet"
);

const originalFetch = globalThis.fetch;
const originalApiUrl = process.env.API_INTERNAL_URL;

beforeEach(() => {
  process.env.API_INTERNAL_URL = "http://api.test/api";
  mockSessionToken = "valid-session-jwt";
  revalidatedPaths = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiUrl === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = originalApiUrl;
});

const sampleMembers = [
  {
    id: "mem-1",
    userId: "user-1",
    userName: "Dra. Beatriz Santos",
    email: "beatriz@clinica.com",
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
    createdAt: "2026-01-10T10:00:00.000Z",
  },
  {
    id: "mem-2",
    userId: "user-2",
    userName: "Dr. Carlos Lima",
    email: "carlos@clinica.com",
    role: "ADMIN_PROFESSIONAL" as const,
    status: "ACTIVE" as const,
    createdAt: "2026-02-15T11:00:00.000Z",
  },
  {
    id: "mem-3",
    userId: "user-3",
    userName: "Enf. Roberta Lima",
    email: "roberta@clinica.com",
    role: "PROFESSIONAL" as const,
    status: "ACTIVE" as const,
    createdAt: "2026-03-20T09:30:00.000Z",
  },
];

const soleAdminList = [
  {
    id: "mem-sole",
    userId: "user-sole",
    userName: "Dr. Paulo Castro",
    email: "paulo@clinica.com",
    role: "ADMIN" as const,
    status: "ACTIVE" as const,
    createdAt: "2026-01-01T08:00:00.000Z",
  },
  {
    id: "mem-other",
    userId: "user-other",
    userName: "Mariana Silva",
    email: "mariana@clinica.com",
    role: "RECEPTIONIST" as const,
    status: "ACTIVE" as const,
    createdAt: "2026-02-01T08:00:00.000Z",
  },
];

describe("Secure Member Removal - Safeguards & Shared Logic (#323)", () => {
  test("isSoleAdminMember returns true only when target member is an admin and the only active admin", () => {
    // In soleAdminList, Dr. Paulo Castro is the only admin
    expect(isSoleAdminMember(soleAdminList[0], soleAdminList)).toBe(true);

    // Receptionist in same clinic is not an admin
    expect(isSoleAdminMember(soleAdminList[1], soleAdminList)).toBe(false);

    // In sampleMembers, both mem-1 (ADMIN) and mem-2 (ADMIN_PROFESSIONAL) exist
    expect(isSoleAdminMember(sampleMembers[0], sampleMembers)).toBe(false);
    expect(isSoleAdminMember(sampleMembers[1], sampleMembers)).toBe(false);
    expect(isSoleAdminMember(sampleMembers[2], sampleMembers)).toBe(false);
  });

  test("isSoleAdminMember excludes suspended administrators from active count", () => {
    const listWithSuspended = [
      {
        id: "mem-1",
        role: "ADMIN",
        status: "ACTIVE",
      },
      {
        id: "mem-2",
        role: "ADMIN",
        status: "SUSPENDED",
      },
    ];

    expect(isSoleAdminMember(listWithSuspended[0], listWithSuspended)).toBe(
      true,
    );
  });

  test("isNameConfirmationMatching validates full name case-insensitively and trimmed", () => {
    const target = "Dra. Beatriz Santos";

    // Exact match
    expect(isNameConfirmationMatching("Dra. Beatriz Santos", target)).toBe(
      true,
    );

    // Case-insensitive match
    expect(isNameConfirmationMatching("dra. beatriz santos", target)).toBe(
      true,
    );
    expect(isNameConfirmationMatching("DRA. BEATRIZ SANTOS", target)).toBe(
      true,
    );

    // Leading and trailing whitespace trimmed
    expect(isNameConfirmationMatching("  Dra. Beatriz Santos  ", target)).toBe(
      true,
    );

    // Partial or mismatched names rejected
    expect(isNameConfirmationMatching("Beatriz", target)).toBe(false);
    expect(isNameConfirmationMatching("Dra.", target)).toBe(false);
    expect(isNameConfirmationMatching("Dra. Beatriz", target)).toBe(false);
    expect(isNameConfirmationMatching("", target)).toBe(false);
    expect(isNameConfirmationMatching("   ", target)).toBe(false);
  });

  test("memberRemovalExplanations contains all 3 required notices", () => {
    expect(memberRemovalExplanations.accessRevocation).toContain(
      "O colaborador perderá o acesso a esta organização imediatamente e suas credenciais ativas para esta clínica serão revogadas.",
    );
    expect(memberRemovalExplanations.clinicalHistoryPreserved).toContain(
      "Histórico preservado: Prontuários, anamneses, consultas e laudos emitidos ou assinados por este profissional permanecerão totalmente preservados e acessíveis na clínica.",
    );
    expect(memberRemovalExplanations.personalAccountRetention).toContain(
      "A conta pessoal do usuário continuará existindo no sistema para outras clínicas às quais ele eventualmente pertença.",
    );
  });

  test("LAST_ADMIN_BLOCK_MESSAGE matches organizational requirement", () => {
    expect(LAST_ADMIN_BLOCK_MESSAGE).toBe(
      "Não é possível remover o único administrador remanescente da organização. Promova outro membro a administrador antes de prosseguir.",
    );
  });

  test("MEMBER_REMOVAL_ERRORS maps standard codes to friendly Portuguese messages", () => {
    expect(MEMBER_REMOVAL_ERRORS.LAST_ADMIN_REQUIRED).toBe(
      "Não é possível remover o único administrador remanescente da organização.",
    );
    expect(MEMBER_REMOVAL_ERRORS.NOT_FOUND).toBe("Membro não encontrado.");
    expect(MEMBER_REMOVAL_ERRORS.PERMISSION_DENIED).toBe(
      "Você não possui permissão para realizar esta ação.",
    );
  });
});

describe("Secure Member Removal - Server Layer (#323)", () => {
  test("removeMember throws UNAUTHENTICATED when session token is missing", async () => {
    mockSessionToken = null;
    expect(removeMember("clinica-vida", "mem-1")).rejects.toThrow(TeamApiError);
  });

  test("removeMember issues DELETE /organizations/:orgSlug/members/:memberId with Authorization header", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedAuth = "";

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = init?.method ?? "GET";
      capturedAuth =
        (init?.headers as Record<string, string>)?.Authorization ?? "";
      return Response.json({
        success: true,
        message: "Membro removido da organização com sucesso.",
        memberId: "mem-3",
      });
    }) as unknown as typeof fetch;

    const result = await removeMember("clinica-vida", "mem-3");
    expect(capturedUrl).toBe(
      "http://api.test/api/organizations/clinica-vida/members/mem-3",
    );
    expect(capturedMethod).toBe("DELETE");
    expect(capturedAuth).toBe("Bearer valid-session-jwt");
    expect(result.success).toBe(true);
    expect(result.memberId).toBe("mem-3");
  });

  test("removeMember maps 409 conflict to LAST_ADMIN_REQUIRED error", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "LAST_ADMIN_REQUIRED",
            message:
              "Não é possível remover o único administrador remanescente da organização.",
          },
        },
        { status: 409 },
      );
    }) as unknown as typeof fetch;

    try {
      await removeMember("clinica-vida", "mem-sole");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      const apiErr = err as InstanceType<typeof TeamApiError>;
      expect(apiErr.code).toBe("LAST_ADMIN_REQUIRED");
      expect(apiErr.message).toContain(
        "Não é possível remover o único administrador remanescente",
      );
    }
  });

  test("removeMember maps 404 to NOT_FOUND error", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "Membro não encontrado.",
          },
        },
        { status: 404 },
      );
    }) as unknown as typeof fetch;

    try {
      await removeMember("clinica-vida", "mem-unknown");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      const apiErr = err as InstanceType<typeof TeamApiError>;
      expect(apiErr.code).toBe("NOT_FOUND");
      expect(apiErr.message).toBe("Membro não encontrado.");
    }
  });

  test("removeMember maps 403 to PERMISSION_DENIED / FORBIDDEN error", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "PERMISSION_DENIED",
            message: "Você não possui permissão para realizar esta ação.",
          },
        },
        { status: 403 },
      );
    }) as unknown as typeof fetch;

    try {
      await removeMember("clinica-vida", "mem-3");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      const apiErr = err as InstanceType<typeof TeamApiError>;
      expect(apiErr.code).toBe("PERMISSION_DENIED");
      expect(apiErr.message).toBe(
        "Você não possui permissão para realizar esta ação.",
      );
    }
  });

  test("removeMember throws UNAVAILABLE on network error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("Network offline");
    }) as unknown as typeof fetch;

    try {
      await removeMember("clinica-vida", "mem-3");
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(TeamApiError);
      const apiErr = err as InstanceType<typeof TeamApiError>;
      expect(apiErr.code).toBe("UNAVAILABLE");
      expect(apiErr.message).toContain("Não foi possível remover o membro");
    }
  });
});

describe("Secure Member Removal - Server Action (#323)", () => {
  test("removeMemberAction rejects invalid or empty parameters", async () => {
    const res1 = await removeMemberAction("", "mem-1");
    expect(res1.ok).toBe(false);
    if (!res1.ok) {
      expect(res1.error.code).toBe("VALIDATION_ERROR");
    }

    const res2 = await removeMemberAction("clinica-vida", "   ");
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.error.code).toBe("VALIDATION_ERROR");
    }
  });

  test("removeMemberAction calls removeMember and revalidates team settings path", async () => {
    globalThis.fetch = (async () => {
      return Response.json({
        success: true,
        message: "Membro removido da organização com sucesso.",
        memberId: "mem-3",
      });
    }) as unknown as typeof fetch;

    const res = await removeMemberAction("clinica-vida", "mem-3");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.success).toBe(true);
      expect(res.data.memberId).toBe("mem-3");
    }
    expect(revalidatedPaths).toContain("/app/clinica-vida/settings/team");
  });

  test("removeMemberAction catches TeamApiError and returns clean ok: false", async () => {
    globalThis.fetch = (async () => {
      return Response.json(
        {
          error: {
            code: "LAST_ADMIN_REQUIRED",
            message:
              "Não é possível remover o único administrador remanescente da organização.",
          },
        },
        { status: 409 },
      );
    }) as unknown as typeof fetch;

    const res = await removeMemberAction("clinica-vida", "mem-sole");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("LAST_ADMIN_REQUIRED");
      expect(res.error.message).toContain(
        "Não é possível remover o único administrador remanescente",
      );
    }
  });
});

describe("Secure Member Removal - Edit Sheet (#323)", () => {
  test("shows the removal action and preserves the history explanation", () => {
    const html = renderToStaticMarkup(
      createElement(EditMemberForm, {
        member: sampleMembers[2],
        activeAdminCount: 2,
        orgSlug: "clinica-vida",
        onClose: () => {},
        onInitiateRemoval: () => {},
      }),
    );
    expect(html).toContain("Remover membro da clínica");
    expect(html).toContain("preserva o histórico clínico");
  });

  test("blocks removal of the only administrator", () => {
    const html = renderToStaticMarkup(
      createElement(EditMemberForm, {
        member: soleAdminList[0],
        activeAdminCount: 1,
        orgSlug: "clinica-vida",
        onClose: () => {},
        onInitiateRemoval: () => {},
      }),
    );
    expect(html).toContain(
      "A clínica deve manter ao menos um administrador ativo.",
    );
    expect(html).toMatch(/disabled[^>]*>.*Remover membro da clínica/s);
  });
});
