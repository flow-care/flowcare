import { describe, expect, test } from "bun:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { AnamnesisTopicsService } from "../src/modules/anamnesis-topics/service";

const org = "11111111-1111-4111-8111-111111111111";
const professional = "22222222-2222-4222-8222-222222222222";

function fakeStore(initialTopics: unknown[] = []) {
  const revisions: { id: string; version: number; topics: unknown[] }[] =
    initialTopics.length
      ? [{ id: "revision-1", version: 1, topics: initialTopics }]
      : [];
  let config: { id: string; version: number } | null = revisions.length
    ? { id: "config-1", version: 1 }
    : null;
  const db = {
    anamnesisTopicConfig: {
      findUnique: async () =>
        config && { ...config, revisions: revisions.slice(-1) },
      create: async () => (config = { id: "config-1", version: 1 }),
      updateMany: async ({
        where,
        data,
      }: {
        where: { version: number };
        data: { version: number };
      }) => {
        if (!config || config.version !== where.version) return { count: 0 };
        config.version = data.version;
        return { count: 1 };
      },
    },
    anamnesisTopicRevision: {
      create: async ({
        data,
      }: {
        data: { version: number; topics: unknown[] };
      }) => {
        const revision = { id: `revision-${data.version}`, ...data };
        revisions.push(revision);
        return revision;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return {
    service: new AnamnesisTopicsService(db as unknown as PrismaClient),
    revisions,
  };
}

describe("anamnesis topic revisions", () => {
  test("orders topics and retains immutable prior revision", async () => {
    const { service, revisions } = fakeStore();
    const first = await service.put(
      org,
      professional,
      professional,
      "PROFESSIONAL",
      {
        version: 0,
        topics: [
          { key: "history", label: "Histórico", active: true },
          { key: "notes", label: "Notas", active: true },
        ],
      },
    );
    const second = await service.put(
      org,
      professional,
      professional,
      "PROFESSIONAL",
      {
        version: 1,
        topics: [
          { key: "notes", label: "Notas", active: false },
          { key: "history", label: "Histórico", active: true },
        ],
      },
    );
    expect(first.revisionId).toBe("revision-1");
    expect(second.version).toBe(2);
    expect(second.topics.map((topic) => topic.key)).toEqual([
      "notes",
      "history",
    ]);
    expect((revisions[0]?.topics[0] as { key: string }).key).toBe("history");
    expect(
      (await service.currentRevisionForNewAnamnesis(org, professional))?.id,
    ).toBe("revision-2");
  });

  test("rejects stale versions, other professionals, and mandatory removal", async () => {
    const { service } = fakeStore([
      {
        key: "chief_complaint",
        label: "Queixa principal",
        active: true,
        required: true,
        order: 0,
      },
    ]);
    await expect(
      service.put(org, professional, professional, "PROFESSIONAL", {
        version: 0,
        topics: [],
      }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    await expect(
      service.put(org, professional, professional, "PROFESSIONAL", {
        version: 1,
        topics: [],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      service.put(
        org,
        professional,
        "33333333-3333-4333-8333-333333333333",
        "PROFESSIONAL",
        { version: 1, topics: [] },
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      service.get(org, professional, professional, "ADMIN"),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
});
