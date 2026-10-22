import { describe, expect, test } from "bun:test";
import {
  buildPreviewSegments,
  canAccessWhatsAppTab,
  canManageWhatsAppConnection,
  canRequestQr,
  canRetryMessage,
  connectionPresentation,
  DEFAULT_TEMPLATE_CONTENT,
  describeMessageFailure,
  ensureMaskedPhone,
  formatConnectedPhone,
  formatCountdown,
  insertTemplateVariable,
  isQrExpired,
  messageStatusPresentation,
  messageStatusSchema,
  messageTypeLabel,
  nextPollDelayMs,
  parseMessagePeriod,
  parseMessageStatusFilter,
  qrProgressPercent,
  qrRemainingSeconds,
  qrTtlMs,
  renderPreviewText,
  resolvePeriodRange,
  resolveWhatsAppTab,
  TEMPLATE_TYPES,
  TEMPLATE_VARIABLES,
  validateTemplateContent,
  whatsappReconnectSchema,
  whatsappTabHref,
} from "../lib/whatsapp";

describe("whatsapp tab access", () => {
  test("only clinic administrators manage the connection and templates", () => {
    expect(canManageWhatsAppConnection("ADMIN")).toBe(true);
    expect(canManageWhatsAppConnection("ADMIN_PROFESSIONAL")).toBe(true);
    expect(canManageWhatsAppConnection("RECEPTIONIST")).toBe(false);
    expect(canManageWhatsAppConnection("PROFESSIONAL")).toBe(false);
    expect(canAccessWhatsAppTab("RECEPTIONIST", "connection")).toBe(false);
    expect(canAccessWhatsAppTab("RECEPTIONIST", "settings")).toBe(false);
    expect(canAccessWhatsAppTab("RECEPTIONIST", "messages")).toBe(true);
    expect(canAccessWhatsAppTab("PROFESSIONAL", "messages")).toBe(false);
    expect(canAccessWhatsAppTab("ADMIN", "settings")).toBe(true);
  });

  test("resolves the tab from the query string with a role-aware default", () => {
    expect(resolveWhatsAppTab(undefined, "ADMIN")).toBe("connection");
    expect(resolveWhatsAppTab(undefined, "RECEPTIONIST")).toBe("messages");
    expect(resolveWhatsAppTab("messages", "ADMIN")).toBe("messages");
    expect(resolveWhatsAppTab("settings", "ADMIN")).toBe("settings");
    expect(resolveWhatsAppTab("bogus", "ADMIN")).toBe("connection");
  });

  test("builds tab links with the org slug encoded", () => {
    expect(whatsappTabHref("vida-e-saude", "connection")).toBe(
      "/app/vida-e-saude/whatsapp",
    );
    expect(
      whatsappTabHref("vida-e-saude", "messages", {
        status: "FAILED",
        period: undefined,
      }),
    ).toBe("/app/vida-e-saude/whatsapp?tab=messages&status=FAILED");
  });
});

describe("connection status and QR countdown", () => {
  test("maps every API status to a label and tone", () => {
    expect(connectionPresentation("CONNECTED")).toMatchObject({
      label: "Conectado",
      tone: "success",
    });
    expect(connectionPresentation("DISCONNECTED").label).toBe("Desconectado");
    expect(connectionPresentation("CONNECTING").tone).toBe("warning");
    expect(connectionPresentation("QR_CODE_REQUIRED").tone).toBe("warning");
    expect(connectionPresentation("ERROR")).toMatchObject({
      label: "Falha de conexão",
      tone: "danger",
    });
  });

  test("offers QR generation unless the session is already connected", () => {
    expect(canRequestQr("CONNECTED")).toBe(false);
    expect(canRequestQr("DISCONNECTED")).toBe(true);
    expect(canRequestQr("ERROR")).toBe(true);
  });

  test("computes the remaining validity on the server clock", () => {
    const now = Date.parse("2026-10-11T12:00:00.000Z");
    expect(qrTtlMs("2026-10-11T12:00:20.000Z", now)).toBe(20_000);
    expect(qrTtlMs("2026-10-11T11:59:00.000Z", now)).toBe(0);
    expect(qrTtlMs(null, now)).toBe(0);
    expect(qrTtlMs("not-a-date", now)).toBe(20_000);
    expect(qrTtlMs("2026-10-12T12:00:00.000Z", now)).toBe(120_000);
  });

  test("counts down and expires", () => {
    expect(qrRemainingSeconds(20_000, 0)).toBe(20);
    expect(qrRemainingSeconds(20_000, 500)).toBe(20);
    expect(qrRemainingSeconds(20_000, 19_100)).toBe(1);
    expect(qrRemainingSeconds(20_000, 25_000)).toBe(0);
    expect(isQrExpired(20_000, 19_999)).toBe(false);
    expect(isQrExpired(20_000, 20_000)).toBe(true);
    expect(formatCountdown(20)).toBe("00:20");
    expect(formatCountdown(65)).toBe("01:05");
    expect(formatCountdown(-3)).toBe("00:00");
    expect(qrProgressPercent(10_000, 20_000)).toBe(50);
    expect(qrProgressPercent(0, 0)).toBe(0);
  });

  test("polls faster while waiting for the pairing", () => {
    expect(nextPollDelayMs("CONNECTED", false)).toBe(8_000);
    expect(nextPollDelayMs("DISCONNECTED", true)).toBe(3_000);
    expect(nextPollDelayMs("CONNECTING", false)).toBe(3_000);
  });

  test("formats the paired phone number", () => {
    expect(formatConnectedPhone("5511999998888")).toBe("+55 (11) 99999-8888");
    expect(formatConnectedPhone(null)).toBe("Número não informado");
  });

  test("accepts only inline base64 images as QR source", () => {
    const base = { status: "QR_CODE_REQUIRED", phoneNumber: null };
    expect(
      whatsappReconnectSchema.safeParse({
        ...base,
        qrCode: "data:image/png;base64,iVBORw0KGgo=",
        qrExpiresAt: "2026-10-11T12:00:20.000Z",
      }).success,
    ).toBe(true);
    expect(
      whatsappReconnectSchema.safeParse({
        ...base,
        qrCode: "https://evil.example/qr.png",
        qrExpiresAt: null,
      }).success,
    ).toBe(false);
    expect(
      whatsappReconnectSchema.safeParse({
        ...base,
        qrCode: "javascript:alert(1)",
        qrExpiresAt: null,
      }).success,
    ).toBe(false);
  });
});

describe("message history", () => {
  test("maps each status to a distinct badge label", () => {
    const labels = messageStatusSchema.options.map(
      (status) => messageStatusPresentation(status).label,
    );
    expect(labels).toEqual([
      "Na fila",
      "Incerta",
      "Enviada",
      "Entregue",
      "Lida",
      "Falhou",
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("labels the API message types", () => {
    expect(messageTypeLabel("APPOINTMENT_CREATED")).toBe("Confirmação");
    expect(messageTypeLabel("APPOINTMENT_REMINDER")).toBe("Lembrete");
    expect(messageTypeLabel("APPOINTMENT_CANCELLED")).toBe("Cancelamento");
    expect(messageTypeLabel("SOMETHING_ELSE")).toBe("Mensagem");
  });

  test("allows retry only for FAILED messages and writers", () => {
    expect(canRetryMessage("FAILED")).toBe(true);
    expect(canRetryMessage("FAILED", false)).toBe(false);
    for (const status of [
      "QUEUED",
      "UNCERTAIN",
      "SENT",
      "DELIVERED",
      "READ",
    ] as const) {
      expect(canRetryMessage(status)).toBe(false);
    }
  });

  test("keeps phone numbers masked", () => {
    expect(ensureMaskedPhone("(11) 98765-****")).toBe("(11) 98765-****");
    expect(ensureMaskedPhone("11987654321")).toBe("(11) 98765-****");
    expect(ensureMaskedPhone("5511987654321")).toBe("(11) 98765-****");
    expect(ensureMaskedPhone("1133334444")).toBe("(11) 3333-****");
    expect(ensureMaskedPhone("123")).toBe("****");
    expect(ensureMaskedPhone(null)).toBe("Telefone não informado");
    expect(ensureMaskedPhone("11987654321")).not.toContain("4321");
  });

  test("turns error codes into friendly reasons", () => {
    expect(describeMessageFailure("WAHA_ACK_ERROR", null).title).toContain(
      "falha na entrega",
    );
    expect(
      describeMessageFailure("TEMPLATE_NOT_CONFIGURED", null).hint,
    ).toContain("Textos das mensagens");
    expect(describeMessageFailure("WAHA_HTTP_400", null).title).toContain(
      "recusou",
    );
    expect(describeMessageFailure("X", "Motivo do servidor").title).toBe(
      "Motivo do servidor",
    );
    expect(describeMessageFailure(null, null).title).toBe(
      "Motivo não informado",
    );
  });

  test("parses and resolves filters", () => {
    expect(parseMessageStatusFilter("failed")).toBe("FAILED");
    expect(parseMessageStatusFilter("nope")).toBeUndefined();
    expect(parseMessageStatusFilter(undefined)).toBeUndefined();
    expect(parseMessagePeriod("7d")).toBe("7d");
    expect(parseMessagePeriod("forever")).toBe("all");

    const now = new Date("2026-10-22T12:00:00.000Z");
    expect(resolvePeriodRange("all", now)).toEqual({});
    expect(resolvePeriodRange("24h", now)).toEqual({
      from: "2026-10-21T12:00:00.000Z",
    });
    expect(resolvePeriodRange("30d", now)).toEqual({
      from: "2026-09-22T12:00:00.000Z",
    });
  });
});

describe("template validation", () => {
  test("accepts text that only uses allowed variables", () => {
    const result = validateTemplateContent(
      "APPOINTMENT_REMINDER_24H",
      "Olá, {paciente_nome}. Sua consulta é em {data} às {hora}.",
    );
    expect(result.ok).toBe(true);
    expect(result.variables).toEqual(["paciente_nome", "data", "hora"]);
  });

  test("blocks unknown variables with an explanatory message", () => {
    const result = validateTemplateContent(
      "APPOINTMENT_CONFIRMATION",
      "Tome {medicamento} em {data}.",
    );
    expect(result.ok).toBe(false);
    expect(result.unknownVariables).toEqual(["medicamento"]);
    expect(result.issues[0]?.kind).toBe("UNKNOWN_VARIABLE");
    expect(result.issues[0]?.message).toContain("{medicamento}");
  });

  test("does not allow {medico_nome} in cancellation texts", () => {
    expect(TEMPLATE_VARIABLES.APPOINTMENT_CANCELLATION).not.toContain(
      "medico_nome",
    );
    expect(
      validateTemplateContent("APPOINTMENT_CANCELLATION", "Dr. {medico_nome}")
        .ok,
    ).toBe(false);
    expect(
      validateTemplateContent("APPOINTMENT_CONFIRMATION", "Dr. {medico_nome}")
        .ok,
    ).toBe(true);
  });

  test("flags malformed placeholders like the API does", () => {
    for (const content of [
      "Olá {paciente_nome",
      "Olá paciente_nome}",
      "Olá {}",
      "Olá {Paciente}",
      "Olá {a{b}}",
      "Olá {paciente nome}",
    ]) {
      const result = validateTemplateContent(
        "APPOINTMENT_CONFIRMATION",
        content,
      );
      expect(result.ok).toBe(false);
      expect(result.issues.some((issue) => issue.kind === "MALFORMED")).toBe(
        true,
      );
    }
    // The API trims whitespace inside the braces.
    expect(
      validateTemplateContent("APPOINTMENT_CONFIRMATION", "Olá { data }").ok,
    ).toBe(true);
  });

  test("enforces empty and length limits", () => {
    expect(
      validateTemplateContent("APPOINTMENT_CONFIRMATION", "   ").issues[0],
    ).toMatchObject({ kind: "EMPTY" });
    const tooLong = validateTemplateContent(
      "APPOINTMENT_CONFIRMATION",
      "a".repeat(11),
      10,
    );
    expect(tooLong.ok).toBe(false);
    expect(tooLong.issues[0]).toMatchObject({ kind: "TOO_LONG" });
    expect(
      validateTemplateContent("APPOINTMENT_CONFIRMATION", "a".repeat(4096)).ok,
    ).toBe(true);
    expect(
      validateTemplateContent("APPOINTMENT_CONFIRMATION", "a".repeat(4097)).ok,
    ).toBe(false);
  });

  test("rejects control characters", () => {
    const result = validateTemplateContent(
      "APPOINTMENT_CONFIRMATION",
      "Olá\u0000 mundo",
    );
    expect(result.issues.some((i) => i.kind === "CONTROL_CHARACTERS")).toBe(
      true,
    );
    expect(
      validateTemplateContent("APPOINTMENT_CONFIRMATION", "Olá\nmundo\t!").ok,
    ).toBe(true);
  });

  test("ships valid default texts for every type", () => {
    for (const type of TEMPLATE_TYPES) {
      expect(
        validateTemplateContent(type, DEFAULT_TEMPLATE_CONTENT[type]).ok,
      ).toBe(true);
    }
  });
});

describe("template preview and variable insertion", () => {
  test("renders fictitious data for valid variables", () => {
    expect(
      renderPreviewText(
        "APPOINTMENT_CONFIRMATION",
        "Olá, {paciente_nome}. Consulta em {data} às {hora} com {medico_nome} na {clinica_nome}.",
      ),
    ).toBe(
      "Olá, Maria da Silva. Consulta em 20/10/2026 às 14:30 com Dra. Ana Oliveira na Clínica Exemplo.",
    );
  });

  test("keeps invalid placeholders verbatim and marks them", () => {
    const segments = buildPreviewSegments(
      "APPOINTMENT_CANCELLATION",
      "Oi {paciente_nome}, {medicamento} e {medico_nome}",
    );
    expect(segments.map((segment) => segment.kind)).toEqual([
      "text",
      "value",
      "text",
      "invalid",
      "text",
      "invalid",
    ]);
    expect(segments[3]?.text).toBe("{medicamento}");
    expect(segments[5]?.text).toBe("{medico_nome}");
  });

  test("inserts a variable at the cursor or over the selection", () => {
    expect(insertTemplateVariable("Olá, !", 5, 5, "paciente_nome")).toEqual({
      content: "Olá, {paciente_nome}!",
      cursor: 20,
    });
    expect(insertTemplateVariable("Olá XXX!", 4, 7, "data")).toEqual({
      content: "Olá {data}!",
      cursor: 10,
    });
    expect(insertTemplateVariable("abc", 99, 99, "hora").content).toBe(
      "abc{hora}",
    );
  });
});
