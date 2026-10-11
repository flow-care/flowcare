import { hash, verify as verifyHash } from "argon2";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import type { SessionMetadata } from "../../lib/session-metadata";
import { normalizeEmail } from "../../lib/slug";
import { generateToken, hashToken } from "../../lib/tokens";
import { actionEmailHtml } from "../../services/mail-templates";
import type { Mailer } from "../../services/mailer";
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
  webAppUrl: string;
  trustProxy: boolean;
}

export interface AuthDeps {
  prisma: PrismaClient;
  mailer: Mailer;
  config: AuthConfig;
}

export const SESSION_REVOKED_ON_RESET = "reset-password";

const GENERIC_REGISTER_MESSAGE =
  "Conta criada com sucesso. Verifique seu e-mail para continuar.";
const GENERIC_RESET_MESSAGE =
  "Se o e-mail estiver cadastrado, as instruções serão enviadas.";

export class AuthService {
  constructor(private readonly deps: AuthDeps) {}

  /** #207 — cadastro público; resposta nunca revela e-mail existente. */
  async register(body: RegisterBody): Promise<{ message: string }> {
    const email = normalizeEmail(body.email);

    const existing = await this.deps.prisma.user.findUnique({
      where: { email },
    });
    if (existing) {
      if (!existing.emailVerified) {
        try {
          const token = await this.mintToken(existing.id, "EMAIL_VERIFICATION");
          await this.deliver({
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

    const passwordHash = await hash(body.password);
    const user = await this.deps.prisma.user.create({
      data: {
        email,
        fullName: body.fullName.trim(),
        passwordHash,
      },
    });

    const token = await this.mintToken(user.id, "EMAIL_VERIFICATION");
    await this.deliver({
      to: email,
      subject: "Flowcare — confirmação de cadastro",
      text: this.verificationText(token),
      html: this.verificationHtml(token),
    });

    return { message: GENERIC_REGISTER_MESSAGE };
  }

  /** #207 — confirmação de e-mail com token de uso único (hash no banco). */
  async verifyEmail(
    tokenValue: string,
    sessionMetadata: SessionMetadata,
  ): Promise<LoginResponse> {
    return this.deps.prisma.$transaction(async (tx) => {
      const record = await tx.verificationToken.findUnique({
        where: { tokenHash: hashToken(tokenValue) },
      });
      if (!record || record.type !== "EMAIL_VERIFICATION") {
        throw InvalidToken();
      }
      const consumed = await tx.verificationToken.updateMany({
        where: {
          id: record.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
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
      return this.createSession(user, sessionMetadata, tx);
    });
  }

  /** #207 — reenvio com resposta neutra para e-mail inexistente ou já verificado. */
  async resendVerification(emailValue: string): Promise<{ message: string }> {
    const email = normalizeEmail(emailValue);
    const user = await this.deps.prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified) {
      try {
        const token = await this.mintToken(user.id, "EMAIL_VERIFICATION");
        await this.deliver({
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
  }

  /** #208 — login; falhas indistinguíveis; pendente recebe estado claro. */
  async login(
    body: LoginBody,
    sessionMetadata: SessionMetadata,
  ): Promise<LoginResponse> {
    const email = normalizeEmail(body.email);
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

    if (!user || !(await verifyHash(user.passwordHash, body.password))) {
      throw InvalidCredentials();
    }
    if (!user.emailVerified) {
      throw AccountNotVerified();
    }

    return this.createSession(user, sessionMetadata);
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
  ): Promise<LoginResponse> {
    const expiresAt = new Date(
      Date.now() + this.deps.config.sessionTtlSeconds * 1000,
    );
    const session = await db.session.create({
      data: {
        userId: user.id,
        expiresAt,
        ipAddress: sessionMetadata.ipAddress,
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
          expiresAt: { gt: new Date() },
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
      onboardingCompleted: onboarding.completed,
      onboardingCurrentStep: onboarding.currentStep,
      ...(pendingInvite?.id ? { pendingInviteId: pendingInvite.id } : {}),
    };
  }

  /** #209 — solicitação de reset; resposta idêntica exista ou não o e-mail. */
  async forgotPassword(body: ForgotPasswordBody): Promise<{ message: string }> {
    const email = normalizeEmail(body.email);
    const user = await this.deps.prisma.user.findUnique({ where: { email } });

    if (user) {
      const token = await this.mintToken(user.id, "PASSWORD_RESET");
      await this.deliver({
        to: email,
        subject: "Flowcare — redefinição de senha",
        text: this.resetText(token),
        html: this.resetHtml(token),
      });
    }
    return { message: GENERIC_RESET_MESSAGE };
  }

  /**
   * #209 — redefine a senha e encerra todas as sessões anteriores.
   * Transação: consumo do token + troca de senha + revogação atômicos.
   */
  async resetPassword(body: ResetPasswordBody): Promise<{ message: string }> {
    const tokenHash = hashToken(body.token);
    const result = await this.deps.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const record = await tx.verificationToken.findUnique({
          where: { tokenHash },
        });
        if (!record || record.type !== "PASSWORD_RESET") {
          return null;
        }
        const consumed = await tx.verificationToken.updateMany({
          where: {
            id: record.id,
            usedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { usedAt: new Date() },
        });
        if (consumed.count !== 1) return null;
        await tx.user.update({
          where: { id: record.userId },
          data: { passwordHash: await hash(body.newPassword) },
        });
        await tx.session.updateMany({
          where: { userId: record.userId, revokedAt: null },
          data: { revokedAt: new Date() },
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
    if (type === "EMAIL_VERIFICATION") {
      const windowStart = new Date(Date.now() - 60 * 60 * 1000);
      const recent = await this.deps.prisma.verificationToken.count({
        where: { userId, type, createdAt: { gt: windowStart } },
      });
      if (recent >= this.deps.config.verificationResendPerHour) {
        throw RateLimited();
      }
    }

    const token = generateToken();
    const ttl =
      type === "EMAIL_VERIFICATION"
        ? this.deps.config.emailVerificationTtlHours * 3600 * 1000
        : this.deps.config.passwordResetTtlMinutes * 60 * 1000;

    await this.deps.prisma.verificationToken.create({
      data: {
        userId,
        type,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ttl),
      },
    });
    return token;
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
