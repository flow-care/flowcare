import { expect, test } from "bun:test";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { ApiError } from "../src/lib/api-error";
import { hashToken } from "../src/lib/tokens";
import {
  AUTH_RATE_LIMITS,
  type AuthConfig,
  AuthService,
} from "../src/modules/auth/service";
import type { RateLimiter, RateLimitRule } from "../src/services/rate-limiter";

type TokenKind = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

interface StoredUser {
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  emailVerified: boolean;
  profileCompletedAt: Date | null;
  activeOrganizationId: string | null;
  memberships: [];
  onboarding: null;
}

interface StoredToken {
  id: string;
  userId: string;
  type: TokenKind;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

const config: AuthConfig = {
  jwtSecret: "auth-abuse-test-secret",
  sessionTtlSeconds: 12 * 3600,
  emailVerificationTtlHours: 24,
  passwordResetTtlMinutes: 30,
  verificationResendPerHour: 3,
  enumerationProtectionMinMs: 500,
  webAppUrl: "https://web.test",
  trustProxy: true,
};

const requestMetadata = {
  ipAddress: "203.0.113.25",
  userAgent: "Chrome/Linux",
};

const allowAllRateLimiter: RateLimiter = {
  consume: async () => ({ allowed: true, count: 1 }),
  reset: async () => {},
};

function fixture() {
  const users = new Map<string, StoredUser>();
  const tokens: StoredToken[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const sent: Array<{ to: string; text: string }> = [];
  let userLookups = 0;

  const prismaRecord = {
    user: {
      findUnique: async ({ where }: { where: { email?: string } }) => {
        userLookups += 1;
        if (!where.email) return null;
        return users.get(where.email) ?? null;
      },
      create: async ({
        data,
      }: {
        data: { email: string; fullName: string; passwordHash: string };
      }) => {
        const user: StoredUser = {
          id: `user-${users.size + 1}`,
          email: data.email,
          fullName: data.fullName,
          passwordHash: data.passwordHash,
          emailVerified: false,
          profileCompletedAt: null,
          activeOrganizationId: null,
          memberships: [],
          onboarding: null,
        };
        users.set(user.email, user);
        return user;
      },
      update: async () => ({}),
    },
    verificationToken: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) =>
        tokens.find((token) => token.tokenHash === where.tokenHash) ?? null,
      count: async ({
        where,
      }: {
        where: { userId: string; type: TokenKind; createdAt: { gt: Date } };
      }) =>
        tokens.filter(
          (token) =>
            token.userId === where.userId &&
            token.type === where.type &&
            token.createdAt > where.createdAt.gt,
        ).length,
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id?: string;
          userId?: string;
          type?: TokenKind;
          usedAt: null;
          expiresAt: { gt: Date };
        };
        data: { usedAt: Date };
      }) => {
        let count = 0;
        for (const token of tokens) {
          if (
            (where.id === undefined || token.id === where.id) &&
            (where.userId === undefined || token.userId === where.userId) &&
            (where.type === undefined || token.type === where.type) &&
            token.usedAt === null &&
            token.expiresAt > where.expiresAt.gt
          ) {
            token.usedAt = data.usedAt;
            count += 1;
          }
        }
        return { count };
      },
      create: async ({
        data,
      }: {
        data: {
          userId: string;
          type: TokenKind;
          tokenHash: string;
          expiresAt: Date;
        };
      }) => {
        const token: StoredToken = {
          id: `token-${tokens.length + 1}`,
          ...data,
          usedAt: null,
          createdAt: new Date(1_000),
        };
        tokens.push(token);
        return token;
      },
    },
    session: {
      updateMany: async () => ({ count: 0 }),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return { id: `audit-${audits.length}`, ...data };
      },
    },
    $queryRaw: async () => [],
    $transaction: async (
      callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => callback(prismaRecord as unknown as Prisma.TransactionClient),
  };

  return {
    prisma: prismaRecord as unknown as PrismaClient,
    users,
    tokens,
    audits,
    sent,
    get userLookups() {
      return userLookups;
    },
    mailer: {
      send: async (message: { to: string; text: string }) => {
        sent.push(message);
      },
    },
  };
}

async function capturedError(operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("A operação deveria falhar.");
}

test("login inexistente e senha errada usam resposta, custo e atraso equivalentes", async () => {
  const f = fixture();
  f.users.set("existe@example.com", {
    id: "user-existing",
    email: "existe@example.com",
    fullName: "Pessoa Existente",
    passwordHash: "stored-password-hash",
    emailVerified: true,
    profileCompletedAt: null,
    activeOrganizationId: null,
    memberships: [],
    onboarding: null,
  });
  const verifiedHashes: string[] = [];
  const sleeps: number[] = [];
  const service = new AuthService({
    prisma: f.prisma,
    mailer: f.mailer,
    config,
    rateLimiter: allowAllRateLimiter,
    clock: () => 1_000,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    verifyPassword: async (passwordHash) => {
      verifiedHashes.push(passwordHash);
      return false;
    },
  });

  const wrong = await capturedError(() =>
    service.login(
      { email: "existe@example.com", password: "senha-incorreta" },
      requestMetadata,
    ),
  );
  const nonexistent = await capturedError(() =>
    service.login(
      { email: "fantasma@example.com", password: "senha-incorreta" },
      requestMetadata,
    ),
  );

  expect({ code: wrong.code, message: wrong.message }).toEqual({
    code: nonexistent.code,
    message: nonexistent.message,
  });
  expect(verifiedHashes).toHaveLength(2);
  expect(verifiedHashes[0]).toBe("stored-password-hash");
  expect(verifiedHashes[1]).not.toBe("stored-password-hash");
  expect(sleeps).toEqual([500, 500]);
  expect(f.audits.map((audit) => audit.action)).toEqual([
    "AUTH_LOGIN_FAILED",
    "AUTH_LOGIN_FAILED",
  ]);
  expect(f.audits.map((audit) => audit.actorUserId)).toEqual([null, null]);
  const serializedAudit = JSON.stringify(f.audits);
  expect(serializedAudit).not.toContain("existe@example.com");
  expect(serializedAudit).not.toContain("fantasma@example.com");
  expect(serializedAudit).not.toContain("203.0.113.25");
  expect(serializedAudit).not.toContain("senha-incorreta");
});

test("cadastro e recuperação preservam respostas e atraso para conta existente ou inexistente", async () => {
  const f = fixture();
  f.users.set("existe@example.com", {
    id: "user-existing",
    email: "existe@example.com",
    fullName: "Pessoa Existente",
    passwordHash: "stored-password-hash",
    emailVerified: true,
    profileCompletedAt: null,
    activeOrganizationId: null,
    memberships: [],
    onboarding: null,
  });
  const sleeps: number[] = [];
  const service = new AuthService({
    prisma: f.prisma,
    mailer: f.mailer,
    config,
    rateLimiter: allowAllRateLimiter,
    clock: () => 1_000,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    hashPassword: async () => "new-password-hash",
  });

  const existingRegister = await service.register(
    {
      fullName: "Pessoa Existente",
      email: "existe@example.com",
      password: "senha-segura-123",
    },
    requestMetadata,
  );
  const newRegister = await service.register(
    {
      fullName: "Pessoa Nova",
      email: "nova@example.com",
      password: "senha-segura-123",
    },
    requestMetadata,
  );
  const existingReset = await service.forgotPassword(
    { email: "existe@example.com" },
    requestMetadata,
  );
  const ghostReset = await service.forgotPassword(
    { email: "fantasma@example.com" },
    requestMetadata,
  );

  expect(existingRegister).toEqual(newRegister);
  expect(existingReset).toEqual(ghostReset);
  expect(sleeps).toEqual([500, 500, 500, 500]);
});

test("limite por conta suprime e-mail mantendo resposta neutra e auditoria pseudonimizada", async () => {
  const f = fixture();
  const limiter: RateLimiter = {
    consume: async (rule) =>
      rule.scope.endsWith(":account")
        ? { allowed: false, count: rule.limit + 1 }
        : { allowed: true, count: 1 },
    reset: async () => {},
  };
  const service = new AuthService({
    prisma: f.prisma,
    mailer: f.mailer,
    config: { ...config, enumerationProtectionMinMs: 0 },
    rateLimiter: limiter,
  });

  const existing = await service.forgotPassword(
    { email: "existe@example.com" },
    requestMetadata,
  );
  const ghost = await service.forgotPassword(
    { email: "fantasma@example.com" },
    requestMetadata,
  );

  expect(existing).toEqual(ghost);
  expect(f.userLookups).toBe(0);
  expect(f.sent).toHaveLength(0);
  expect(f.audits.every((audit) => audit.action === "AUTH_RATE_LIMITED")).toBe(
    true,
  );
  const serializedAudit = JSON.stringify(f.audits);
  expect(serializedAudit).not.toContain("@example.com");
  expect(serializedAudit).not.toContain("203.0.113.25");
});

test("falha do limitador interrompe recuperação antes de consulta ou envio", async () => {
  const f = fixture();
  const limiter: RateLimiter = {
    consume: async () => {
      throw new Error("rate limit database unavailable");
    },
    reset: async () => {},
  };
  const service = new AuthService({
    prisma: f.prisma,
    mailer: f.mailer,
    config,
    rateLimiter: limiter,
  });

  await expect(
    service.forgotPassword({ email: "existe@example.com" }, requestMetadata),
  ).rejects.toThrow("rate limit database unavailable");
  expect(f.userLookups).toBe(0);
  expect(f.sent).toHaveLength(0);
});

test("limites por origem e conta usam escopos independentes", async () => {
  const calls: Array<{ scope: string; identifier: string }> = [];
  const limiter: RateLimiter = {
    consume: async (rule: RateLimitRule, identifier: string) => {
      calls.push({ scope: rule.scope, identifier });
      if (rule.scope === AUTH_RATE_LIMITS.login.account.scope) {
        return { allowed: false, count: rule.limit + 1 };
      }
      return { allowed: true, count: 1 };
    },
    reset: async () => {},
  };
  const f = fixture();
  const service = new AuthService({
    prisma: f.prisma,
    mailer: f.mailer,
    config: { ...config, enumerationProtectionMinMs: 0 },
    rateLimiter: limiter,
  });

  const error = await capturedError(() =>
    service.login(
      { email: "Pessoa@Example.com", password: "senha" },
      requestMetadata,
    ),
  );

  expect(error.code).toBe("RATE_LIMITED");
  expect(calls).toEqual([
    { scope: "login:origin", identifier: "203.0.113.25" },
    { scope: "login:account", identifier: "pessoa@example.com" },
  ]);
  expect(f.userLookups).toBe(0);
});

test("nova emissão invalida token anterior e token consumido não pode ser reutilizado", async () => {
  const f = fixture();
  f.users.set("existe@example.com", {
    id: "user-existing",
    email: "existe@example.com",
    fullName: "Pessoa Existente",
    passwordHash: "stored-password-hash",
    emailVerified: true,
    profileCompletedAt: null,
    activeOrganizationId: null,
    memberships: [],
    onboarding: null,
  });
  const service = new AuthService({
    prisma: f.prisma,
    mailer: f.mailer,
    config: { ...config, enumerationProtectionMinMs: 0 },
    rateLimiter: allowAllRateLimiter,
    clock: () => 1_000,
    hashPassword: async () => "updated-password-hash",
  });

  const oldVerification = await service.mintToken(
    "user-existing",
    "EMAIL_VERIFICATION",
  );
  const newVerification = await service.mintToken(
    "user-existing",
    "EMAIL_VERIFICATION",
  );
  const oldReset = await service.mintToken("user-existing", "PASSWORD_RESET");
  const newReset = await service.mintToken("user-existing", "PASSWORD_RESET");

  expect(oldVerification).not.toBe(newVerification);
  expect(oldReset).not.toBe(newReset);
  expect(
    f.tokens.find((token) => token.tokenHash === hashToken(oldVerification))
      ?.usedAt,
  ).toEqual(new Date(1_000));
  expect(
    f.tokens.find((token) => token.tokenHash === hashToken(oldReset))?.usedAt,
  ).toEqual(new Date(1_000));

  expect(
    (
      await capturedError(() =>
        service.resetPassword(
          { token: oldReset, newPassword: "nova-senha-123" },
          requestMetadata,
        ),
      )
    ).code,
  ).toBe("INVALID_TOKEN");

  await expect(
    service.resetPassword(
      { token: newReset, newPassword: "nova-senha-123" },
      requestMetadata,
    ),
  ).resolves.toMatchObject({ message: expect.any(String) });
  expect(
    (
      await capturedError(() =>
        service.resetPassword(
          { token: newReset, newPassword: "outra-senha-123" },
          requestMetadata,
        ),
      )
    ).code,
  ).toBe("INVALID_TOKEN");
});
