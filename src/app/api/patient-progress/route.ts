import { badRequest, ok, serverError } from "@/lib/http";
import {
  generateOrUpdatePatientProgressSummaryForDoctor,
  getPatientProgressSummaryForDoctor
} from "@/lib/store";

function readProgressParams(request: Request) {
  const { searchParams } = new URL(request.url);
  const doctorId = searchParams.get("doctorId");
  const patientEmail = searchParams.get("patientEmail") || searchParams.get("email");
  return { doctorId, patientEmail };
}

function validateProgressParams(input: { doctorId: string | null; patientEmail: string | null }) {
  if (!input.doctorId || !input.patientEmail) {
    return "doctorId and patientEmail are required.";
  }

  if (!input.patientEmail.trim().includes("@")) {
    return "A valid patient email is required.";
  }

  return "";
}

export async function GET(request: Request) {
  try {
    const params = readProgressParams(request);
    const validationError = validateProgressParams(params);
    if (validationError) return badRequest(validationError);

    const progressSummary = await getPatientProgressSummaryForDoctor({
      doctorId: params.doctorId!,
      patientEmail: params.patientEmail!
    });

    return ok({ progressSummary });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  try {
    const queryParams = readProgressParams(request);
    const body = (await request.json().catch(() => ({}))) as {
      doctorId?: string;
      patientEmail?: string;
      email?: string;
    };
    const params = {
      doctorId: body.doctorId || queryParams.doctorId,
      patientEmail: body.patientEmail || body.email || queryParams.patientEmail
    };

    const validationError = validateProgressParams(params);
    if (validationError) return badRequest(validationError);

    const progressSummary = await generateOrUpdatePatientProgressSummaryForDoctor({
      doctorId: params.doctorId!,
      patientEmail: params.patientEmail!
    });

    if (!progressSummary) {
      return ok({
        progressSummary: null,
        message: "Progress Summary requires at least 2 approved visits for this patient."
      });
    }

    return ok({ progressSummary });
  } catch (error) {
    return serverError(error);
  }
}
