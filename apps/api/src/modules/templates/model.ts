import { t } from "elysia";

const uuid = t.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});

export const orgSlugParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});

export const templateParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  templateId: uuid,
});

export const templateVersionParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  templateId: uuid,
  version: t.Numeric({ minimum: 1 }),
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

export const getTemplateQuery = t.Object({
  version: t.Optional(t.Integer({ minimum: 1 })),
});

export const createTemplateBody = t.Object(
  {
    title: t.String({ maxLength: 500 }),
    type: documentType,
    bodyTemplate: t.String({ maxLength: 50000 }),
  },
  { additionalProperties: false },
);

export const updateTemplateBody = t.Object(
  {
    version: t.Integer({ minimum: 1 }),
    title: t.Optional(t.String({ maxLength: 500 })),
    type: t.Optional(documentType),
    bodyTemplate: t.Optional(t.String({ maxLength: 50000 })),
  },
  { additionalProperties: false },
);

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

export const templateDetailResponse = t.Object({
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
  variables: t.Array(t.String()),
  template: templateItem,
});

export const templateVersionItem = t.Object({
  id: t.String(),
  templateId: t.String(),
  organizationId: t.Nullable(t.String()),
  version: t.Integer({ minimum: 1 }),
  title: t.String(),
  type: documentType,
  bodyTemplate: t.String(),
  variables: t.Array(t.String()),
  createdById: t.Nullable(t.String()),
  createdAt: t.String(),
});

export const templateVersionsResponse = t.Object({
  data: t.Array(templateVersionItem),
  versions: t.Array(templateVersionItem),
});

export const archiveTemplateResponse = t.Object({ archived: t.Literal(true) });

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
export type TemplateParams = typeof templateParams.static;
export type TemplateVersionParams = typeof templateVersionParams.static;
export type DocumentType = typeof documentType.static;
export type TemplateStatus = typeof templateStatus.static;
export type TemplateScope = typeof templateScope.static;
export type ListTemplatesQuery = typeof listTemplatesQuery.static;
export type GetTemplateQuery = typeof getTemplateQuery.static;
export type CreateTemplateBody = typeof createTemplateBody.static;
export type UpdateTemplateBody = typeof updateTemplateBody.static;
export type TemplateItem = typeof templateItem.static;
export type TemplateDetailResponse = typeof templateDetailResponse.static;
export type TemplateVersionItem = typeof templateVersionItem.static;
export type TemplateVersionsResponse = typeof templateVersionsResponse.static;
export type PageInfo = typeof pageInfo.static;
export type ListTemplatesResponse = typeof listTemplatesResponse.static;
export type TemplateVariableCategory = typeof templateVariableCategory.static;
export type TemplateVariableValueType = typeof templateVariableValueType.static;
export type TemplateVariableItem = typeof templateVariableItem.static;
export type TemplateVariablesResponse = typeof templateVariablesResponse.static;
