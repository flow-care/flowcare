import { revalidatePath } from "next/cache";
import {
  getPatientAttachments,
  PatientsApiError,
  uploadPatientAttachment,
} from "@/server/patients";
import { getSessionToken } from "@/server/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; patientId: string }> },
) {
  const token = await getSessionToken();
  if (!token) {
    return Response.json(
      { message: "Entre novamente para continuar." },
      { status: 401 },
    );
  }

  const { orgSlug, patientId } = await params;
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") ?? undefined;
  const includeArchived = searchParams.get("includeArchived") === "true";

  try {
    const result = await getPatientAttachments(orgSlug, patientId, {
      category,
      includeArchived,
    });
    return Response.json(result);
  } catch (error) {
    if (error instanceof PatientsApiError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : 500;
      return Response.json(
        { message: error.message, code: error.code },
        { status },
      );
    }
    return Response.json(
      { message: "Erro ao buscar anexos." },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; patientId: string }> },
) {
  const token = await getSessionToken();
  if (!token) {
    return Response.json(
      { message: "Entre novamente para continuar." },
      { status: 401 },
    );
  }

  const { orgSlug, patientId } = await params;
  try {
    const formData = await request.formData();
    const result = await uploadPatientAttachment(orgSlug, patientId, formData);
    revalidatePath(`/app/${orgSlug}/patients/${patientId}`);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof PatientsApiError) {
      const status =
        error.code === "VALIDATION_ERROR"
          ? 400
          : error.code === "PAYLOAD_TOO_LARGE"
            ? 413
            : error.code === "FORBIDDEN"
              ? 403
              : error.code === "NOT_FOUND"
                ? 404
                : error.code === "STORAGE_UNAVAILABLE"
                  ? 503
                  : 500;
      return Response.json(
        { message: error.message, code: error.code },
        { status },
      );
    }
    return Response.json(
      { message: "Falha ao enviar anexo." },
      { status: 500 },
    );
  }
}
