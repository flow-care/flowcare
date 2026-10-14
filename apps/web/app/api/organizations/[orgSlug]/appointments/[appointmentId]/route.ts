import { getAppointmentDetails } from "@/server/appointments";
import { getSessionToken } from "@/server/session";

export async function GET(
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
  const url = new URL(request.url);
  const hintDate = url.searchParams.get("date") ?? undefined;

  const details = await getAppointmentDetails(orgSlug, appointmentId, {
    hintDate,
  });

  if (!details) {
    return Response.json(
      { message: "Agendamento não encontrado." },
      { status: 404 },
    );
  }

  return Response.json(details);
}
