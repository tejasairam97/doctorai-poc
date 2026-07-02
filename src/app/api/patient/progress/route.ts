import type { NextRequest } from "next/server";
import { ok, serverError } from "@/lib/http";
import { PATIENT_SESSION_COOKIE_NAME } from "@/lib/otp";
import { getPatientSessionByToken, listPatientPortalProgress } from "@/lib/store";

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(PATIENT_SESSION_COOKIE_NAME)?.value;
    const patientSession = await getPatientSessionByToken(token);
    if (!patientSession) {
      return Response.json({ error: "Patient session required." }, { status: 401 });
    }

    const progress = await listPatientPortalProgress(patientSession.email);
    return ok({ progress });
  } catch (error) {
    return serverError(error);
  }
}
