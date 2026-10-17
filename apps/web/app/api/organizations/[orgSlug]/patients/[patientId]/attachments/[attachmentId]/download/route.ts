import { getAttachmentDownloadUrl, PatientsApiError } from "@/server/patients";
import { getSessionToken } from "@/server/session";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      orgSlug: string;
      patientId: string;
      attachmentId: string;
    }>;
  },
) {
  const token = await getSessionToken();
  if (!token) {
    return Response.json(
      { message: "Entre novamente para continuar." },
      { status: 401 },
    );
  }

  const { orgSlug, patientId, attachmentId } = await params;
  try {
    const result = await getAttachmentDownloadUrl(
      orgSlug,
      patientId,
      attachmentId,
    );
    const accept = request.headers.get("accept") ?? "";
    const redirectParam = new URL(request.url).searchParams.get("redirect");

    if (
      redirectParam === "true" ||
      (!accept.includes("application/json") && accept.includes("text/html"))
    ) {
      return Response.redirect(result.downloadUrl, 302);
    }

    return Response.json(result);
  } catch (error) {
    if (error instanceof PatientsApiError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : error.code === "STORAGE_UNAVAILABLE"
              ? 503
              : 500;
      return Response.json(
        { message: error.message, code: error.code },
        { status },
      );
    }
    return Response.json(
      { message: "Falha ao obter URL de download." },
      { status: 500 },
    );
  }
}
