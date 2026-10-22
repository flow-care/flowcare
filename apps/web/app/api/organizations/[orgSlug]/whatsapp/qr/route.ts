import {
  requestWhatsAppQr,
  whatsappErrorBody,
  whatsappErrorHttpStatus,
} from "@/server/whatsapp";

// The QR code is a short-lived credential: it must never be stored by the
// browser or any intermediary, and it is never logged here.
const NO_STORE = { "Cache-Control": "no-store, private, max-age=0" } as const;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;
  try {
    return Response.json(await requestWhatsAppQr(orgSlug), {
      headers: NO_STORE,
    });
  } catch (error) {
    return Response.json(whatsappErrorBody(error), {
      status: whatsappErrorHttpStatus(error),
      headers: NO_STORE,
    });
  }
}
