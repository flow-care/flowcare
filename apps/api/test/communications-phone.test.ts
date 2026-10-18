import { describe, expect, test } from "bun:test";
import { normalizeWhatsAppDestination } from "../src/modules/communications/phone";

describe("WhatsApp destination normalization", () => {
  test("treats DDD 55 as a Brazilian area code, not a country code", () => {
    expect(normalizeWhatsAppDestination("(55) 99999-8888")).toEqual({
      e164: "+5555999998888",
      chatId: "5555999998888@c.us",
    });
  });

  test("normalizes other Brazilian DDDs and preserves complete E.164 input", () => {
    expect(normalizeWhatsAppDestination("(11) 98765-4321")?.e164).toBe(
      "+5511987654321",
    );
    expect(normalizeWhatsAppDestination("+55 85 99999-0000")?.e164).toBe(
      "+5585999990000",
    );
  });

  test("rejects unsupported international, invalid and ambiguous inputs", () => {
    for (const value of [
      "+1 415 555 2671",
      "14155552671",
      "55123456789012",
      "(00) 99999-8888",
      "119876543",
      "not-a-phone",
    ]) {
      expect(normalizeWhatsAppDestination(value)).toBeNull();
    }
  });
});
