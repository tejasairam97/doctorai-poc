import { badRequest, ok, serverError } from "@/lib/http";
import { isValidOtpEmail, normalizeOtpEmail } from "@/lib/otp";
import { publicDoctor, verifyDoctorLoginOtp } from "@/lib/store";

const INVALID_DOCTOR_OTP_MESSAGE = "Invalid or expired verification code.";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      code?: string;
    };
    const email = normalizeOtpEmail(body.email || "");
    const code = String(body.code || "").trim();

    if (!isValidOtpEmail(email) || !/^\d{6}$/.test(code)) {
      return badRequest(INVALID_DOCTOR_OTP_MESSAGE);
    }

    const doctor = await verifyDoctorLoginOtp({ email, code });
    if (!doctor) {
      return badRequest(INVALID_DOCTOR_OTP_MESSAGE);
    }

    return ok({
      doctor: publicDoctor(doctor)
    });
  } catch (error) {
    return serverError(error);
  }
}
