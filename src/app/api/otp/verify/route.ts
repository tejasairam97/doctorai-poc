import { ok, serverError } from "@/lib/http";
import {
  isOtpRoleContext,
  isValidOtpEmail,
  normalizeOtpEmail,
  PATIENT_SESSION_COOKIE_NAME,
  PATIENT_SESSION_EXPIRES_IN_SECONDS,
  purposeForRoleContext
} from "@/lib/otp";
import { verifyLoginOtp } from "@/lib/store";

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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      role_context?: string;
      roleContext?: string;
      code?: string;
    };

    const email = normalizeOtpEmail(body.email || "");
    const roleContext = body.role_context ?? body.roleContext;
    const code = String(body.code || "").trim();

    if (!isValidOtpEmail(email) || !isOtpRoleContext(roleContext) || !/^\d{6}$/.test(code)) {
      return Response.json({ error: INVALID_OTP_MESSAGE }, { status: 400 });
    }

    const result = await verifyLoginOtp({
      email,
      roleContext,
      purpose: purposeForRoleContext(roleContext),
      code
    });

    if (!result.verified) {
      return Response.json({ error: INVALID_OTP_MESSAGE }, { status: 400 });
    }

    const response = ok({
      verified: true,
      roleContext,
      patientSession: result.patientSession
    });

    if (roleContext === "patient" && result.patientSessionToken) {
      response.cookies.set(PATIENT_SESSION_COOKIE_NAME, result.patientSessionToken, patientSessionCookieOptions());
    }

    return response;
  } catch (error) {
    return serverError(error);
  }
}
