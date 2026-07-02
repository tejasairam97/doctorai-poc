import { sendOtpEmail } from "@/lib/email";
import { badRequest, ok, serverError } from "@/lib/http";
import {
  isOtpRoleContext,
  isValidOtpEmail,
  normalizeOtpEmail,
  OTP_EXPIRES_IN_MINUTES,
  purposeForRoleContext
} from "@/lib/otp";
import { createLoginOtpChallenge } from "@/lib/store";

const GENERIC_OTP_REQUEST_MESSAGE = "If the email is eligible, a verification code has been sent.";

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
      role_context?: string;
      roleContext?: string;
    };

    const email = normalizeOtpEmail(body.email || "");
    const roleContext = body.role_context ?? body.roleContext;

    if (!isValidOtpEmail(email) || !isOtpRoleContext(roleContext)) {
      return badRequest("A valid email and role_context are required.");
    }

    const challenge = await createLoginOtpChallenge({
      email,
      roleContext,
      purpose: purposeForRoleContext(roleContext),
      requestIp: clientIpFromRequest(request),
      userAgent: request.headers.get("user-agent")
    });

    if (challenge.code) {
      await sendOtpEmail({
        recipient: email,
        code: challenge.code,
        roleContext,
        expiresInMinutes: OTP_EXPIRES_IN_MINUTES
      }).catch((error) => {
        console.warn(
          "[DoctorAI OTP email delivery failed]",
          error instanceof Error ? error.message : "Unknown OTP email delivery failure"
        );
      });
    }

    return ok({
      ok: true,
      message: GENERIC_OTP_REQUEST_MESSAGE
    });
  } catch (error) {
    return serverError(error);
  }
}
