import { t } from "elysia";

export const params = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  professionalId: t.String({ format: "uuid" }),
});

export const topicInput = t.Object({
  key: t.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }),
  label: t.String({ minLength: 1, maxLength: 120 }),
  active: t.Boolean(),
});

export const putTopicsBody = t.Object({
  version: t.Integer({ minimum: 0 }),
  topics: t.Array(topicInput, { maxItems: 50 }),
});

export const topicOutput = t.Object({
  key: topicInput.properties.key,
  label: topicInput.properties.label,
  active: t.Boolean(),
  required: t.Boolean(),
  order: t.Integer({ minimum: 0 }),
});

export const topicsResponse = t.Object({
  professionalId: t.String(),
  version: t.Integer({ minimum: 0 }),
  revisionId: t.Nullable(t.String()),
  topics: t.Array(topicOutput),
});

export type PutTopicsBody = typeof putTopicsBody.static;
export type TopicOutput = typeof topicOutput.static;
