import { hash, verify as verifyHash } from "argon2";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type { SessionMetadata } from "../../lib/session-metadata";
import { normalizeEmail } from "../../lib/slug";
import { generateToken, hashToken } from "../../lib/tokens";
import { recordAuditEvent } from "../../services/audit-logger";
import { actionEmailHtml } from "../../services/mail-templates";
import type { Mailer } from "../../services/mailer";
import {
  createPrismaRateLimiter,
  privateIdentifierDigest,
  type RateLimiter,
  type RateLimitResult,
  type RateLimitRule,
} from "../../services/rate-limiter";
import { signSessionToken } from "../../services/session-token";
import { resolveOnboardingState } from "../onboarding/steps";
import {
  AccountNotVerified,
  InvalidCredentials,
  InvalidToken,
  RateLimited,
} from "./errors";
import type {
  ForgotPasswordBody,
  LoginBody,
  LoginResponse,
  RegisterBody,
  ResetPasswordBody,
} from "./model";

/**
 * Regras de negócio de autenticação (#207/#208/#209, decisões #192).
 *
 * Independente de Context/HTTP: recebe dependências por injeção (prisma,
 * mailer, config), o que mantém o módulo testável e desacoplado.
 */
export interface AuthConfig {
  jwtSecret: string;
  sessionTtlSeconds: number;
  emailVerificationTtlHours: number;
  passwordResetTtlMinutes: number;
  verificationResendPerHour: number;
  enumerationProtectionMinMs: number;
  webAppUrl: string;
  trustProxy: boolean;
}

export interface AuthDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  config: AuthConfig;
  rateLimiter?: RateLimiter;
  clock?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  hashPassword?: (password: string) => Promise<string>;
  verifyPassword?: (passwordHash: string, password: string) => Promise<boolean>;
}

export const SESSION_REVOKED_ON_RESET = "reset-password";

const GENERIC_REGISTER_MESSAGE =
  "Conta criada com sucesso. Verifique seu e-mail para continuar.";
const GENERIC_RESET_MESSAGE =
  "Se o e-mail estiver cadastrado, as instruções serão enviadas.";

const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$6imSk77qu5HIFcIHxL5K6A$2Xid/Wj/iz44EBZUmbmcsojO2lH8TNg40jZPEsBUSus";
const UNKNOWN_ORIGIN = "unknown";

const minutes = (value: number) => value * 60;
const hours = (value: number) => minutes(value * 60);

export const AUTH_RATE_LIMITS = {
  login: {
    origin: { scope: "login:origin", limit: 20, windowSeconds: minutes(15) },
    account: {
      scope: "login:account",
      limit: 5,
      windowSeconds: minutes(15),
    },
  },
  verification: {
    origin: {
      scope: "verification-mail:origin",
      limit: 10,
      windowSeconds: hours(1),
    },
    account: {
      scope: "verification-mail:account",
      limit: 3,
      windowSeconds: hours(1),
    },
  },
  passwordResetRequest: {
    origin: {
      scope: "password-reset-request:origin",
      limit: 10,
      windowSeconds: hours(1),
    },
    account: {
      scope: "password-reset-request:account",
      limit: 3,
      windowSeconds: hours(1),
    },
  },
  verifyEmail: {
    origin: {
      scope: "verify-email:origin",
      limit: 20,
      windowSeconds: minutes(15),
    },
    token: {
      scope: "verify-email:token",
      limit: 5,
      windowSeconds: minutes(15),
    },
  },
  resetPassword: {
    origin: {
      scope: "reset-password:origin",
      limit: 10,
      windowSeconds: minutes(15),
    },
    token: {
      scope: "reset-password:token",
      limit: 5,
      windowSeconds: minutes(15),
    },
  },
} as const satisfies Record<string, Record<string, RateLimitRule>>;

export class AuthService {
  private readonly rateLimiter: RateLimiter;
  private readonly clock: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly hashPassword: (password: string) => Promise<string>;
  private readonly verifyPassword: (
    passwordHash: string,
    password: string,
  ) => Promise<boolean>;

  constructor(private readonly deps: AuthDeps) {
    this.rateLimiter =
      deps.rateLimiter ??
      createPrismaRateLimiter(deps.prisma, deps.config.jwtSecret);
    this.clock = deps.clock ?? Date.now;
    this.sleep =
      deps.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.hashPassword = deps.hashPassword ?? hash;
    this.verifyPassword = deps.verifyPassword ?? verifyHash;
  }

  /** #207 — cadastro público; resposta nunca revela e-mail existente. */
  async register(
    body: RegisterBody,
    requestMetadata: SessionMetadata,
  ): Promise<{ message: string }> {
    const email = normalizeEmail(body.email);
    const origin = this.originIdentifier(requestMetadata);
    await this.enforceRateLimit(
      AUTH_RATE_LIMITS.verification.origin,
      origin,
      "/auth/register",
    );
    const startedAt = this.clock();

    try {
      const accountLimit = await this.rateLimiter.consume(
        AUTH_RATE_LIMITS.verification.account,
        email,
      );
      if (!accountLimit.allowed) {
        await this.auditRateLimitOnce(
          AUTH_RATE_LIMITS.verification.account,
          accountLimit,
          email,
          origin,
          "/auth/register",
        );
        return { message: GENERIC_REGISTER_MESSAGE };
      }

      const [existing, passwordHash] = await Promise.all([
        this.deps.prisma.user.findUnique({ where: { email } }),
        this.hashPassword(body.password),
      ]);
      if (existing) {
        if (!existing.emailVerified) {
          try {
            const token = await this.mintToken(
              existing.id,
              "EMAIL_VERIFICATION",
            );
            this.deliver({
              to: email,
              subject: "Flowcare — confirmação de cadastro",
              text: this.verificationText(token),
              html: this.verificationHtml(token),
            });
          } catch (error) {
            if (!(error instanceof ApiError && error.code === "RATE_LIMITED")) {
              throw error;
            }
          }
        }
        return { message: GENERIC_REGISTER_MESSAGE };
      }

      const user = await this.deps.prisma.user.create({
        data: {
          email,
          fullName: body.fullName.trim(),
          passwordHash,
        },
      });

      const token = await this.mintToken(user.id, "EMAIL_VERIFICATION");
      this.deliver({
        to: email,
        subject: "Flowcare — confirmação de cadastro",
        text: this.verificationText(token),
        html: this.verificationHtml(token),
      });

      return { message: GENERIC_REGISTER_MESSAGE };
    } finally {
      await this.equalizeEnumerationTiming(startedAt);
    }
  }

  /** #207 — confirmação de e-mail com token de uso único (hash no banco). */
  async verifyEmail(
    tokenValue: string,
    sessionMetadata: SessionMetadata,
  ): Promise<LoginResponse> {
    const origin = this.originIdentifier(sessionMetadata);
    await this.enforceRateLimit(
      AUTH_RATE_LIMITS.verifyEmail.origin,
      origin,
      "/auth/verify-email",
    );
    await this.enforceRateLimit(
      AUTH_RATE_LIMITS.verifyEmail.token,
      tokenValue,
      "/auth/verify-email",
      origin,
    );

    return this.deps.prisma.$transaction(async (tx) => {
      const record = await tx.verificationToken.findUnique({
        where: { tokenHash: hashToken(tokenValue) },
      });
      if (!record || record.type !== "EMAIL_VERIFICATION") {
        throw InvalidToken();
      }
      await this.lockUserForTokenMutation(tx, record.userId);
      const now = new Date(this.clock());
      const consumed = await tx.verificationToken.updateMany({
        where: {
          id: record.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw InvalidToken();
      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerified: true },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: record.userId },
        include: {
          memberships: {
            where: { status: "ACTIVE" },
            include: { organization: true },
          },
          onboarding: true,
        },
      });
      return this.createSession(
        user,
        sessionMetadata,
        tx,
        "AUTH_EMAIL_VERIFIED",
      );
    });
  }

  /** #207 — reenvio com resposta neutra para e-mail inexistente ou já verificado. */
  async resendVerification(
    emailValue: string,
    requestMetadata: SessionMetadata,
  ): Promise<{ message: string }> {
    const email = normalizeEmail(emailValue);
    const origin = this.originIdentifier(requestMetadata);
    await this.enforceRateLimit(
      AUTH_RATE_LIMITS.verification.origin,
      origin,
      "/auth/resend-verification",
    );
    const startedAt = this.clock();

    try {
      const accountLimit = await this.rateLimiter.consume(
        AUTH_RATE_LIMITS.verification.account,
        email,
      );
      if (!accountLimit.allowed) {
        await this.auditRateLimitOnce(
          AUTH_RATE_LIMITS.verification.account,
          accountLimit,
          email,
          origin,
          "/auth/resend-verification",
        );
        return {
          message: "Se a conta estiver pendente, um novo link será enviado.",
        };
      }

      const user = await this.deps.prisma.user.findUnique({ where: { email } });
      if (user && !user.emailVerified) {
        try {
          const token = await this.mintToken(user.id, "EMAIL_VERIFICATION");
          this.deliver({
            to: email,
            subject: "Flowcare — confirmação de cadastro",
            text: this.verificationText(token),
            html: this.verificationHtml(token),
          });
        } catch (error) {
          // O limite por conta não pode revelar se o endereço existe.
          if (!(error instanceof ApiError && error.code === "RATE_LIMITED")) {
            throw error;
          }
        }
      }
      return {
        message: "Se a conta estiver pendente, um novo link será enviado.",
      };
    } finally {
      await this.equalizeEnumerationTiming(startedAt);
    }
  }

  /** #208 — login; falhas indistinguíveis; pendente recebe estado claro. */
  async login(
    body: LoginBody,
    sessionMetadata: SessionMetadata,
  ): Promise<LoginResponse> {
    const email = normalizeEmail(body.email);
    const origin = this.originIdentifier(sessionMetadata);
    await this.enforceRateLimit(
      AUTH_RATE_LIMITS.login.origin,
      origin,
      "/auth/login",
    );
    await this.enforceRateLimit(
      AUTH_RATE_LIMITS.login.account,
      email,
      "/auth/login",
      origin,
    );
    const startedAt = this.clock();

    try {
      const user = await this.deps.prisma.user.findUnique({
        where: { email },
        include: {
          memberships: {
            where: { status: "ACTIVE" },
            include: { organization: true },
          },
          onboarding: true,
        },
      });

      const passwordMatches = await this.verifyPassword(
        user?.passwordHash ?? DUMMY_PASSWORD_HASH,
        body.password,
      );
      if (!user || !passwordMatches) {
        await this.recordLoginFailure(email, origin);
        throw InvalidCredentials();
      }
      if (!user.emailVerified) {
        throw AccountNotVerified();
      }

      const response = await this.createSession(user, sessionMetadata);
      await this.rateLimiter.reset(AUTH_RATE_LIMITS.login.account, email);
      return response;
    } finally {
      await this.equalizeEnumerationTiming(startedAt);
    }
  }

  private async createSession(
    user: Prisma.UserGetPayload<{
      include: {
        memberships: { include: { organization: true } };
        onboarding: true;
      };
    }>,
    sessionMetadata: SessionMetadata,
    db: Prisma.TransactionClient | PrismaClient = this.deps.prisma,
    auditAction:
      | "AUTH_LOGIN_SUCCEEDED"
      | "AUTH_EMAIL_VERIFIED" = "AUTH_LOGIN_SUCCEEDED",
  ): Promise<LoginResponse> {
    const expiresAt = new Date(
      this.clock() + this.deps.config.sessionTtlSeconds * 1000,
    );
    const session = await db.session.create({
      data: {
        userId: user.id,
        expiresAt,
        ipAddress: sessionMetadata.ipAddress,
        userAgent: sessionMetadata.userAgent,
      },
    });
    const activeMembership = user.memberships.find(
      (m) => m.organizationId === user.activeOrganizationId,
    );
    await recordAuditEvent(db, {
      organizationId: activeMembership?.organization.id ?? null,
      actorUserId: user.id,
      action: auditAction,
      targetType: "SESSION",
      targetId: session.id,
      metadata: {
        originHash: this.privateSubjectId(
          "origin",
          this.originIdentifier(sessionMetadata),
        ),
        userAgent: sessionMetadata.userAgent,
      },
    });
    const token = signSessionToken(
      { sid: session.id, sub: user.id },
      this.deps.config.jwtSecret,
      this.deps.config.sessionTtlSeconds,
    );
    const onboarding = resolveOnboardingState({
      profileCompleted: user.profileCompletedAt !== null,
      hasOrganization: user.memberships.length > 0,
      savedProgress: user.onboarding,
    });
    const pendingInvite = await db.organizationInvite
      ?.findFirst({
        where: {
          email: user.email.toLowerCase(),
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date(this.clock()) },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
      .catch(() => null);

    return {
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      availableOrganizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        isOwner: m.organization.ownerId === user.id,
      })),
      activeOrganization: activeMembership
        ? {
            id: activeMembership.organization.id,
            slug: activeMembership.organization.slug,
          }
        : null,
      onboardingCompleted: onboarding.completed,
      onboardingCurrentStep: onboarding.currentStep,
      ...(pendingInvite?.id ? { pendingInviteId: pendingInvite.id } : {}),
    };
  }

  /** #209 — solicitação de reset; resposta idêntica exista ou não o e-mail. */
  async forgotPassword(
    body: ForgotPasswordBody,
    requestMetadata: SessionMetadata,
  ): Promise<{ message: string }> {
    const email = normalizeEmail(body.email);
    const origin = this.originIdentifier(requestMetadata);
    await this.enforceRateLimit(
      AUTH_RATE_LIMITS.passwordResetRequest.origin,
      origin,
      "/auth/forgot-password",
    );
    const startedAt = this.clock();

    try {
      const accountLimit = await this.rateLimiter.consume(
        AUTH_RATE_LIMITS.passwordResetRequest.account,
        email,
      );
      if (!accountLimit.allowed) {
        await this.auditRateLimitOnce(
          AUTH_RATE_LIMITS.passwordResetRequest.account,
          accountLimit,
          email,
          origin,
          "/auth/forgot-password",
        );
        return { message: GENERIC_RESET_MESSAGE };
      }

      const user = await this.deps.prisma.user.findUnique({ where: { email } });

      if (user) {
        const token = await this.mintToken(user.id, "PASSWORD_RESET");
        this.deliver({
          to: email,
          subject: "Flowcare — redefinição de senha",
          text: this.resetText(token),
          html: this.resetHtml(token),
        });
      }
      return { message: GENERIC_RESET_MESSAGE };
    } finally {
      await this.equalizeEnumerationTiming(startedAt);
    }
  }

  /**
   * #209 — redefine a senha e encerra todas as sessões anteriores.
   * Transação: consumo do token + troca de senha + revogação atômicos.
   */
  async resetPassword(
    body: ResetPasswordBody,
    requestMetadata: SessionMetadata,
  ): Promise<{ message: string }> {
    const origin = this.originIdentifier(requestMetadata);
    await this.enforceRateLimit(
      AUTH_RATE_LIMITS.resetPassword.origin,
      origin,
      "/auth/reset-password",
    );
    await this.enforceRateLimit(
      AUTH_RATE_LIMITS.resetPassword.token,
      body.token,
      "/auth/reset-password",
      origin,
    );
    const tokenHash = hashToken(body.token);
    const result = await this.deps.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const record = await tx.verificationToken.findUnique({
          where: { tokenHash },
        });
        if (!record || record.type !== "PASSWORD_RESET") {
          return null;
        }
        await this.lockUserForTokenMutation(tx, record.userId);
        const now = new Date(this.clock());
        const consumed = await tx.verificationToken.updateMany({
          where: {
            id: record.id,
            usedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (consumed.count !== 1) return null;
        await tx.user.update({
          where: { id: record.userId },
          data: { passwordHash: await this.hashPassword(body.newPassword) },
        });
        await tx.session.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await recordAuditEvent(tx, {
          actorUserId: record.userId,
          action: "AUTH_PASSWORD_RESET_COMPLETED",
          targetType: "USER",
          targetId: record.userId,
          metadata: {
            revokedAllSessions: true,
          },
        });
        return true;
      },
    );

    if (!result) throw InvalidToken();
    return {
      message:
        "Senha alterada com sucesso. Todas as sessões anteriores foram encerradas.",
    };
  }

  /**
   * Emite token de uso único, guardando só o hash. Reenvio de verificação
   * tem limite por janela de 1h (#207: "reenvio limitado").
   */
  async mintToken(
    userId: string,
    type: "EMAIL_VERIFICATION" | "PASSWORD_RESET",
  ): Promise<string> {
    return this.deps.prisma.$transaction(async (tx) => {
      await this.lockUserForTokenMutation(tx, userId);
      const now = new Date(this.clock());

      if (type === "EMAIL_VERIFICATION") {
        const windowStart = new Date(now.getTime() - 60 * 60 * 1000);
        const recent = await tx.verificationToken.count({
          where: { userId, type, createdAt: { gt: windowStart } },
        });
        if (recent >= this.deps.config.verificationResendPerHour) {
          throw RateLimited();
        }
      }

      await tx.verificationToken.updateMany({
        where: {
          userId,
          type,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      const token = generateToken();
      const ttl =
        type === "EMAIL_VERIFICATION"
          ? this.deps.config.emailVerificationTtlHours * 3600 * 1000
          : this.deps.config.passwordResetTtlMinutes * 60 * 1000;

      await tx.verificationToken.create({
        data: {
          userId,
          type,
          tokenHash: hashToken(token),
          expiresAt: new Date(now.getTime() + ttl),
        },
      });
      return token;
    });
  }

  private originIdentifier(metadata: SessionMetadata): string {
    return metadata.ipAddress ?? UNKNOWN_ORIGIN;
  }

  private privateSubjectId(scope: string, value: string): string {
    return privateIdentifierDigest(this.deps.config.jwtSecret, scope, value);
  }

  private async enforceRateLimit(
    rule: RateLimitRule,
    identifier: string,
    route: string,
    origin = identifier,
  ): Promise<void> {
    const result = await this.rateLimiter.consume(rule, identifier);
    if (result.allowed) return;

    await this.auditRateLimitOnce(rule, result, identifier, origin, route);
    throw RateLimited();
  }

  private async auditRateLimitOnce(
    rule: RateLimitRule,
    result: RateLimitResult,
    identifier: string,
    origin: string,
    route: string,
  ): Promise<void> {
    if (result.count !== rule.limit + 1) return;

    await recordAuditEvent(this.deps.prisma, {
      actorUserId: null,
      action: "AUTH_RATE_LIMITED",
      targetType: "AUTH_SUBJECT",
      targetId: this.privateSubjectId(rule.scope, identifier),
      metadata: {
        route,
        scope: rule.scope,
        limit: rule.limit,
        windowSeconds: rule.windowSeconds,
        originHash: this.privateSubjectId("origin", origin),
      },
    });
  }

  private async recordLoginFailure(
    email: string,
    origin: string,
  ): Promise<void> {
    await recordAuditEvent(this.deps.prisma, {
      actorUserId: null,
      action: "AUTH_LOGIN_FAILED",
      targetType: "AUTH_SUBJECT",
      targetId: this.privateSubjectId("email", email),
      metadata: {
        originHash: this.privateSubjectId("origin", origin),
      },
    });
  }

  private async equalizeEnumerationTiming(startedAt: number): Promise<void> {
    const remaining =
      this.deps.config.enumerationProtectionMinMs - (this.clock() - startedAt);
    if (remaining > 0) await this.sleep(remaining);
  }

  private async lockUserForTokenMutation(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "User"
      WHERE "id" = ${userId}::uuid
      FOR UPDATE
    `;
  }

  private deliver(message: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): void {
    void this.deps.mailer.send(message).catch(() => {
      // A falha do provedor não deve revelar se o e-mail pertence a uma conta.
      console.error("[auth] falha ao entregar e-mail de autenticação");
    });
  }

  private verificationText(token: string): string {
    return `Confirme seu e-mail no Flowcare:\n${this.deps.config.webAppUrl}/verify-email?token=${token}\n\nO link é de uso único e expira em ${this.deps.config.emailVerificationTtlHours}h.`;
  }

  private resetText(token: string): string {
    return `Redefina sua senha no Flowcare:\n${this.deps.config.webAppUrl}/reset-password?token=${token}\n\nO link é de uso único e expira em ${this.deps.config.passwordResetTtlMinutes}min.`;
  }

  private verificationHtml(token: string): string {
    return actionEmailHtml({
      title: "Confirme seu e-mail",
      description: "Confirme seu endereço para acessar o Flowcare.",
      action: "Confirmar e-mail",
      url: `${this.deps.config.webAppUrl}/verify-email?token=${token}`,
      expiry: `O link é de uso único e expira em ${this.deps.config.emailVerificationTtlHours}h.`,
    });
  }

  private resetHtml(token: string): string {
    return actionEmailHtml({
      title: "Redefina sua senha",
      description: "Use este link para criar uma nova senha no Flowcare.",
      action: "Redefinir senha",
      url: `${this.deps.config.webAppUrl}/reset-password?token=${token}`,
      expiry: `O link é de uso único e expira em ${this.deps.config.passwordResetTtlMinutes}min.`,
    });
  }
}
