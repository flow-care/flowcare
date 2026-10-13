import { t } from "elysia";

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

export const messageStatus = t.Union([
  t.Literal("QUEUED"),
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
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
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
  source: t.String({ minLength: 1, maxLength: 80 }),
});
export const preferenceResponse = t.Object({
  whatsappOptIn: t.Boolean(),
  recordedAt: t.String(),
});

export const models = {
  "communications.statusResponse": statusResponse,
  "communications.reconnectResponse": reconnectResponse,
  "communications.messageResponse": messageResponse,
  "communications.preferenceResponse": preferenceResponse,
};

export type ConnectionStatus = typeof connectionStatus.static;
