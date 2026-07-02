import { sendDoctorTestEmail, getEmailConfigStatus } from "@/lib/email";
import { badRequest, ok, serverError } from "@/lib/http";
import { getDoctorById, recordDoctorEmailDelivery } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      doctorId?: string;
    };

    if (!body.doctorId) {
      return badRequest("doctorId is required.");
    }

    const doctor = await getDoctorById(body.doctorId);
    if (!doctor) {
      return badRequest("Doctor not found.");
    }

    const config = getEmailConfigStatus();

    try {
      const emailResult = await sendDoctorTestEmail({
        doctorName: doctor.name,
        recipient: doctor.email
      });
      const result = await recordDoctorEmailDelivery({
        doctorId: doctor.id,
        recipient: doctor.email,
        status: emailResult.status,
        purpose: "DOCTOR_TEST_EMAIL",
        provider: emailResult.provider,
        providerStatus: emailResult.providerStatus,
        messageId: emailResult.messageId,
        providerId: emailResult.providerId
      });

      return ok({
        emailDeliveryLog: result.emailDeliveryLog,
        emailSimulated: emailResult.status === "SIMULATED",
        acsConfigured: config.configured
      });
    } catch (error) {
      const result = await recordDoctorEmailDelivery({
        doctorId: doctor.id,
        recipient: doctor.email,
        status: "FAILED",
        purpose: "DOCTOR_TEST_EMAIL",
        provider: "ACS_EMAIL",
        providerStatus: "FAILED",
        error: error instanceof Error ? error.message : "Email delivery failed."
      });

      return ok({
        emailDeliveryLog: result.emailDeliveryLog,
        acsConfigured: config.configured,
        emailError: "Email failed. Check ACS Email configuration and sender/domain verification."
      });
    }
  } catch (error) {
    return serverError(error);
  }
}
