import { badRequest, ok, serverError } from "@/lib/http";
import { getPatientHistoryForDoctor } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const doctorId = searchParams.get("doctorId");
    const patientEmail = searchParams.get("patientEmail") || searchParams.get("email");
    const currentVisitId = searchParams.get("currentVisitId");

    if (!doctorId || !patientEmail) {
      return badRequest("doctorId and patientEmail are required.");
    }

    const normalizedPatientEmail = patientEmail.trim().toLowerCase();
    if (!normalizedPatientEmail.includes("@")) {
      return badRequest("A valid patient email is required.");
    }

    const history = await getPatientHistoryForDoctor({
      doctorId,
      patientEmail: normalizedPatientEmail,
      currentVisitId
    });

    return ok({ history });
  } catch (error) {
    return serverError(error);
  }
}
