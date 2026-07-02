import { sendOtpEmail } from "./email";
import { OTP_EXPIRES_IN_MINUTES, type OtpPurpose, type OtpRoleContext } from "./otp";
import { recordAuthEmailDelivery } from "./store";

function maskEmailForLog(email: string) {
  const [localPart = "", domainPart = ""] = email.trim().toLowerCase().split("@");
  const maskedLocal =
    localPart.length <= 2
      ? `${localPart.slice(0, 1) || "*"}***`
      : `${localPart.slice(0, 1)}***${localPart.slice(-1)}`;
  return `${maskedLocal}@${domainPart || "unknown"}`;
}

function sanitizeEmailError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown OTP email delivery failure";
  return message.replace(/[A-Za-z0-9+/=_-]{32,}/g, "[redacted]").slice(0, 240);
}

function statusPrefix(input: { roleContext: OtpRoleContext; purpose: OtpPurpose }) {
  if (input.purpose === "password_reset") return "PASSWORD_RESET_OTP";
  return input.roleContext === "doctor" ? "DOCTOR_OTP" : "PATIENT_OTP";
}

export async function sendAndLogOtpEmail(input: {
  recipient: string;
  code: string;
  roleContext: OtpRoleContext;
  purpose: OtpPurpose;
  doctorId?: string | null;
}) {
  const prefix = statusPrefix(input);

  try {
    const result = await sendOtpEmail({
      recipient: input.recipient,
      code: input.code,
      roleContext: input.roleContext,
      purpose: input.purpose,
      expiresInMinutes: OTP_EXPIRES_IN_MINUTES
    });

    const status = result.status === "SIMULATED" ? `${prefix}_SIMULATED` : `${prefix}_SENT`;
    await recordAuthEmailDelivery({
      doctorId: input.doctorId,
      recipient: input.recipient,
      status,
      providerId: result.providerId,
      eventType: "AUTH_OTP_EMAIL_DELIVERY"
    });

    console.info("[DoctorAI OTP email delivery]", {
      status,
      roleContext: input.roleContext,
      purpose: input.purpose,
      doctorId: input.doctorId ?? null,
      recipient: maskEmailForLog(input.recipient)
    });

    return { ok: true as const, status, providerId: result.providerId };
  } catch (error) {
    const safeError = sanitizeEmailError(error);
    const status = `${prefix}_FAILED`;

    await recordAuthEmailDelivery({
      doctorId: input.doctorId,
      recipient: input.recipient,
      status,
      error: safeError,
      eventType: "AUTH_OTP_EMAIL_DELIVERY"
    }).catch((logError) => {
      console.warn(
        "[DoctorAI OTP email delivery log failed]",
        logError instanceof Error ? sanitizeEmailError(logError) : "Unknown OTP email log failure"
      );
    });

    console.warn("[DoctorAI OTP email delivery failed]", {
      status,
      roleContext: input.roleContext,
      purpose: input.purpose,
      doctorId: input.doctorId ?? null,
      recipient: maskEmailForLog(input.recipient),
      error: safeError
    });

    return { ok: false as const, status, error: safeError };
  }
}
