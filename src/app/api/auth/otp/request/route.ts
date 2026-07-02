import { sendAndLogOtpEmail } from "@/lib/auth-email";
import { badRequest, ok, serverError } from "@/lib/http";
import { isValidOtpEmail, normalizeOtpEmail, purposeForRoleContext } from "@/lib/otp";
import { createDoctorLoginOtpChallenge } from "@/lib/store";

const GENERIC_DOCTOR_OTP_MESSAGE = "If an account exists, check your email for a verification code.";

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
      await sendAndLogOtpEmail({
        recipient: email,
        code: challenge.code,
        roleContext: "doctor",
        purpose: purposeForRoleContext("doctor"),
        doctorId: challenge.doctor.id
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
