import {
  getWhatsAppStatus,
  whatsappErrorBody,
  whatsappErrorHttpStatus,
} from "@/server/whatsapp";

const NO_STORE = { "Cache-Control": "no-store, private, max-age=0" } as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const { orgSlug } = await params;
  try {
    return Response.json(await getWhatsAppStatus(orgSlug), {
      headers: NO_STORE,
    });
  } catch (error) {
    return Response.json(whatsappErrorBody(error), {
      status: whatsappErrorHttpStatus(error),
      headers: NO_STORE,
    });
  }
}
