import type {
  PrismaClient,
  WhatsAppMessage,
  WhatsAppMessageType,
} from "../../generated/prisma/client";
import {
  WahaSendError,
  type WhatsAppProvider,
} from "../../services/waha-client";
import { hashProviderMessageId } from "./messages-service";
import type { WhatsAppTemplateType } from "./model";
import { normalizeWhatsAppDestination } from "./phone";
import { renderWhatsAppTemplate } from "./service";

const delays = [60_000, 300_000];

const templateTypeByMessage: Record<WhatsAppMessageType, WhatsAppTemplateType> =
  {
    APPOINTMENT_CREATED: "APPOINTMENT_CONFIRMATION",
    APPOINTMENT_CANCELLED: "APPOINTMENT_CANCELLATION",
    APPOINTMENT_REMINDER: "APPOINTMENT_REMINDER_24H",
  };

export class WhatsAppQueueWorker {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: WhatsAppProvider,
  ) {}

  async processBatch(limit = 20): Promise<number> {
    await this.prisma.whatsAppMessage.updateMany({
      where: {
        status: "QUEUED",
        leaseUntil: { lt: new Date() },
        uncertainAt: null,
      },
      data: {
        status: "UNCERTAIN",
        leaseUntil: null,
        uncertainAt: new Date(),
        errorCode: "PROVIDER_OUTCOME_UNKNOWN",
        errorReason: "Processamento interrompido; requer reconciliação.",
      },
    });
    const due = await this.prisma.whatsAppMessage.findMany({
      where: {
        status: "QUEUED",
        nextAttemptAt: { lte: new Date() },
        leaseUntil: null,
        uncertainAt: null,
      },
      orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    let processed = 0;
    for (const message of due) {
      const claimed = await this.prisma.whatsAppMessage.updateMany({
        where: {
          id: message.id,
          status: "QUEUED",
          leaseUntil: null,
          uncertainAt: null,
        },
        data: { leaseUntil: new Date(Date.now() + 60_000) },
      });
      if (claimed.count !== 1) continue;
      await this.process(message);
      processed += 1;
    }
    return processed;
  }

  private async process(message: WhatsAppMessage) {
    const [preference, appointment, session] = await Promise.all([
      this.prisma.whatsAppPreference.findFirst({
        where: {
          organizationId: message.organizationId,
          patientId: message.patientId,
          optedIn: true,
        },
      }),
      this.prisma.appointment.findFirst({
        where: {
          id: message.appointmentId,
          organizationId: message.organizationId,
        },
        include: {
          patient: { select: { fullName: true, phone: true } },
          organization: { select: { name: true, timezone: true } },
          professional: { select: { fullName: true } },
        },
      }),
      this.prisma.whatsAppSession.findUnique({
        where: { organizationId: message.organizationId },
        select: { providerSessionName: true },
      }),
    ]);
    const version = Number(message.eventId.split(":").at(-1));
    const validState =
      appointment &&
      appointment.version === version &&
      (message.type === "APPOINTMENT_CANCELLED"
        ? appointment.status === "CANCELLED"
        : appointment.status === "RESERVED" ||
          appointment.status === "CONFIRMED");
    const destination = appointment
      ? normalizeWhatsAppDestination(appointment.patient.phone)
      : null;
    if (!preference || !validState || !destination) {
      await this.fail(
        message.id,
        "NOT_ELIGIBLE",
        "Mensagem não elegível para envio.",
      );
      return;
    }

    const templateType = templateTypeByMessage[message.type];
    const templateVersion = await this.resolveTemplateVersion(
      message,
      templateType,
    );
    if (!templateVersion) {
      await this.fail(
        message.id,
        "TEMPLATE_NOT_CONFIGURED",
        "Não há template ativo para este tipo de mensagem.",
      );
      return;
    }

    if (!session || !this.provider.sendText) {
      await this.release(message.id, 60_000);
      return;
    }
    let connected: boolean;
    try {
      connected =
        (await this.provider.getSession(session.providerSessionName))
          ?.status === "WORKING";
    } catch {
      connected = false;
    }
    if (!connected) {
      await this.release(message.id, 60_000);
      return;
    }

    const formatterOptions = {
      timeZone: appointment.organization.timezone,
    } satisfies Intl.DateTimeFormatOptions;
    let text: string;
    try {
      text = renderWhatsAppTemplate(templateType, templateVersion.content, {
        paciente_nome: appointment.patient.fullName,
        data: new Intl.DateTimeFormat("pt-BR", {
          ...formatterOptions,
          dateStyle: "short",
        }).format(appointment.scheduledAt),
        hora: new Intl.DateTimeFormat("pt-BR", {
          ...formatterOptions,
          timeStyle: "short",
        }).format(appointment.scheduledAt),
        medico_nome: appointment.professional.fullName,
        clinica_nome: appointment.organization.name,
      });
    } catch {
      await this.fail(
        message.id,
        "TEMPLATE_INVALID",
        "O template vinculado não pode ser renderizado.",
      );
      return;
    }

    const attemptNumber = message.attemptCount + 1;
    const attempt = await this.prisma.whatsAppMessageAttempt.create({
      data: { messageId: message.id, number: attemptNumber },
    });
    let providerMessageHash: string | null = null;
    try {
      const providerMessageId = await this.provider.sendText(
        session.providerSessionName,
        destination.chatId,
        text,
      );
      providerMessageHash = hashProviderMessageId(providerMessageId);
      await this.prisma.$transaction(async (tx) => {
        await tx.whatsAppMessageAttempt.update({
          where: { id: attempt.id },
          data: { completedAt: new Date(), providerMessageHash },
        });
        await tx.whatsAppMessage.update({
          where: { id: message.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            providerMessageHash,
            attemptCount: attemptNumber,
            leaseUntil: null,
            uncertainAt: null,
            errorCode: null,
            errorReason: null,
          },
        });
      });
    } catch (error) {
      const sendError =
        error instanceof WahaSendError
          ? error
          : new WahaSendError("uncertain", "PROVIDER_OUTCOME_UNKNOWN");
      const reason =
        sendError.outcome === "uncertain"
          ? "Resultado do provedor desconhecido; requer reconciliação."
          : sendError.outcome === "temporary"
            ? "Falha temporária do provedor."
            : "Envio recusado pelo provedor.";
      await this.prisma.$transaction(async (tx) => {
        await tx.whatsAppMessageAttempt.update({
          where: { id: attempt.id },
          data: {
            completedAt: new Date(),
            providerMessageHash,
            errorCode: sendError.code,
            errorReason: reason,
          },
        });
        await tx.whatsAppMessage.update({
          where: { id: message.id },
          data: {
            attemptCount: attemptNumber,
            leaseUntil: null,
            providerMessageHash,
            errorCode: sendError.code,
            errorReason: reason,
            ...(sendError.outcome === "uncertain"
              ? { status: "UNCERTAIN", uncertainAt: new Date() }
              : sendError.outcome === "permanent" || attemptNumber >= 3
                ? { status: "FAILED", uncertainAt: null }
                : {
                    nextAttemptAt: new Date(
                      Date.now() + (delays[attemptNumber - 1] ?? 300_000),
                    ),
                  }),
          },
        });
      });
    }
  }

  private async resolveTemplateVersion(
    message: WhatsAppMessage,
    templateType: WhatsAppTemplateType,
  ) {
    if (message.templateVersionId) {
      return this.prisma.whatsAppTemplateVersion.findFirst({
        where: {
          id: message.templateVersionId,
          template: {
            organizationId: message.organizationId,
            type: templateType,
          },
        },
        select: { id: true, content: true },
      });
    }

    const template = await this.prisma.whatsAppTemplate.findUnique({
      where: {
        organizationId_type: {
          organizationId: message.organizationId,
          type: templateType,
        },
      },
      select: { id: true, version: true },
    });
    if (!template) return null;

    const currentVersion = await this.prisma.whatsAppTemplateVersion.findUnique(
      {
        where: {
          templateId_version: {
            templateId: template.id,
            version: template.version,
          },
        },
        select: { id: true, content: true },
      },
    );
    if (!currentVersion) return null;

    await this.prisma.whatsAppMessage.updateMany({
      where: { id: message.id, templateVersionId: null },
      data: { templateVersionId: currentVersion.id },
    });
    return currentVersion;
  }

  private async fail(id: string, code: string, reason: string) {
    await this.prisma.whatsAppMessage.update({
      where: { id },
      data: {
        status: "FAILED",
        leaseUntil: null,
        uncertainAt: null,
        errorCode: code,
        errorReason: reason,
      },
    });
  }

  private async release(id: string, delay: number) {
    await this.prisma.whatsAppMessage.update({
      where: { id },
      data: { leaseUntil: null, nextAttemptAt: new Date(Date.now() + delay) },
    });
  }
}
