import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

process.env.API_INTERNAL_URL = "http://localhost:3001";

mock.module("server-only", () => ({}));

let mockSessionToken: string | null = "valid-session-jwt";
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (_name: string) =>
      mockSessionToken ? { value: mockSessionToken } : undefined,
  }),
}));

const mockPush = mock(() => {});
const mockReplace = mock(() => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    refresh: () => {},
  }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

const { formatSessionDevice, formatSessionIp, formatSessionDate } =
  await import("../lib/account-sessions");

const {
  listAccountSessions,
  revokeAccountSession,
  revokeOtherAccountSessions,
} = await import("../server/account-sessions");

const {
  getActiveSessionsAction,
  revokeSessionAction,
  revokeOtherSessionsAction,
} = await import("../app/account/security/actions");

const { ActiveSessionsList } = await import(
  "../app/account/security/sessions-list"
);

describe("lib/account-sessions formatters", () => {
  test("formatSessionDevice formats user-agent or provides fallback", () => {
    expect(formatSessionDevice("Chrome no Windows")).toBe("Chrome no Windows");
    expect(formatSessionDevice(null)).toBe("Dispositivo não identificado");
    expect(formatSessionDevice("   ")).toBe("Dispositivo não identificado");
  });

  test("formatSessionIp formats IP or provides fallback", () => {
    expect(formatSessionIp("192.168.1.1")).toBe("192.168.1.1");
    expect(formatSessionIp(null)).toBe("IP não disponível");
    expect(formatSessionIp("")).toBe("IP não disponível");
  });

  test("formatSessionDate returns localized date or fallback", () => {
    const formatted = formatSessionDate("2026-10-17T12:00:00.000Z");
    expect(formatted).toContain("17/10/2026");
    expect(formatSessionDate("invalid-date")).toBe("invalid-date");
  });
});

describe("server/account-sessions", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockSessionToken = "valid-session-jwt";
  });

  test("listAccountSessions returns sessions when authenticated", async () => {
    const mockSessions = [
      {
        id: "sess-1",
        isCurrent: true,
        ipAddress: "189.40.10.2",
        userAgent: "Chrome on macOS",
        lastActiveAt: "2026-10-17T14:30:00.000Z",
      },
      {
        id: "sess-2",
        isCurrent: false,
        ipAddress: "201.23.45.67",
        userAgent: "Safari on iOS",
        lastActiveAt: "2026-10-16T18:00:00.000Z",
      },
    ];

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ sessions: mockSessions }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await listAccountSessions();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessions.length).toBe(2);
      expect(result.sessions[0].id).toBe("sess-1");
      expect(result.sessions[0].isCurrent).toBe(true);
      expect(result.sessions[1].isCurrent).toBe(false);
    }
  });

  test("listAccountSessions returns UNAUTHENTICATED when token is missing", async () => {
    mockSessionToken = null;
    const result = await listAccountSessions();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("UNAUTHENTICATED");
    }
  });

  test("revokeAccountSession revokes single remote session", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ revokedCount: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await revokeAccountSession("sess-2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revokedCount).toBe(1);
    }
  });

  test("revokeAccountSession returns NOT_FOUND when session does not exist", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ message: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await revokeAccountSession("non-existent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("NOT_FOUND");
    }
  });

  test("revokeOtherAccountSessions revokes all other sessions", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ revokedCount: 3 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await revokeOtherAccountSessions();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.revokedCount).toBe(3);
    }
  });
});

describe("actions and ActiveSessionsList UI", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockSessionToken = "valid-session-jwt";
  });

  test("server actions forward to server functions", async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ sessions: [] }), { status: 200 });
    });
    const listRes = await getActiveSessionsAction();
    expect(listRes.ok).toBe(true);

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ revokedCount: 1 }), { status: 200 });
    });
    const singleRes = await revokeSessionAction("s-1");
    expect(singleRes.ok).toBe(true);

    const otherRes = await revokeOtherSessionsAction();
    expect(otherRes.ok).toBe(true);
  });

  test("ActiveSessionsList renders current session badge and blocks self-revocation", () => {
    const sessions = [
      {
        id: "current-sess",
        isCurrent: true,
        ipAddress: "192.168.0.1",
        userAgent: "Chrome no Windows",
        lastActiveAt: "2026-10-17T12:00:00.000Z",
      },
      {
        id: "remote-sess",
        isCurrent: false,
        ipAddress: "10.0.0.2",
        userAgent: "Safari no iPhone",
        lastActiveAt: "2026-10-16T10:00:00.000Z",
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ActiveSessionsList, { initialSessions: sessions }),
    );

    expect(html).toContain("Sessão atual (este dispositivo)");
    expect(html).toContain("Chrome no Windows");
    expect(html).toContain("Safari no iPhone");
    expect(html).toContain("Para sair deste dispositivo, use a opção Sair");
    expect(html).toContain("Encerrar sessão");
    expect(html).toContain("Encerrar todas as outras sessões");
  });

  test("ActiveSessionsList hides revoke all other button when only current session exists", () => {
    const sessions = [
      {
        id: "current-sess",
        isCurrent: true,
        ipAddress: "192.168.0.1",
        userAgent: "Chrome no Windows",
        lastActiveAt: "2026-10-17T12:00:00.000Z",
      },
    ];

    const html = renderToStaticMarkup(
      createElement(ActiveSessionsList, { initialSessions: sessions }),
    );

    expect(html).toContain("Sessão atual (este dispositivo)");
    expect(html).not.toContain("Encerrar todas as outras sessões");
  });
});
