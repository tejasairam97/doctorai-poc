import type { NextRequest } from "next/server";
import { ok, serverError } from "@/lib/http";
import { PATIENT_SESSION_COOKIE_NAME } from "@/lib/otp";
import { getPatientSessionByToken } from "@/lib/store";

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(PATIENT_SESSION_COOKIE_NAME)?.value;
    const patientSession = await getPatientSessionByToken(token);
    return ok({ patientSession });
  } catch (error) {
    return serverError(error);
  }
}
