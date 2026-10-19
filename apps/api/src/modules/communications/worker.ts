import type {
  Prisma,
  PrismaClient,
  WhatsAppMessage,
  WhatsAppMessageStatus,
  WhatsAppMessageType,
} from "../../generated/prisma/client";
import {
  WahaSendError,
  type WhatsAppProvider,
} from "../../services/waha-client";
import { resolveWhatsAppDeliveryEligibility } from "./delivery-eligibility";
import {
  hashProviderMessageId,
  lockWhatsAppProviderMessage,
  reconcileWhatsAppWebhookEvents,
} from "./messages-service";
import type { WhatsAppTemplateType } from "./model";
import { renderWhatsAppTemplate } from "./service";

const delays = [60_000, 300_000];
const leaseDurationMs = 60_000;

type ManualAttempt = {
  id: string;
  organizationId: string | null;
  messageId: string;
  number: number;
  startedAt: Date;
  dispatchedAt: Date | null;
  completedAt: Date | null;
};

type LockedRow = { id: string };

type ManualDispatchAuthorization =
  | { kind: "DISPATCH"; chatId: string; text: string }
  | { kind: "HANDLED" };

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
    const recoveryTime = new Date();
    // A MANUAL attempt without a dispatch fence has provably not reached WAHA,
    // so an expired owner may be released safely. Once dispatchedAt exists,
    // the outcome is ambiguous and the generic recovery below must stop it.
    await this.prisma.whatsAppMessage.updateMany({
      where: {
        status: "QUEUED",
        leaseUntil: { lt: recoveryTime },
        uncertainAt: null,
        AND: [
          {
            scopedAttempts: {
              some: {
                origin: "MANUAL",
                completedAt: null,
                dispatchedAt: null,
              },
            },
          },
          {
            scopedAttempts: {
              none: {
                origin: "MANUAL",
                completedAt: null,
                dispatchedAt: { not: null },
              },
            },
          },
        ],
      },
      data: { leaseUntil: null },
    });
    await this.prisma.whatsAppMessage.updateMany({
      where: {
        status: "QUEUED",
        leaseUntil: { lt: recoveryTime },
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
      const leaseUntil = new Date(Date.now() + leaseDurationMs);
      const claimed = await this.prisma.whatsAppMessage.updateMany({
        where: {
          id: message.id,
          organizationId: message.organizationId,
          status: "QUEUED",
          leaseUntil: null,
          uncertainAt: null,
        },
        data: { leaseUntil },
      });
      if (claimed.count !== 1) continue;
      await this.process(message, leaseUntil);
      processed += 1;
    }
    return processed;
  }

  private async process(message: WhatsAppMessage, leaseUntil: Date) {
    const manualAttempt = await this.findPendingManualAttempt(message);
    if (manualAttempt?.dispatchedAt) {
      await this.markDispatchedManualAttemptUncertain(
        message,
        manualAttempt,
        leaseUntil,
      );
      return;
    }

    const [eligibility, session] = await Promise.all([
      this.resolveDeliveryEligibility(message),
      this.prisma.whatsAppSession.findUnique({
        where: { organizationId: message.organizationId },
        select: { providerSessionName: true },
      }),
    ]);
    if (!eligibility) {
      if (manualAttempt)
        await this.failManualAttemptBeforeDispatch(
          message,
          manualAttempt,
          leaseUntil,
          "NOT_ELIGIBLE",
          "Mensagem não elegível para envio.",
        );
      else
        await this.fail(
          message.id,
          "NOT_ELIGIBLE",
          "Mensagem não elegível para envio.",
        );
      return;
    }
    const { appointment } = eligibility;

    const templateType = templateTypeByMessage[message.type];
    const templateVersion = await this.resolveTemplateVersion(
      message,
      templateType,
    );
    if (!templateVersion) {
      if (manualAttempt)
        await this.failManualAttemptBeforeDispatch(
          message,
          manualAttempt,
          leaseUntil,
          "TEMPLATE_NOT_CONFIGURED",
          "Não há template ativo para este tipo de mensagem.",
        );
      else
        await this.fail(
          message.id,
          "TEMPLATE_NOT_CONFIGURED",
          "Não há template ativo para este tipo de mensagem.",
        );
      return;
    }

    const sendText = this.provider.sendText?.bind(this.provider);
    if (!session || !sendText) {
      if (manualAttempt)
        await this.releaseManualClaim(message, leaseUntil, leaseDurationMs);
      else await this.release(message.id, leaseDurationMs);
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
      if (manualAttempt)
        await this.releaseManualClaim(message, leaseUntil, leaseDurationMs);
      else await this.release(message.id, leaseDurationMs);
      return;
    }

    if (manualAttempt) {
      await this.processManualAttempt(
        message,
        manualAttempt,
        leaseUntil,
        session.providerSessionName,
        templateType,
        templateVersion.content,
        sendText,
      );
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
    // Narrows the TOCTOU window, but a database read cannot make the following
    // external provider call atomic with consent or appointment updates.
    const currentEligibility = await this.resolveDeliveryEligibility(message);
    if (!currentEligibility) {
      await this.failAttempt(
        message.id,
        attempt.id,
        attemptNumber,
        "NOT_ELIGIBLE",
        "Mensagem não elegível para envio.",
      );
      return;
    }
    let providerMessageHash: string | null = null;
    try {
      const providerMessageId = await sendText(
        session.providerSessionName,
        currentEligibility.destination.chatId,
        text,
      );
      providerMessageHash = hashProviderMessageId(providerMessageId);
      await this.prisma.$transaction(async (tx) => {
        await lockWhatsAppProviderMessage(
          tx,
          message.organizationId,
          providerMessageHash as string,
        );
        const sentAt = new Date();
        await tx.whatsAppMessageAttempt.update({
          where: { id: attempt.id },
          data: { completedAt: new Date(), providerMessageHash },
        });
        await tx.whatsAppMessage.update({
          where: { id: message.id },
          data: {
            status: "SENT",
            sentAt,
            providerMessageHash,
            attemptCount: attemptNumber,
            leaseUntil: null,
            uncertainAt: null,
            errorCode: null,
            errorReason: null,
          },
        });
        await reconcileWhatsAppWebhookEvents(
          tx,
          message.organizationId,
          providerMessageHash as string,
          { id: message.id, status: "SENT", sentAt },
        );
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
      const nextStatus: WhatsAppMessageStatus =
        sendError.outcome === "uncertain"
          ? "UNCERTAIN"
          : sendError.outcome === "permanent" || attemptNumber >= 3
            ? "FAILED"
            : "QUEUED";
      const persistedSentAt = providerMessageHash ? new Date() : null;
      await this.prisma.$transaction(async (tx) => {
        if (providerMessageHash)
          await lockWhatsAppProviderMessage(
            tx,
            message.organizationId,
            providerMessageHash,
          );
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
            status: nextStatus,
            attemptCount: attemptNumber,
            leaseUntil: null,
            providerMessageHash,
            ...(persistedSentAt ? { sentAt: persistedSentAt } : {}),
            errorCode: sendError.code,
            errorReason: reason,
            ...(sendError.outcome === "uncertain"
              ? { uncertainAt: new Date() }
              : sendError.outcome === "permanent" || attemptNumber >= 3
                ? { uncertainAt: null }
                : {
                    uncertainAt: null,
                    nextAttemptAt: new Date(
                      Date.now() + (delays[attemptNumber - 1] ?? 300_000),
                    ),
                  }),
          },
        });
        if (providerMessageHash)
          await reconcileWhatsAppWebhookEvents(
            tx,
            message.organizationId,
            providerMessageHash,
            {
              id: message.id,
              status: nextStatus,
              sentAt: persistedSentAt,
            },
          );
      });
    }
  }

  private async findPendingManualAttempt(
    message: WhatsAppMessage,
  ): Promise<ManualAttempt | null> {
    return this.prisma.whatsAppMessageAttempt.findFirst({
      where: {
        organizationId: message.organizationId,
        messageId: message.id,
        origin: "MANUAL",
        completedAt: null,
        number: { gt: message.attemptCount },
      },
      orderBy: { number: "desc" },
      select: {
        id: true,
        organizationId: true,
        messageId: true,
        number: true,
        startedAt: true,
        dispatchedAt: true,
        completedAt: true,
      },
    });
  }

  private async processManualAttempt(
    message: WhatsAppMessage,
    attempt: ManualAttempt,
    leaseUntil: Date,
    providerSessionName: string,
    templateType: WhatsAppTemplateType,
    templateContent: string,
    sendText: (
      session: string,
      chatId: string,
      text: string,
    ) => Promise<string>,
  ) {
    // If this transaction has an ambiguous commit, its caller must not infer
    // that the fence is absent. The exception escapes and WAHA is not called;
    // lease recovery will inspect the durable dispatchedAt value later.
    const authorization = await this.authorizeManualDispatch(
      message,
      attempt,
      leaseUntil,
      templateType,
      templateContent,
    );
    if (authorization.kind !== "DISPATCH") return;

    let providerMessageHash: string | null = null;
    try {
      const providerMessageId = await sendText(
        providerSessionName,
        authorization.chatId,
        authorization.text,
      );
      providerMessageHash = hashProviderMessageId(providerMessageId);
      await this.persistManualAttemptResult(message, attempt, {
        status: "SENT",
        providerMessageHash,
        sentAt: new Date(),
        errorCode: null,
        errorReason: null,
      });
    } catch (error) {
      const sendError =
        error instanceof WahaSendError
          ? error
          : new WahaSendError("uncertain", "PROVIDER_OUTCOME_UNKNOWN");
      const isUncertain = sendError.outcome === "uncertain";
      const reason = isUncertain
        ? "Resultado do provedor desconhecido; requer reconciliação."
        : sendError.outcome === "temporary"
          ? "Falha temporária do provedor; nova autorização manual é necessária."
          : "Envio recusado pelo provedor.";
      await this.persistManualAttemptResult(message, attempt, {
        status: isUncertain ? "UNCERTAIN" : "FAILED",
        providerMessageHash,
        sentAt: providerMessageHash ? new Date() : null,
        errorCode: sendError.code,
        errorReason: reason,
      });
    }
  }

  private async authorizeManualDispatch(
    message: WhatsAppMessage,
    attempt: ManualAttempt,
    leaseUntil: Date,
    templateType: WhatsAppTemplateType,
    templateContent: string,
  ): Promise<ManualDispatchAuthorization> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockManualEligibilityRows(tx, message);
      if (!(await this.lockMessage(tx, message.organizationId, message.id)))
        return { kind: "HANDLED" };

      const currentMessage = await tx.whatsAppMessage.findFirst({
        where: { id: message.id, organizationId: message.organizationId },
        select: {
          id: true,
          organizationId: true,
          patientId: true,
          appointmentId: true,
          eventId: true,
          type: true,
          status: true,
          attemptCount: true,
          leaseUntil: true,
          uncertainAt: true,
        },
      });
      if (
        !currentMessage ||
        currentMessage.status !== "QUEUED" ||
        currentMessage.uncertainAt !== null ||
        !this.ownsLease(currentMessage.leaseUntil, leaseUntil)
      )
        return { kind: "HANDLED" };

      const currentAttempt = await tx.whatsAppMessageAttempt.findFirst({
        where: {
          id: attempt.id,
          organizationId: message.organizationId,
          messageId: message.id,
          number: attempt.number,
          origin: "MANUAL",
          completedAt: null,
        },
        select: {
          id: true,
          organizationId: true,
          messageId: true,
          number: true,
          startedAt: true,
          dispatchedAt: true,
          completedAt: true,
        },
      });
      if (!currentAttempt || currentAttempt.dispatchedAt)
        return { kind: "HANDLED" };

      const eligibility = await resolveWhatsAppDeliveryEligibility(
        tx,
        currentMessage,
        new Date(),
      );
      if (!eligibility) {
        await this.finalizeManualAttemptBeforeDispatch(
          tx,
          currentMessage,
          currentAttempt,
          leaseUntil,
          "NOT_ELIGIBLE",
          "Mensagem não elegível para envio.",
        );
        return { kind: "HANDLED" };
      }

      const { appointment, destination } = eligibility;
      const formatterOptions = {
        timeZone: appointment.organization.timezone,
      } satisfies Intl.DateTimeFormatOptions;
      let text: string;
      try {
        text = renderWhatsAppTemplate(templateType, templateContent, {
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
        await this.finalizeManualAttemptBeforeDispatch(
          tx,
          currentMessage,
          currentAttempt,
          leaseUntil,
          "TEMPLATE_INVALID",
          "O template vinculado não pode ser renderizado.",
        );
        return { kind: "HANDLED" };
      }

      const dispatchedAt = new Date(
        Math.max(Date.now(), currentAttempt.startedAt.getTime()),
      );
      const fenced = await tx.whatsAppMessageAttempt.updateMany({
        where: {
          id: currentAttempt.id,
          organizationId: currentMessage.organizationId,
          messageId: currentMessage.id,
          number: currentAttempt.number,
          origin: "MANUAL",
          dispatchedAt: null,
          completedAt: null,
        },
        data: { dispatchedAt },
      });
      if (fenced.count !== 1) return { kind: "HANDLED" };

      const stillOwned = await tx.whatsAppMessage.updateMany({
        where: {
          id: currentMessage.id,
          organizationId: currentMessage.organizationId,
          status: "QUEUED",
          leaseUntil,
          uncertainAt: null,
        },
        data: {
          // The message-level hash follows the active attempt. Historical ACKs
          // remain correlated through their own attempt rows.
          providerMessageHash: null,
          errorCode: null,
          errorReason: null,
        },
      });
      if (stillOwned.count !== 1)
        throw new Error("Manual dispatch ownership changed.");

      attempt.dispatchedAt = dispatchedAt;
      return { kind: "DISPATCH", chatId: destination.chatId, text };
    });
  }

  private async persistManualAttemptResult(
    message: WhatsAppMessage,
    attempt: ManualAttempt,
    result: {
      status: "SENT" | "UNCERTAIN" | "FAILED";
      providerMessageHash: string | null;
      sentAt: Date | null;
      errorCode: string | null;
      errorReason: string | null;
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      if (result.providerMessageHash)
        await lockWhatsAppProviderMessage(
          tx,
          message.organizationId,
          result.providerMessageHash,
        );

      const completedAt = new Date(
        Math.max(
          Date.now(),
          attempt.startedAt.getTime(),
          attempt.dispatchedAt?.getTime() ?? 0,
        ),
      );
      const completed = await tx.whatsAppMessageAttempt.updateMany({
        where: {
          id: attempt.id,
          organizationId: message.organizationId,
          messageId: message.id,
          number: attempt.number,
          origin: "MANUAL",
          dispatchedAt: { not: null },
          completedAt: null,
        },
        data: {
          completedAt,
          providerMessageHash: result.providerMessageHash,
          errorCode: result.errorCode,
          errorReason: result.errorReason,
        },
      });
      // A committed result may be observed after a connection-level commit
      // ambiguity. Never overwrite it with a second, more pessimistic result.
      if (completed.count !== 1) return;

      const updated = await tx.whatsAppMessage.updateMany({
        where: { id: message.id, organizationId: message.organizationId },
        data: {
          status: result.status,
          attemptCount: attempt.number,
          leaseUntil: null,
          providerMessageHash: result.providerMessageHash,
          ...(result.sentAt ? { sentAt: result.sentAt } : {}),
          uncertainAt: result.status === "UNCERTAIN" ? new Date() : null,
          errorCode: result.errorCode,
          errorReason: result.errorReason,
        },
      });
      if (updated.count !== 1)
        throw new Error("Manual dispatch result lost its message.");

      if (result.providerMessageHash)
        await reconcileWhatsAppWebhookEvents(
          tx,
          message.organizationId,
          result.providerMessageHash,
          {
            id: message.id,
            status: result.status,
            sentAt: result.sentAt,
          },
        );
    });
  }

  private async failManualAttemptBeforeDispatch(
    message: WhatsAppMessage,
    attempt: ManualAttempt,
    leaseUntil: Date,
    code: string,
    reason: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockMessage(tx, message.organizationId, message.id)))
        return;
      const currentMessage = await tx.whatsAppMessage.findFirst({
        where: { id: message.id, organizationId: message.organizationId },
        select: {
          id: true,
          organizationId: true,
          status: true,
          leaseUntil: true,
          uncertainAt: true,
        },
      });
      if (
        !currentMessage ||
        currentMessage.status !== "QUEUED" ||
        currentMessage.uncertainAt !== null ||
        !this.ownsLease(currentMessage.leaseUntil, leaseUntil)
      )
        return;

      const currentAttempt = await tx.whatsAppMessageAttempt.findFirst({
        where: {
          id: attempt.id,
          organizationId: message.organizationId,
          messageId: message.id,
          number: attempt.number,
          origin: "MANUAL",
          dispatchedAt: null,
          completedAt: null,
        },
        select: {
          id: true,
          organizationId: true,
          messageId: true,
          number: true,
          startedAt: true,
          dispatchedAt: true,
          completedAt: true,
        },
      });
      if (!currentAttempt) return;
      await this.finalizeManualAttemptBeforeDispatch(
        tx,
        currentMessage,
        currentAttempt,
        leaseUntil,
        code,
        reason,
      );
    });
  }

  private async finalizeManualAttemptBeforeDispatch(
    tx: Prisma.TransactionClient,
    message: {
      id: string;
      organizationId: string;
      status: WhatsAppMessageStatus;
      leaseUntil: Date | null;
      uncertainAt: Date | null;
    },
    attempt: ManualAttempt,
    leaseUntil: Date,
    code: string,
    reason: string,
  ) {
    const completedAt = new Date(
      Math.max(Date.now(), attempt.startedAt.getTime()),
    );
    const completed = await tx.whatsAppMessageAttempt.updateMany({
      where: {
        id: attempt.id,
        organizationId: message.organizationId,
        messageId: message.id,
        number: attempt.number,
        origin: "MANUAL",
        dispatchedAt: null,
        completedAt: null,
      },
      data: { completedAt, errorCode: code, errorReason: reason },
    });
    if (completed.count !== 1) return;

    const failed = await tx.whatsAppMessage.updateMany({
      where: {
        id: message.id,
        organizationId: message.organizationId,
        status: "QUEUED",
        leaseUntil,
        uncertainAt: null,
      },
      data: {
        status: "FAILED",
        attemptCount: attempt.number,
        leaseUntil: null,
        uncertainAt: null,
        errorCode: code,
        errorReason: reason,
      },
    });
    if (failed.count !== 1)
      throw new Error("Manual attempt finalization lost its message.");
  }

  private async markDispatchedManualAttemptUncertain(
    message: WhatsAppMessage,
    attempt: ManualAttempt,
    leaseUntil: Date,
  ) {
    await this.prisma.$transaction(async (tx) => {
      if (!(await this.lockMessage(tx, message.organizationId, message.id)))
        return;
      const currentAttempt = await tx.whatsAppMessageAttempt.findFirst({
        where: {
          id: attempt.id,
          organizationId: message.organizationId,
          messageId: message.id,
          number: attempt.number,
          origin: "MANUAL",
          completedAt: null,
          dispatchedAt: { not: null },
        },
        select: { id: true },
      });
      if (!currentAttempt) return;
      await tx.whatsAppMessage.updateMany({
        where: {
          id: message.id,
          organizationId: message.organizationId,
          status: "QUEUED",
          leaseUntil,
          uncertainAt: null,
        },
        data: {
          status: "UNCERTAIN",
          leaseUntil: null,
          uncertainAt: new Date(),
          errorCode: "PROVIDER_OUTCOME_UNKNOWN",
          errorReason:
            "Despacho manual já autorizado; resultado requer reconciliação.",
        },
      });
    });
  }

  private async releaseManualClaim(
    message: WhatsAppMessage,
    leaseUntil: Date,
    delay: number,
  ) {
    await this.prisma.whatsAppMessage.updateMany({
      where: {
        id: message.id,
        organizationId: message.organizationId,
        status: "QUEUED",
        leaseUntil,
        uncertainAt: null,
      },
      data: {
        leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + delay),
      },
    });
  }

  private async lockManualEligibilityRows(
    tx: Prisma.TransactionClient,
    message: WhatsAppMessage,
  ) {
    await tx.$queryRaw<LockedRow[]>`
      SELECT preference."id"
      FROM "WhatsAppPreference" AS preference
      JOIN "Appointment" AS appointment
        ON appointment."id" = ${message.appointmentId}::uuid
       AND appointment."organizationId" = ${message.organizationId}::uuid
       AND appointment."patientId" = ${message.patientId}::uuid
      JOIN "Patient" AS patient
        ON patient."id" = appointment."patientId"
       AND patient."organizationId" = appointment."organizationId"
      WHERE preference."organizationId" = ${message.organizationId}::uuid
        AND preference."patientId" = ${message.patientId}::uuid
      FOR SHARE OF preference, appointment, patient
    `;
  }

  private async lockMessage(
    tx: Prisma.TransactionClient,
    organizationId: string,
    messageId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT "id"
      FROM "WhatsAppMessage"
      WHERE "organizationId" = ${organizationId}::uuid
        AND "id" = ${messageId}::uuid
      FOR UPDATE
    `;
    return rows.length === 1;
  }

  private ownsLease(current: Date | null, expected: Date): boolean {
    return current?.getTime() === expected.getTime();
  }

  private async resolveDeliveryEligibility(message: WhatsAppMessage) {
    return resolveWhatsAppDeliveryEligibility(this.prisma, message);
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

  private async failAttempt(
    messageId: string,
    attemptId: string,
    attemptNumber: number,
    code: string,
    reason: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const completedAt = new Date();
      await tx.whatsAppMessageAttempt.update({
        where: { id: attemptId },
        data: { completedAt, errorCode: code, errorReason: reason },
      });
      await tx.whatsAppMessage.update({
        where: { id: messageId },
        data: {
          status: "FAILED",
          attemptCount: attemptNumber,
          leaseUntil: null,
          uncertainAt: null,
          errorCode: code,
          errorReason: reason,
        },
      });
    });
  }

  private async release(id: string, delay: number) {
    await this.prisma.whatsAppMessage.update({
      where: { id },
      data: { leaseUntil: null, nextAttemptAt: new Date(Date.now() + delay) },
    });
  }
}
