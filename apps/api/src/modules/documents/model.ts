import { t } from "elysia";

const uuid = t.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$",
});

export const orgSlugParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
});

export const documentIdParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  documentId: uuid,
});

export const documentVersionParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  documentId: uuid,
  versionId: t.String({ minLength: 1, maxLength: 100 }),
});

export const documentType = t.Union([
  t.Literal("PRESCRIPTION"),
  t.Literal("CERTIFICATE"),
  t.Literal("REPORT"),
  t.Literal("EXAM_REQUEST"),
]);

export const documentStatus = t.Union([
  t.Literal("DRAFT"),
  t.Literal("ISSUED"),
  t.Literal("VOIDED"),
]);

export const documentVariableValue = t.Union([
  t.String(),
  t.Number(),
  t.Boolean(),
  t.Null(),
]);

export const documentVariables = t.Record(t.String(), documentVariableValue);

export const documentUserSummary = t.Object({
  id: t.String(),
  fullName: t.String(),
});

export const createDocumentDraftBody = t.Object({
  patientId: uuid,
  type: documentType,
  title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  content: t.Optional(t.String({ maxLength: 50000 })),
  body: t.Optional(t.String({ maxLength: 50000 })),
  templateId: t.Optional(t.Nullable(uuid)),
  variables: t.Optional(documentVariables),
});

export const updateDocumentDraftBody = t.Object({
  version: t.Integer({ minimum: 1 }),
  title: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
  content: t.Optional(t.String({ maxLength: 50000 })),
  body: t.Optional(t.String({ maxLength: 50000 })),
  templateId: t.Optional(t.Nullable(uuid)),
  variables: t.Optional(documentVariables),
});

export const listDocumentsQuery = t.Object({
  patientId: t.Optional(uuid),
  type: t.Optional(documentType),
  status: t.Optional(documentStatus),
  search: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  q: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  authorId: t.Optional(uuid),
  startDate: t.Optional(t.String()),
  endDate: t.Optional(t.String()),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
  cursor: t.Optional(t.String()),
  page: t.Optional(t.Integer({ minimum: 1 })),
  order: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
});

export const getDocumentQuery = t.Object({
  version: t.Optional(t.Integer({ minimum: 1 })),
});

export const listVersionsQuery = t.Object({
  version: t.Optional(t.Integer({ minimum: 1 })),
  order: t.Optional(t.Union([t.Literal("asc"), t.Literal("desc")])),
});

export const documentVersionItem = t.Object({
  id: t.String(),
  revisionId: t.String(),
  documentId: t.String(),
  version: t.Integer({ minimum: 1 }),
  title: t.String(),
  content: t.String(),
  variables: documentVariables,
  templateId: t.Nullable(t.String()),
  templateVersion: t.Nullable(t.Integer({ minimum: 1 })),
  savedById: t.String(),
  savedBy: documentUserSummary,
  isActiveVersion: t.Boolean(),
  createdAt: t.String(),
});

export const documentListItem = t.Object({
  id: t.String(),
  documentId: t.String(),
  organizationId: t.String(),
  patientId: t.String(),
  authorId: t.String(),
  templateId: t.Nullable(t.String()),
  templateVersion: t.Nullable(t.Integer({ minimum: 1 })),
  type: documentType,
  title: t.String(),
  status: documentStatus,
  version: t.Integer({ minimum: 1 }),
  revisionId: t.Nullable(t.String()),
  currentRevisionId: t.Nullable(t.String()),
  patient: documentUserSummary,
  author: documentUserSummary,
  issuedAt: t.Nullable(t.String()),
  voidedAt: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
});

export const documentPageInfo = t.Object({
  limit: t.Integer({ minimum: 1, maximum: 100 }),
  page: t.Integer({ minimum: 1 }),
  totalCount: t.Integer({ minimum: 0 }),
  hasNextPage: t.Boolean(),
  nextCursor: t.Nullable(t.String()),
});

export const listDocumentsResponse = t.Object({
  data: t.Array(documentListItem),
  documents: t.Array(documentListItem),
  pageInfo: documentPageInfo,
});

export const documentItem = t.Object({
  id: t.String(),
  documentId: t.String(),
  organizationId: t.String(),
  patientId: t.String(),
  authorId: t.String(),
  templateId: t.Nullable(t.String()),
  templateVersion: t.Nullable(t.Integer({ minimum: 1 })),
  type: documentType,
  title: t.String(),
  content: t.String(),
  variables: documentVariables,
  status: documentStatus,
  version: t.Integer({ minimum: 1 }),
  revisionId: t.Nullable(t.String()),
  currentRevisionId: t.Nullable(t.String()),
  patient: documentUserSummary,
  author: documentUserSummary,
  issuedAt: t.Nullable(t.String()),
  voidedAt: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  versions: t.Array(documentVersionItem),
});

export const documentResponse = t.Object({
  id: t.String(),
  documentId: t.String(),
  organizationId: t.String(),
  patientId: t.String(),
  authorId: t.String(),
  templateId: t.Nullable(t.String()),
  templateVersion: t.Nullable(t.Integer({ minimum: 1 })),
  type: documentType,
  title: t.String(),
  content: t.String(),
  variables: documentVariables,
  status: documentStatus,
  version: t.Integer({ minimum: 1 }),
  revisionId: t.Nullable(t.String()),
  currentRevisionId: t.Nullable(t.String()),
  patient: documentUserSummary,
  author: documentUserSummary,
  issuedAt: t.Nullable(t.String()),
  voidedAt: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  versions: t.Array(documentVersionItem),
  document: documentItem,
});

export const documentVersionsResponse = t.Object({
  documentId: t.String(),
  currentVersion: t.Integer({ minimum: 1 }),
  currentRevisionId: t.Nullable(t.String()),
  status: documentStatus,
  data: t.Array(documentVersionItem),
  versions: t.Array(documentVersionItem),
});

export const documentVersionDetailResponse = t.Object({
  id: t.String(),
  revisionId: t.String(),
  documentId: t.String(),
  organizationId: t.String(),
  version: t.Integer({ minimum: 1 }),
  title: t.String(),
  content: t.String(),
  variables: documentVariables,
  templateId: t.Nullable(t.String()),
  templateVersion: t.Nullable(t.Integer({ minimum: 1 })),
  savedById: t.String(),
  savedBy: documentUserSummary,
  isActiveVersion: t.Boolean(),
  createdAt: t.String(),
  snapshot: t.Object({
    version: t.Integer({ minimum: 1 }),
    title: t.String(),
    content: t.String(),
    variables: documentVariables,
    templateId: t.Nullable(t.String()),
    templateVersion: t.Nullable(t.Integer({ minimum: 1 })),
    savedBy: documentUserSummary,
    createdAt: t.String(),
  }),
});

export type OrgSlugParams = typeof orgSlugParams.static;
export type DocumentIdParams = typeof documentIdParams.static;
export type DocumentVersionParams = typeof documentVersionParams.static;
export type DocumentType = typeof documentType.static;
export type DocumentStatus = typeof documentStatus.static;
export type DocumentVariables = typeof documentVariables.static;
export type DocumentUserSummary = typeof documentUserSummary.static;
export type CreateDocumentDraftBody = typeof createDocumentDraftBody.static;
export type UpdateDocumentDraftBody = typeof updateDocumentDraftBody.static;
export type ListDocumentsQuery = typeof listDocumentsQuery.static;
export type GetDocumentQuery = typeof getDocumentQuery.static;
export type ListVersionsQuery = typeof listVersionsQuery.static;
export type DocumentVersionItem = typeof documentVersionItem.static;
export type DocumentListItem = typeof documentListItem.static;
export type DocumentPageInfo = typeof documentPageInfo.static;
export type ListDocumentsResponse = typeof listDocumentsResponse.static;
export type DocumentItem = typeof documentItem.static;
export type DocumentResponse = typeof documentResponse.static;
export type DocumentVersionsResponse = typeof documentVersionsResponse.static;
export type DocumentVersionDetailResponse =
  typeof documentVersionDetailResponse.static;
