import { t } from "elysia";

const uuid = t.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});

export const orgSlugParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});

export const documentType = t.Union([
  t.Literal("PRESCRIPTION"),
  t.Literal("CERTIFICATE"),
  t.Literal("REPORT"),
  t.Literal("EXAM_REQUEST"),
]);

export const templateStatus = t.Union([
  t.Literal("ACTIVE"),
  t.Literal("ARCHIVED"),
]);

export const templateScope = t.Union([
  t.Literal("ORGANIZATION"),
  t.Literal("GLOBAL"),
]);

export const listTemplatesQuery = t.Object({
  type: t.Optional(documentType),
  status: t.Optional(templateStatus),
  version: t.Optional(t.Integer({ minimum: 1 })),
  selectableOnly: t.Optional(t.Boolean()),
  includeArchived: t.Optional(t.Boolean()),
  search: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
  cursor: t.Optional(uuid),
});

export const templateItem = t.Object({
  id: t.String(),
  organizationId: t.Nullable(t.String()),
  scope: templateScope,
  isGlobal: t.Boolean(),
  title: t.String(),
  type: documentType,
  bodyTemplate: t.String(),
  status: templateStatus,
  version: t.Integer({ minimum: 1 }),
  selectable: t.Boolean(),
  archivedAt: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const pageInfo = t.Object({
  nextCursor: t.Nullable(t.String()),
  hasNextPage: t.Boolean(),
});

export const listTemplatesResponse = t.Object({
  data: t.Array(templateItem),
  pageInfo,
});

export const templateVariableCategory = t.Union([
  t.Literal("PATIENT"),
  t.Literal("CLINIC"),
  t.Literal("PROFESSIONAL"),
  t.Literal("DOCUMENT"),
]);

export const templateVariableValueType = t.Union([
  t.Literal("string"),
  t.Literal("date"),
  t.Literal("datetime"),
]);

export const templateVariableItem = t.Object({
  key: t.String(),
  placeholder: t.String(),
  label: t.String(),
  description: t.String(),
  type: templateVariableValueType,
  category: templateVariableCategory,
  required: t.Boolean(),
  source: t.String(),
  example: t.String(),
});

export const templateVariablesResponse = t.Object({
  data: t.Array(templateVariableItem),
});

export type OrgSlugParams = typeof orgSlugParams.static;
export type DocumentType = typeof documentType.static;
export type TemplateStatus = typeof templateStatus.static;
export type TemplateScope = typeof templateScope.static;
export type ListTemplatesQuery = typeof listTemplatesQuery.static;
export type TemplateItem = typeof templateItem.static;
export type PageInfo = typeof pageInfo.static;
export type ListTemplatesResponse = typeof listTemplatesResponse.static;
export type TemplateVariableCategory = typeof templateVariableCategory.static;
export type TemplateVariableValueType = typeof templateVariableValueType.static;
export type TemplateVariableItem = typeof templateVariableItem.static;
export type TemplateVariablesResponse = typeof templateVariablesResponse.static;
