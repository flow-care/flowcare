import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { generateToken, hashToken } from "../../lib/tokens";
import { recordAuditEvent } from "../../services/audit-logger";
import { actionEmailHtml } from "../../services/mail-templates";
import type { Mailer } from "../../services/mailer";
import type { CreateInviteBody, InviteDetailsResponse } from "./model";

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class InviteService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      mailer: Mailer;
      webAppUrl: string;
    },
  ) {}

  async list(adminId: string, slug: string) {
    const organization = await this.authorizeAdmin(adminId, slug);
    const invites = await this.deps.prisma.organizationInvite.findMany({
      where: {
        organizationId: organization.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, email: true, role: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return {
      data: invites.map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
      })),
      roles: ["ADMIN", "PROFESSIONAL", "RECEPTIONIST"] as Array<
        "ADMIN" | "PROFESSIONAL" | "RECEPTIONIST"
      >,
    };
  }

  async create(adminId: string, slug: string, body: CreateInviteBody) {
    const organization = await this.authorizeAdmin(adminId, slug);
    const email = body.email.trim().toLowerCase();
    const existing = await this.deps.prisma.membership.findFirst({
      where: {
        organizationId: organization.id,
        user: { email },
        status: { in: ["ACTIVE", "INVITED"] },
      },
    });
    if (existing)
      throw new ApiError(
        "ALREADY_EXISTS",
        409,
        "Esta pessoa já está vinculada à clínica.",
      );
    const pending = await this.deps.prisma.organizationInvite.findFirst({
      where: {
        organizationId: organization.id,
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (pending)
      throw new ApiError(
        "ALREADY_EXISTS",
        409,
        "Já existe um convite pendente para este e-mail.",
      );
    const token = generateToken();
    const invite = await this.deps.prisma.organizationInvite.create({
      data: {
        organizationId: organization.id,
        email,
        role: body.role,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    });
    await recordAuditEvent(this.deps.prisma, {
      organizationId: organization.id,
      actorUserId: adminId,
      action: "TEAM_INVITE_CREATED",
      targetType: "ORGANIZATION_INVITE",
      targetId: invite.id,
      metadata: {
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
      },
    });
    await this.send(invite.email, organization.name, token);
    return {
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async getDetails(token: string): Promise<InviteDetailsResponse> {
    const includeOrg = {
      organization: {
        include: {
          owner: {
            select: { fullName: true },
          },
        },
      },
    } as const;
    let invite = await this.deps.prisma.organizationInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: includeOrg,
    });
    if (
      !invite &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        token,
      )
    ) {
      invite = await this.deps.prisma.organizationInvite.findUnique({
        where: { id: token },
        include: includeOrg,
      });
    }
    if (
      !invite ||
      invite.revokedAt ||
      invite.acceptedAt ||
      invite.expiresAt <= new Date()
    ) {
      throw new ApiError(
        "INVITE_EXPIRED",
        410,
        "Convite expirado ou inválido.",
      );
    }
    return {
      organizationName: invite.organization.name,
      organizationSlug: invite.organization.slug,
      inviterName: invite.organization.owner?.fullName ?? "Administrador",
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  async accept(userId: string, token: string) {
    const user = await this.deps.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user)
      throw new ApiError("UNAUTHENTICATED", 401, "Autenticação necessária.");
    const result = await this.deps.prisma.$transaction(async (tx) => {
      let invite = await tx.organizationInvite.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { organization: true },
      });
      if (
        !invite &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          token,
        )
      ) {
        invite = await tx.organizationInvite.findUnique({
          where: { id: token },
          include: { organization: true },
        });
      }
      if (
        !invite ||
        invite.revokedAt ||
        invite.acceptedAt ||
        invite.expiresAt <= new Date()
      )
        throw new ApiError(
          "INVITE_EXPIRED",
          410,
          "Convite expirado ou inválido.",
        );
      if (invite.email !== user.email.toLowerCase())
        throw new ApiError(
          "FORBIDDEN",
          403,
          "Este convite pertence a outro e-mail.",
        );
      await tx.organizationInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      await tx.membership.upsert({
        where: {
          userId_organizationId: {
            userId,
            organizationId: invite.organizationId,
          },
        },
        create: {
          userId,
          organizationId: invite.organizationId,
          role: invite.role,
          status: "ACTIVE",
        },
        update: { role: invite.role, status: "ACTIVE" },
      });
      await tx.onboardingProgress?.updateMany?.({
        where: {
          userId,
          completed: false,
          currentStep: { in: ["PROFILE_SETUP", "ORGANIZATION_SETUP"] },
        },
        data: {
          currentStep: "TEAM_INVITES",
          completed: true,
        },
      });
      await recordAuditEvent(tx, {
        organizationId: invite.organizationId,
        actorUserId: userId,
        action: "TEAM_INVITE_ACCEPTED",
        targetType: "ORGANIZATION_INVITE",
        targetId: invite.id,
        metadata: {
          email: invite.email,
          role: invite.role,
          status: "ACTIVE",
        },
      });
      return invite.organization.slug;
    });
    return { organizationSlug: result };
  }

  async decline(userId: string, token: string) {
    const user = await this.deps.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user)
      throw new ApiError("UNAUTHENTICATED", 401, "Autenticação necessária.");
    let invite = await this.deps.prisma.organizationInvite.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (
      !invite &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        token,
      )
    ) {
      invite = await this.deps.prisma.organizationInvite.findUnique({
        where: { id: token },
      });
    }
    if (
      !invite ||
      invite.revokedAt ||
      invite.acceptedAt ||
      invite.expiresAt <= new Date()
    )
      throw new ApiError(
        "INVITE_EXPIRED",
        410,
        "Convite expirado ou inválido.",
      );
    if (invite.email !== user.email.toLowerCase())
      throw new ApiError(
        "FORBIDDEN",
        403,
        "Este convite pertence a outro e-mail.",
      );
    await this.deps.prisma.organizationInvite.update({
      where: { id: invite.id },
      data: { revokedAt: new Date() },
    });
    await recordAuditEvent(this.deps.prisma, {
      organizationId: invite.organizationId,
      actorUserId: userId,
      action: "TEAM_INVITE_DECLINED",
      targetType: "ORGANIZATION_INVITE",
      targetId: invite.id,
      metadata: {
        email: invite.email,
        role: invite.role,
      },
    });
    return { message: "Convite recusado." };
  }

  async revoke(adminId: string, slug: string, inviteId: string) {
    const organization = await this.authorizeAdmin(adminId, slug);
    const result = await this.deps.prisma.organizationInvite.updateMany({
      where: {
        id: inviteId,
        organizationId: organization.id,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0)
      throw new ApiError("NOT_FOUND", 404, "Convite pendente não encontrado.");
    await recordAuditEvent(this.deps.prisma, {
      organizationId: organization.id,
      actorUserId: adminId,
      action: "TEAM_INVITE_REVOKED",
      targetType: "ORGANIZATION_INVITE",
      targetId: inviteId,
      metadata: {
        organizationId: organization.id,
      },
    });
    return { message: "Convite revogado." };
  }

  async resend(adminId: string, slug: string, inviteId: string) {
    const organization = await this.authorizeAdmin(adminId, slug);
    const current = await this.deps.prisma.organizationInvite.findFirst({
      where: {
        id: inviteId,
        organizationId: organization.id,
        acceptedAt: null,
        revokedAt: null,
      },
    });
    if (!current)
      throw new ApiError("NOT_FOUND", 404, "Convite pendente não encontrado.");
    const existingMember = await this.deps.prisma.membership.findFirst({
      where: {
        organizationId: organization.id,
        user: { email: current.email },
        status: { in: ["ACTIVE", "INVITED"] },
      },
    });
    if (existingMember)
      throw new ApiError(
        "ALREADY_EXISTS",
        409,
        "Esta pessoa já está vinculada à clínica.",
      );
    const token = generateToken();
    const updated = await this.deps.prisma.organizationInvite.updateMany({
      where: {
        id: current.id,
        organizationId: organization.id,
        tokenHash: current.tokenHash,
        acceptedAt: null,
        revokedAt: null,
      },
      data: {
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    });
    if (updated.count === 0)
      throw new ApiError("NOT_FOUND", 404, "Convite pendente não encontrado.");
    const invite = await this.deps.prisma.organizationInvite.findUniqueOrThrow({
      where: { id: current.id },
    });
    await recordAuditEvent(this.deps.prisma, {
      organizationId: organization.id,
      actorUserId: adminId,
      action: "TEAM_INVITE_RESENT",
      targetType: "ORGANIZATION_INVITE",
      targetId: invite.id,
      metadata: {
        email: invite.email,
        expiresAt: invite.expiresAt.toISOString(),
      },
    });
    await this.send(invite.email, organization.name, token);
    return {
      id: invite.id,
      email: invite.email,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  private async authorizeAdmin(userId: string, slug: string) {
    const membership = await this.deps.prisma.membership.findFirst({
      where: {
        userId,
        status: "ACTIVE",
        role: { in: ["ADMIN", "ADMIN_PROFESSIONAL"] },
        organization: { slug },
      },
      select: { organization: true },
    });
    if (!membership)
      throw new ApiError("FORBIDDEN", 403, "Permissão insuficiente.");
    return membership.organization;
  }

  private async send(to: string, organizationName: string, token: string) {
    try {
      await this.deps.mailer.send({
        to,
        subject: `Convite para ${organizationName}`,
        text: `Você foi convidado para ${organizationName}: ${this.deps.webAppUrl}/accept-invite/${token}`,
        html: actionEmailHtml({
          title: "Convite para clínica",
          description: `Você foi convidado para ${organizationName} no Flowcare.`,
          action: "Aceitar convite",
          url: `${this.deps.webAppUrl}/accept-invite/${token}`,
          expiry: "O convite expira em 7 dias e pode ser usado apenas uma vez.",
        }),
      });
    } catch {
      console.error("[invite] delivery failed");
      throw new ApiError(
        "EMAIL_DELIVERY_FAILED",
        503,
        "O convite foi preparado, mas o e-mail não pôde ser enviado. Reenvie o convite pendente.",
      );
    }
  }
}
