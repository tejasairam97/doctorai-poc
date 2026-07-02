import { badRequest, ok, serverError } from "@/lib/http";
import { isValidOtpEmail, normalizeOtpEmail } from "@/lib/otp";
import { publicDoctor, resetDoctorPasswordWithOtp } from "@/lib/store";

const INVALID_RESET_MESSAGE = "Invalid or expired reset code.";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      code?: string;
      password?: string;
    };
    const email = normalizeOtpEmail(body.email || "");
    const code = String(body.code || "").trim();
    const password = String(body.password || "");

    if (!isValidOtpEmail(email) || !/^\d{6}$/.test(code)) {
      return badRequest(INVALID_RESET_MESSAGE);
    }

    if (password.length < 6) {
      return badRequest("Password must be at least 6 characters.");
    }

    const doctor = await resetDoctorPasswordWithOtp({ email, code, password });
    if (!doctor) {
      return badRequest(INVALID_RESET_MESSAGE);
    }

    return ok({
      doctor: publicDoctor(doctor),
      message: "Password reset. You are signed in."
    });
  } catch (error) {
    return serverError(error);
  }
}
