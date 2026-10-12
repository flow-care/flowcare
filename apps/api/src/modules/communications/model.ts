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

export const models = {
  "communications.statusResponse": statusResponse,
  "communications.reconnectResponse": reconnectResponse,
};

export type ConnectionStatus = typeof connectionStatus.static;
