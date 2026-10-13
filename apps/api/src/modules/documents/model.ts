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
  createdAt: t.String(),
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
  versions: t.Array(documentVersionItem),
});

export const prepareDocumentSnapshotBody = t.Optional(
  t.Object({
    version: t.Optional(t.Integer({ minimum: 1 })),
    variables: t.Optional(documentVariables),
    type: t.Optional(t.String()),
  }),
);

export const documentSnapshotItem = t.Object({
  documentId: t.String(),
  version: t.Integer({ minimum: 1 }),
  revisionId: t.String(),
  type: documentType,
  title: t.String(),
  content: t.String(),
  variables: documentVariables,
  preparedAt: t.String(),
});

export const prepareDocumentSnapshotResponse = t.Object({
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
  issuedAt: t.Nullable(t.String()),
  voidedAt: t.Nullable(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  versions: t.Array(documentVersionItem),
  document: documentItem,
  snapshot: documentSnapshotItem,
});

export type OrgSlugParams = typeof orgSlugParams.static;
export type DocumentIdParams = typeof documentIdParams.static;
export type DocumentType = typeof documentType.static;
export type DocumentStatus = typeof documentStatus.static;
export type DocumentVariables = typeof documentVariables.static;
export type CreateDocumentDraftBody = typeof createDocumentDraftBody.static;
export type UpdateDocumentDraftBody = typeof updateDocumentDraftBody.static;
export type PrepareDocumentSnapshotBody =
  typeof prepareDocumentSnapshotBody.static;
export type DocumentVersionItem = typeof documentVersionItem.static;
export type DocumentItem = typeof documentItem.static;
export type DocumentResponse = typeof documentResponse.static;
export type DocumentVersionsResponse = typeof documentVersionsResponse.static;
export type DocumentSnapshotItem = typeof documentSnapshotItem.static;
export type PrepareDocumentSnapshotResponse =
  typeof prepareDocumentSnapshotResponse.static;
