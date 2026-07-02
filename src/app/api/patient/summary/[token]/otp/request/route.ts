import { sendOtpEmail } from "@/lib/email";
import { ok, serverError } from "@/lib/http";
import { OTP_EXPIRES_IN_MINUTES, purposeForRoleContext } from "@/lib/otp";
import { createLoginOtpChallenge, getPatientSummaryLinkOtpTarget } from "@/lib/store";

const GENERIC_OTP_REQUEST_MESSAGE = "If this secure link is valid, a verification code has been sent.";

function clientIpFromRequest(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    null
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const target = await getPatientSummaryLinkOtpTarget(token);

    if (target.status !== "ready") {
      return ok({
        ok: true,
        message: GENERIC_OTP_REQUEST_MESSAGE,
        linkStatus: target.status
      });
    }

    const challenge = await createLoginOtpChallenge({
      email: target.patientEmail,
      roleContext: "patient",
      purpose: purposeForRoleContext("patient"),
      requestIp: clientIpFromRequest(request),
      userAgent: request.headers.get("user-agent")
    });

    if (challenge.code) {
      await sendOtpEmail({
        recipient: target.patientEmail,
        code: challenge.code,
        roleContext: "patient",
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES
      }).catch((error) => {
        console.warn(
          "[DoctorAI secure summary OTP email delivery failed]",
          error instanceof Error ? error.message : "Unknown OTP email delivery failure"
        );
      });
    }

    return ok({
      ok: true,
      message: GENERIC_OTP_REQUEST_MESSAGE,
      maskedPatientEmail: target.maskedPatientEmail
    });
  } catch (error) {
    return serverError(error);
  }
}
