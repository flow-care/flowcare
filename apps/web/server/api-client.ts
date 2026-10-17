import "server-only";

import { isIP } from "node:net";
import * as nextHeaders from "next/headers";
import { z } from "zod";
import { getServerConfig } from "./config";

const MAX_FORWARDED_FOR_LENGTH = 512;

const publicMessages = {
  INVALID_CREDENTIALS: "E-mail ou senha inválidos.",
  ACCOUNT_NOT_VERIFIED: "Confirme seu e-mail antes de entrar.",
  INVALID_TOKEN: "Este link é inválido, expirou ou já foi usado.",
  VALIDATION_ERROR: "Confira os dados informados e tente novamente.",
  RATE_LIMITED: "Aguarde antes de tentar novamente.",
  UPSTREAM_UNAVAILABLE: "Serviço indisponível. Tente novamente.",
} as const;

type ErrorCode = keyof typeof publicMessages;

export class ApiRequestError extends Error {
  constructor(readonly code: ErrorCode) {
    super(publicMessages[code]);
  }
}

const failureSchema = z.object({ error: z.object({ code: z.string() }) });

function normalizeIpAddress(value: string | null): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  const unwrapped =
    candidate.startsWith("[") && candidate.endsWith("]")
      ? candidate.slice(1, -1)
      : candidate;
  return isIP(unwrapped) === 0 ? null : unwrapped;
}

export function forwardedClientIp(value: string | null): string | null {
  if (!value || value.length > MAX_FORWARDED_FOR_LENGTH) return null;
  return normalizeIpAddress(value.split(",").at(-1) ?? null);
}

async function currentRequestHeaders(): Promise<Headers | null> {
  const readHeaders = (
    nextHeaders as unknown as {
      headers?: () => Promise<Headers>;
    }
  ).headers;
  return typeof readHeaders === "function" ? readHeaders() : null;
}

export async function postApi<T>(
  path: string,
  body: Record<string, string>,
  responseSchema: z.ZodType<T>,
  options?: { requestHeaders?: Headers },
): Promise<T> {
  try {
    const { apiBaseUrl, trustProxy } = getServerConfig();
    const incomingHeaders =
      options?.requestHeaders ?? (await currentRequestHeaders());
    const clientIp =
      trustProxy && incomingHeaders
        ? forwardedClientIp(incomingHeaders.get("x-forwarded-for"))
        : null;
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(clientIp ? { "X-Forwarded-For": clientIp } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const failure = failureSchema.safeParse(data);
      const code = failure.success ? failure.data.error.code : "";
      if (Object.hasOwn(publicMessages, code)) {
        throw new ApiRequestError(code as ErrorCode);
      }
      throw new ApiRequestError("UPSTREAM_UNAVAILABLE");
    }
    const parsed = responseSchema.safeParse(data);
    if (!parsed.success) throw new ApiRequestError("UPSTREAM_UNAVAILABLE");
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError("UPSTREAM_UNAVAILABLE");
  }
}
