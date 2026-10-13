import type {
  PrismaClient,
  WhatsAppMessage,
} from "../../generated/prisma/client";
import {
  WahaSendError,
  type WhatsAppProvider,
} from "../../services/waha-client";
import { hashProviderMessageId } from "./messages-service";

const delays = [60_000, 300_000];

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
    const digits = appointment?.patient.phone.replace(/\D/g, "") ?? "";
    if (!preference || !validState || !/^\d{10,13}$/.test(digits)) {
      await this.fail(
        message.id,
        "NOT_ELIGIBLE",
        "Mensagem não elegível para envio.",
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
    const attemptNumber = message.attemptCount + 1;
    const attempt = await this.prisma.whatsAppMessageAttempt.create({
      data: { messageId: message.id, number: attemptNumber },
    });
    const date = new Intl.DateTimeFormat("pt-BR", {
      timeZone: appointment.organization.timezone,
      dateStyle: "short",
      timeStyle: "short",
    }).format(appointment.scheduledAt);
    const text =
      message.type === "APPOINTMENT_CANCELLED"
        ? `${appointment.organization.name}: o agendamento de ${appointment.patient.fullName} em ${date} foi cancelado. Para interromper contatos, avise a clínica.`
        : message.type === "APPOINTMENT_REMINDER"
          ? `${appointment.organization.name}: lembrete do agendamento de ${appointment.patient.fullName} em ${date} com ${appointment.professional.fullName}. Para interromper contatos, avise a clínica.`
          : `${appointment.organization.name}: agendamento de ${appointment.patient.fullName} confirmado para ${date} com ${appointment.professional.fullName}. Para interromper contatos, avise a clínica.`;
    const chatId = `${digits.startsWith("55") ? digits : `55${digits}`}@c.us`;
    try {
      const providerMessageId = await this.provider.sendText(
        session.providerSessionName,
        chatId,
        text,
      );
      const providerMessageHash = hashProviderMessageId(providerMessageId);
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
            errorCode: sendError.code,
            errorReason: reason,
          },
        });
        await tx.whatsAppMessage.update({
          where: { id: message.id },
          data: {
            attemptCount: attemptNumber,
            leaseUntil: null,
            errorCode: sendError.code,
            errorReason: reason,
            ...(sendError.outcome === "uncertain"
              ? { uncertainAt: new Date() }
              : sendError.outcome === "permanent" || attemptNumber >= 3
                ? { status: "FAILED" }
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

  private async fail(id: string, code: string, reason: string) {
    await this.prisma.whatsAppMessage.update({
      where: { id },
      data: {
        status: "FAILED",
        leaseUntil: null,
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
