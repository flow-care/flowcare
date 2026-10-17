export type WhatsAppDestination = {
  e164: string;
  chatId: string;
};

/**
 * Patient phones are stored as Brazilian national numbers (DDD + subscriber)
 * or as a complete Brazilian number. Explicit non-Brazilian numbers are not
 * part of the current product contract and are rejected instead of guessed.
 */
export function normalizeWhatsAppDestination(
  value: string,
): WhatsAppDestination | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  const hasExplicitCountryCode = trimmed.startsWith("+");

  if (hasExplicitCountryCode && !digits.startsWith("55")) return null;

  const e164Digits =
    digits.length === 10 || digits.length === 11
      ? `55${digits}`
      : (digits.length === 12 || digits.length === 13) &&
          digits.startsWith("55")
        ? digits
        : null;

  if (!e164Digits) return null;
  const nationalNumber = e164Digits.slice(2);
  if (!/^[1-9]\d(?:9\d{8}|[2-5]\d{7})$/.test(nationalNumber)) return null;

  return {
    e164: `+${e164Digits}`,
    chatId: `${e164Digits}@c.us`,
  };
}
