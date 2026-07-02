import { sendOtpEmail } from "@/lib/email";
import { badRequest, ok, serverError } from "@/lib/http";
import { isValidOtpEmail, normalizeOtpEmail, OTP_EXPIRES_IN_MINUTES } from "@/lib/otp";
import { createDoctorLoginOtpChallenge } from "@/lib/store";

const GENERIC_DOCTOR_OTP_MESSAGE = "If an account exists, a code has been sent.";

function clientIpFromRequest(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    null
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
    };
    const email = normalizeOtpEmail(body.email || "");

    if (!isValidOtpEmail(email)) {
      return badRequest("Enter a valid doctor email.");
    }

    const challenge = await createDoctorLoginOtpChallenge({
      email,
      requestIp: clientIpFromRequest(request),
      userAgent: request.headers.get("user-agent")
    });

    if (challenge.accountExists && challenge.code) {
      await sendOtpEmail({
        recipient: email,
        code: challenge.code,
        roleContext: "doctor",
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES
      }).catch((error) => {
        console.warn(
          "[DoctorAI doctor OTP email delivery failed]",
          error instanceof Error ? error.message : "Unknown doctor OTP email delivery failure"
        );
      });
    }

    return ok({
      ok: true,
      message: GENERIC_DOCTOR_OTP_MESSAGE
    });
  } catch (error) {
    return serverError(error);
  }
}
