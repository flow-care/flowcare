import { AppointmentsApiError, cancelAppointment } from "@/server/appointments";
import { getSessionToken } from "@/server/session";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; appointmentId: string }> },
) {
  if (!(await getSessionToken())) {
    return Response.json(
      { message: "Entre novamente para continuar." },
      { status: 401 },
    );
  }

  const { orgSlug, appointmentId } = await params;
  try {
    const body = await request.json();
    const result = await cancelAppointment(orgSlug, appointmentId, body);
    return Response.json(result);
  } catch (error) {
    if (error instanceof AppointmentsApiError) {
      const status =
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "INVALID_STATE_TRANSITION" ||
              error.code === "VERSION_CONFLICT"
            ? 409
            : error.code === "FORBIDDEN"
              ? 403
              : error.code === "VALIDATION_ERROR"
                ? 400
                : 500;
      return Response.json(
        { message: error.message, code: error.code },
        { status },
      );
    }
    return Response.json(
      { message: "Falha ao cancelar o agendamento." },
      { status: 500 },
    );
  }
}
