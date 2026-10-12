import type { PrismaClient } from "../../generated/prisma/client";
import type { WahaSession, WhatsAppProvider } from "../../services/waha-client";
import type { ConnectionStatus } from "./model";

const QR_TTL_MS = 20_000;

export class CommunicationsService {
  constructor(
    private readonly deps: {
      prisma: PrismaClient;
      provider: WhatsAppProvider;
      now?: () => Date;
    },
  ) {}

  async status(organizationId: string) {
    const binding = await this.deps.prisma.whatsAppSession.findUnique({
      where: { organizationId },
      select: { providerSessionName: true },
    });
    if (!binding) return { status: "DISCONNECTED" as const, phoneNumber: null };
    const session = await this.deps.provider.getSession(
      binding.providerSessionName,
    );
    return session
      ? publicSession(session)
      : { status: "DISCONNECTED" as const, phoneNumber: null };
  }

  async reconnect(organizationId: string) {
    const binding = await this.deps.prisma.whatsAppSession.upsert({
      where: { organizationId },
      create: {
        organizationId,
        providerSessionName: `flowcare-${crypto.randomUUID()}`,
      },
      update: {},
      select: { providerSessionName: true },
    });

    let session = await this.deps.provider.getSession(
      binding.providerSessionName,
    );
    if (!session) {
      session = await this.deps.provider.createSession(
        binding.providerSessionName,
      );
    } else if (
      session.status !== "WORKING" &&
      session.status !== "SCAN_QR_CODE"
    ) {
      await this.deps.provider.restartSession(binding.providerSessionName);
      session =
        (await this.deps.provider.getSession(binding.providerSessionName)) ??
        session;
    }

    const current = publicSession(session);
    const qr =
      current.status === "QR_CODE_REQUIRED"
        ? await this.deps.provider.getQr(binding.providerSessionName)
        : null;
    const now = this.deps.now?.() ?? new Date();
    return {
      ...current,
      qrCode: qr ? `data:${qr.mimetype};base64,${qr.data}` : null,
      qrExpiresAt: qr
        ? new Date(now.getTime() + QR_TTL_MS).toISOString()
        : null,
    };
  }
}

export function normalizeWahaStatus(status: string): ConnectionStatus {
  switch (status) {
    case "WORKING":
      return "CONNECTED";
    case "SCAN_QR_CODE":
    case "PASSKEY_REQUIRED":
    case "PASSKEY_CONFIRMATION_REQUIRED":
      return "QR_CODE_REQUIRED";
    case "STARTING":
      return "CONNECTING";
    case "STOPPED":
      return "DISCONNECTED";
    default:
      return "ERROR";
  }
}

function publicSession(session: WahaSession) {
  return {
    status: normalizeWahaStatus(session.status),
    phoneNumber: phoneNumberFromProviderId(session.me?.id),
  };
}

function phoneNumberFromProviderId(id: string | null | undefined) {
  if (!id) return null;
  const value = id.split("@")[0]?.replace(/\D/g, "") ?? "";
  return value || null;
}
