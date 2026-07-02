import { ok, serverError } from "@/lib/http";
import {
  PATIENT_SESSION_COOKIE_NAME,
  PATIENT_SESSION_EXPIRES_IN_SECONDS,
  purposeForRoleContext
} from "@/lib/otp";
import { getPatientSummaryLinkOtpTarget, verifyLoginOtp } from "@/lib/store";

const INVALID_OTP_MESSAGE = "Invalid or expired verification code.";

function patientSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: PATIENT_SESSION_EXPIRES_IN_SECONDS
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      code?: string;
    };
    const code = String(body.code || "").trim();

    if (!/^\d{6}$/.test(code)) {
      return Response.json({ error: INVALID_OTP_MESSAGE }, { status: 400 });
    }

    const target = await getPatientSummaryLinkOtpTarget(token);
    if (target.status !== "ready") {
      return Response.json({ error: INVALID_OTP_MESSAGE }, { status: 400 });
    }

    const result = await verifyLoginOtp({
      email: target.patientEmail,
      roleContext: "patient",
      purpose: purposeForRoleContext("patient"),
      code
    });

    if (!result.verified || !result.patientSessionToken) {
      return Response.json({ error: INVALID_OTP_MESSAGE }, { status: 400 });
    }

    const response = ok({
      verified: true,
      redirectToSummary: true
    });
    response.cookies.set(PATIENT_SESSION_COOKIE_NAME, result.patientSessionToken, patientSessionCookieOptions());

    return response;
  } catch (error) {
    return serverError(error);
  }
}
