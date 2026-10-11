import { hash, verify as verifyHash } from "argon2";
import type { PrismaClient } from "../../generated/prisma/client";
import {
  safeSessionIpAddress,
  summarizeUserAgent,
} from "../../lib/session-metadata";
import {
  InvalidCurrentPassword,
  SessionNotFound,
  UserNotFound,
} from "./errors";
import type {
  ChangePasswordBody,
  ChangePasswordResponse,
  ProfileResponse,
  RevokeSessionResponse,
  SessionRevocationAction,
  SessionsResponse,
} from "./model";

export interface AccountDeps {
  prisma: PrismaClient;
}

export class AccountService {
  constructor(private readonly deps: AccountDeps) {}

  /**
   * Altera a senha do usuário após validar a senha atual via Argon2id.
   * Não altera nada no banco se a senha atual for incorreta.
   * Revoga as outras sessões na mesma transação da troca de senha (#192).
   * A sessão atual permanece ativa; revogação manual é realizada via revokeSession/revokeOtherSessions (#333).
   */
  async changePassword(
    userId: string,
    currentSessionId: string,
    body: ChangePasswordBody,
  ): Promise<ChangePasswordResponse> {
    const user = await this.deps.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true },
    });

    if (!user) {
      throw UserNotFound();
    }

    const isMatch = await verifyHash(user.passwordHash, body.currentPassword);
    if (!isMatch) {
      throw InvalidCurrentPassword();
    }

    const newHash = await hash(body.newPassword);
    const now = new Date();
    await this.deps.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: newHash },
      });
      await tx.session.updateMany({
        where: { userId, id: { not: currentSessionId }, revokedAt: null },
        data: { revokedAt: now },
      });
    });

    return { message: "Senha alterada com sucesso." };
  }

  /**
   * Lista apenas sessões ativas da própria conta (revokedAt = null e expiresAt > agora).
   * Identifica a sessão atual comparando session.id com currentSessionId.
   */
  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionsResponse> {
    const now = new Date();
    const sessions = await this.deps.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        lastActiveAt: true,
      },
      orderBy: { lastActiveAt: "desc" },
    });

    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        isCurrent: s.id === currentSessionId,
        ipAddress: safeSessionIpAddress(s.ipAddress),
        userAgent: summarizeUserAgent(s.userAgent),
        lastActiveAt: s.lastActiveAt.toISOString(),
      })),
    };
  }

  /**
   * Revoga uma sessão ativa específica da própria conta e registra auditoria na mesma transação.
   * Sessão inexistente, expirada, já revogada ou de outra conta retorna 404 NOT_FOUND sem gerar auditoria.
   */
  async revokeSession(
    userId: string,
    actorSessionId: string,
    targetSessionId: string,
  ): Promise<RevokeSessionResponse> {
    const action: SessionRevocationAction = "SINGLE";
    return this.deps.prisma.$transaction(async (tx) => {
      const now = new Date();
      const result = await tx.session.updateMany({
        where: {
          id: targetSessionId,
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
      if (result.count === 0) throw SessionNotFound();
      await tx.sessionRevocationAudit.create({
        data: {
          userId,
          actorSessionId,
          targetSessionId,
          action,
          revokedCount: result.count,
        },
      });
      return { revokedCount: result.count };
    });
  }

  /**
   * Revoga todas as outras sessões ativas da própria conta (preservando a atual)
   * e registra auditoria na mesma transação, inclusive quando nenhuma outra sessão estava ativa.
   */
  async revokeOtherSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<RevokeSessionResponse> {
    const action: SessionRevocationAction = "OTHER";
    return this.deps.prisma.$transaction(async (tx) => {
      const now = new Date();
      const result = await tx.session.updateMany({
        where: {
          userId,
          id: { not: currentSessionId },
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
      await tx.sessionRevocationAudit.create({
        data: {
          userId,
          actorSessionId: currentSessionId,
          action,
          revokedCount: result.count,
        },
      });
      return { revokedCount: result.count };
    });
  }

  async getProfile(userId: string): Promise<ProfileResponse> {
    const user = await this.deps.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true },
    });
    if (!user) {
      throw UserNotFound();
    }
    return user;
  }
}
