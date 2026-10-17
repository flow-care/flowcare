import { t } from "elysia";

// Provisional MVP limit. Centralized here so transport and service validation
// expose the same constraint until provider/product limits are formalized.
export const WHATSAPP_TEMPLATE_MAX_LENGTH = 4_096;
// Prisma Int maps to PostgreSQL's signed 32-bit integer range.
export const WHATSAPP_TEMPLATE_VERSION_MAX = 2_147_483_647;

export const connectionStatus = t.Union([
  t.Literal("CONNECTED"),
  t.Literal("DISCONNECTED"),
  t.Literal("QR_CODE_REQUIRED"),
  t.Literal("CONNECTING"),
  t.Literal("ERROR"),
]);

export const statusResponse = t.Object({
  status: connectionStatus,
  phoneNumber: t.Union([t.String(), t.Null()]),
});

export const reconnectResponse = t.Object({
  status: connectionStatus,
  phoneNumber: t.Union([t.String(), t.Null()]),
  qrCode: t.Union([t.String(), t.Null()]),
  qrExpiresAt: t.Union([t.String({ format: "date-time" }), t.Null()]),
});

export const whatsappTemplateType = t.Union([
  t.Literal("APPOINTMENT_CONFIRMATION"),
  t.Literal("APPOINTMENT_CANCELLATION"),
  t.Literal("APPOINTMENT_REMINDER_24H"),
]);

export const whatsappTemplateParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  type: whatsappTemplateType,
});

export const whatsappTemplateVersionParams = t.Object({
  orgSlug: t.String({ minLength: 2, maxLength: 60 }),
  type: whatsappTemplateType,
  version: t.Numeric({
    minimum: 1,
    maximum: WHATSAPP_TEMPLATE_VERSION_MAX,
    multipleOf: 1,
  }),
});

export const saveWhatsappTemplateBody = t.Object(
  {
    content: t.String({
      minLength: 1,
      maxLength: WHATSAPP_TEMPLATE_MAX_LENGTH,
    }),
    // Version 0 creates the first organization-owned version.
    version: t.Integer({
      minimum: 0,
      maximum: WHATSAPP_TEMPLATE_VERSION_MAX,
    }),
  },
  { additionalProperties: false },
);

export const previewWhatsappTemplateBody = t.Object(
  {
    content: t.String({
      minLength: 1,
      maxLength: WHATSAPP_TEMPLATE_MAX_LENGTH,
    }),
  },
  { additionalProperties: false },
);

export const whatsappTemplateItem = t.Object({
  type: whatsappTemplateType,
  content: t.String(),
  version: t.Integer({ minimum: 1 }),
  allowedVariables: t.Array(t.String()),
  maxLength: t.Integer(),
  approvedById: t.String(),
  approvedAt: t.String({ format: "date-time" }),
  createdAt: t.String({ format: "date-time" }),
  updatedAt: t.String({ format: "date-time" }),
});

export const whatsappTemplatesResponse = t.Object({
  data: t.Array(whatsappTemplateItem),
});

export const whatsappTemplateVersionItem = t.Object({
  type: whatsappTemplateType,
  content: t.String(),
  version: t.Integer({ minimum: 1 }),
  approvedById: t.String(),
  approvedAt: t.String({ format: "date-time" }),
  createdAt: t.String({ format: "date-time" }),
});

export const whatsappTemplateVersionsResponse = t.Object({
  data: t.Array(whatsappTemplateVersionItem),
});

export const whatsappTemplatePreviewResponse = t.Object({
  isExample: t.Literal(true),
  type: whatsappTemplateType,
  content: t.String(),
  variables: t.Record(t.String(), t.String()),
  allowedVariables: t.Array(t.String()),
  maxLength: t.Integer(),
});

export const messageStatus = t.Union([
  t.Literal("QUEUED"),
  t.Literal("UNCERTAIN"),
  t.Literal("SENT"),
  t.Literal("DELIVERED"),
  t.Literal("READ"),
  t.Literal("FAILED"),
]);
export const messageQuery = t.Object({
  status: t.Optional(messageStatus),
  patientId: t.Optional(t.String({ format: "uuid" })),
  from: t.Optional(t.String({ format: "date-time" })),
  to: t.Optional(t.String({ format: "date-time" })),
  cursor: t.Optional(t.String({ format: "uuid" })),
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, multipleOf: 1 })),
});
export const messageResponse = t.Object({
  items: t.Array(
    t.Object({
      id: t.String(),
      type: t.String(),
      status: messageStatus,
      patientId: t.String(),
      appointmentId: t.String(),
      phoneMasked: t.String(),
      createdAt: t.String(),
      sentAt: t.Union([t.String(), t.Null()]),
      errorCode: t.Union([t.String(), t.Null()]),
      errorReason: t.Union([t.String(), t.Null()]),
    }),
  ),
  nextCursor: t.Union([t.String(), t.Null()]),
});
export const preferenceBody = t.Object({
  whatsappOptIn: t.Boolean(),
  source: t.String({ minLength: 1, maxLength: 80, pattern: "\\S" }),
});
export const preferenceResponse = t.Object({
  whatsappOptIn: t.Boolean(),
  recordedAt: t.String(),
});

export const models = {
  "communications.statusResponse": statusResponse,
  "communications.reconnectResponse": reconnectResponse,
  "communications.whatsappTemplateItem": whatsappTemplateItem,
  "communications.whatsappTemplatesResponse": whatsappTemplatesResponse,
  "communications.whatsappTemplateVersionsResponse":
    whatsappTemplateVersionsResponse,
  "communications.whatsappTemplatePreviewResponse":
    whatsappTemplatePreviewResponse,
  "communications.messageResponse": messageResponse,
  "communications.preferenceResponse": preferenceResponse,
};

export type ConnectionStatus = typeof connectionStatus.static;
export type WhatsAppTemplateType = typeof whatsappTemplateType.static;
export type SaveWhatsAppTemplateBody = typeof saveWhatsappTemplateBody.static;
export type PreviewWhatsAppTemplateBody =
  typeof previewWhatsappTemplateBody.static;
export type WhatsAppTemplateItem = typeof whatsappTemplateItem.static;
export type WhatsAppTemplateVersionItem =
  typeof whatsappTemplateVersionItem.static;
export type WhatsAppTemplatePreviewResponse =
  typeof whatsappTemplatePreviewResponse.static;
