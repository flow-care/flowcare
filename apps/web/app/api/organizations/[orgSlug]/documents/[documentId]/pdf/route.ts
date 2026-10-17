import { getServerConfig } from "@/server/config";
import { getSessionToken } from "@/server/session";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      orgSlug: string;
      documentId: string;
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

  const { orgSlug, documentId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const isDownload =
    searchParams.get("download") === "true" ||
    searchParams.get("download") === "1";

  const { apiBaseUrl } = getServerConfig();
  const url = `${apiBaseUrl}/organizations/${encodeURIComponent(orgSlug)}/documents/${encodeURIComponent(documentId)}/pdf`;

  try {
    const apiResponse = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!apiResponse.ok) {
      let errorBody: unknown;
      try {
        errorBody = await apiResponse.json();
      } catch {
        errorBody = { message: "Erro ao carregar PDF do documento." };
      }
      return Response.json(errorBody, { status: apiResponse.status });
    }

    const pdfBuffer = await apiResponse.arrayBuffer();
    const disposition = isDownload
      ? `attachment; filename="documento-${documentId}.pdf"`
      : `inline; filename="documento-${documentId}.pdf"`;

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": disposition,
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (error) {
    return Response.json(
      {
        message: "Não foi possível obter o PDF do documento.",
        error: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 },
    );
  }
}
