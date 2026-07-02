import { badRequest, ok, serverError } from "@/lib/http";
import { CONSENT_STATUSES, INPUT_MODES, type ConsentStatus, type InputMode } from "@/lib/status";
import { createDraftVisit, listVisits } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const doctorId = searchParams.get("doctorId");
    if (!doctorId) return badRequest("doctorId is required.");
    return ok({ visits: await listVisits(doctorId) });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      doctorId?: string;
      patientName?: string;
      patientAge?: number;
      patientEmail?: string;
      patientPhone?: string;
      consentStatus?: ConsentStatus;
      inputModeRequested?: InputMode;
    };

    if (!body.doctorId || !body.patientName || !body.patientAge || !body.patientEmail) {
      return badRequest("Doctor and patient details are required.");
    }

    if (!CONSENT_STATUSES.includes((body.consentStatus ?? "UNKNOWN") as ConsentStatus)) {
      return badRequest("Invalid consent status.");
    }

    if (!INPUT_MODES.includes((body.inputModeRequested ?? "DOCTOR_SELF_SUMMARY") as InputMode)) {
      return badRequest("Invalid input mode.");
    }

    const patientEmail = body.patientEmail.trim().toLowerCase();

    const visit = await createDraftVisit({
      doctorId: body.doctorId,
      patient: {
        name: body.patientName,
        age: Number(body.patientAge),
        email: patientEmail,
        phone: body.patientPhone
      },
      consentStatus: body.consentStatus ?? "UNKNOWN",
      inputModeRequested: body.inputModeRequested ?? "DOCTOR_SELF_SUMMARY"
    });

    return ok({ visit }, 201);
  } catch (error) {
    return serverError(error);
  }
}
