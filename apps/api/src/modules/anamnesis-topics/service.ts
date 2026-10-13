import type { PrismaClient } from "../../generated/prisma/client";
import { ApiError } from "../../lib/api-error";
import { recordAuditEvent } from "../../services/audit-logger";
import type { PutTopicsBody, TopicOutput } from "./model";

const denied = () =>
  new ApiError(
    "PERMISSION_DENIED",
    403,
    "Configuração disponível apenas ao próprio profissional.",
  );
const conflict = () =>
  new ApiError(
    "VERSION_CONFLICT",
    409,
    "A configuração foi alterada. Recarregue e tente novamente.",
  );
const invalid = (message: string) =>
  new ApiError("VALIDATION_ERROR", 400, message);

export class AnamnesisTopicsService {
  constructor(private readonly prisma: PrismaClient) {}

  private authorize(userId: string, professionalId: string, role: string) {
    if (
      userId !== professionalId ||
      !["PROFESSIONAL", "ADMIN_PROFESSIONAL"].includes(role)
    )
      throw denied();
  }

  async get(
    organizationId: string,
    userId: string,
    professionalId: string,
    role: string,
  ) {
    this.authorize(userId, professionalId, role);
    const config = await this.prisma.anamnesisTopicConfig.findUnique({
      where: {
        organizationId_professionalId: { organizationId, professionalId },
      },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const revision = config?.revisions[0];
    return {
      professionalId,
      version: config?.version ?? 0,
      revisionId: revision?.id ?? null,
      topics: (revision?.topics ?? []) as TopicOutput[],
    };
  }

  // The consultation module must retain this revision id when it creates an
  // anamnesis; revisions are never updated after creation.
  async currentRevisionForNewAnamnesis(
    organizationId: string,
    professionalId: string,
  ) {
    const config = await this.prisma.anamnesisTopicConfig.findUnique({
      where: {
        organizationId_professionalId: { organizationId, professionalId },
      },
      include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
    });
    return config?.revisions[0] ?? null;
  }

  async put(
    organizationId: string,
    userId: string,
    professionalId: string,
    role: string,
    body: PutTopicsBody,
  ) {
    this.authorize(userId, professionalId, role);
    const keys = body.topics.map((topic) => topic.key);
    if (new Set(keys).size !== keys.length)
      throw invalid("Tópicos duplicados.");
    const proposed = body.topics.map((topic, order) => ({
      key: topic.key,
      label: topic.label.trim(),
      active: topic.active,
      required: false,
      order,
    }));
    if (proposed.some((topic) => !topic.label))
      throw invalid("Título do tópico obrigatório.");

    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.anamnesisTopicConfig.findUnique({
          where: {
            organizationId_professionalId: { organizationId, professionalId },
          },
          include: { revisions: { orderBy: { version: "desc" }, take: 1 } },
        });
        if ((current?.version ?? 0) !== body.version) throw conflict();
        const existing = (current?.revisions[0]?.topics ?? []) as TopicOutput[];
        for (const topic of existing.filter((topic) => topic.required)) {
          const replacement = proposed.find((item) => item.key === topic.key);
          if (!replacement || !replacement.active)
            throw invalid(
              "Tópico obrigatório não pode ser removido ou desativado.",
            );
          replacement.required = true;
        }
        const version = body.version + 1;
        let configId: string;
        if (current) {
          const changed = await tx.anamnesisTopicConfig.updateMany({
            where: { id: current.id, version: body.version },
            data: { version },
          });
          if (changed.count !== 1) throw conflict();
          configId = current.id;
        } else {
          const created = await tx.anamnesisTopicConfig.create({
            data: { organizationId, professionalId, version },
          });
          configId = created.id;
        }
        const revision = await tx.anamnesisTopicRevision.create({
          data: { configId, version, topics: proposed },
        });
        await recordAuditEvent(tx, {
          organizationId,
          actorUserId: userId,
          action: "ANAMNESIS_TOPICS_UPDATED",
          targetType: "ANAMNESIS_TOPIC_CONFIG",
          targetId: configId,
          metadata: {
            professionalId,
            revisionId: revision.id,
            version,
            topicKeys: proposed.map((topic) => topic.key),
            activeCount: proposed.filter((topic) => topic.active).length,
          },
        });
        return {
          professionalId,
          version,
          revisionId: revision.id,
          topics: proposed,
        };
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // A unique constraint or serializable transaction race means another
      // writer won the same expected version.
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        ["P2002", "P2034"].includes(String(error.code))
      )
        throw conflict();
      throw error;
    }
  }
}
