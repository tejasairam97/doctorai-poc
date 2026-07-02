import { sendApprovedSummaryEmail } from "@/lib/email";
import { badRequest, ok, serverError } from "@/lib/http";
import {
  approveVisitSummary,
  createPatientSummaryLinkForVisit,
  generateOrUpdatePatientProgressSummaryForDoctor,
  recordEmailDelivery,
  updateUnencryptedEmailConsent
} from "@/lib/store";

type EmailConsentStatus = "APPROVED" | "DECLINED" | "NOT_ASKED";

function isEmailConsentStatus(value: unknown): value is EmailConsentStatus {
  return value === "APPROVED" || value === "DECLINED" || value === "NOT_ASKED";
}

export async function POST(
  request: Request,
  context: { params: Promise<{ visitId: string }> }
) {
  try {
    const { visitId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      approvedSummary?: string;
      unencryptedEmailConsentStatus?: EmailConsentStatus;
    };

    let approvedVisit = await approveVisitSummary({
      visitId,
      approvedSummary: body.approvedSummary
    });

    if (isEmailConsentStatus(body.unencryptedEmailConsentStatus)) {
      approvedVisit = await updateUnencryptedEmailConsent({
        visitId,
        consentStatus: body.unencryptedEmailConsentStatus
      });
    }

    await generateOrUpdatePatientProgressSummaryForDoctor({
      doctorId: approvedVisit.doctorId,
      patientEmail: approvedVisit.patient.email
    }).catch((error) => {
      console.warn("[DoctorAI patient progress cache update failed]", error);
    });

    if (approvedVisit.unencryptedEmailConsentStatus !== "APPROVED") {
      return ok({
        visit: approvedVisit,
        emailSkipped: true,
        emailMessage: "Summary approved. Secure link was not emailed because patient email consent is not approved."
      });
    }

    try {
      const summaryLink = await createPatientSummaryLinkForVisit({ visitId });
      const emailResult = await sendApprovedSummaryEmail({
        recipient: approvedVisit.patient.email,
        summaryUrl: summaryLink.url,
        expiresAt: summaryLink.expiresAt
      });

      const result = await recordEmailDelivery({
        visitId,
        recipient: approvedVisit.patient.email,
        status: emailResult.status,
        purpose: "SUMMARY_LINK",
        provider: emailResult.provider,
        providerStatus: emailResult.providerStatus,
        messageId: emailResult.messageId,
        providerId: emailResult.providerId
      });

      return ok({
        visit: result.visit,
        emailDeliveryLog: result.emailDeliveryLog,
        emailSimulated: emailResult.status === "SIMULATED"
      });
    } catch (emailError) {
      const failureMessage =
        emailError instanceof Error ? emailError.message : "Email delivery failed.";

      const failedDelivery = await recordEmailDelivery({
        visitId,
        recipient: approvedVisit.patient.email,
        status: "FAILED",
        purpose: "SUMMARY_LINK",
        provider: "ACS_EMAIL",
        providerStatus: "FAILED",
        error: failureMessage
      }).catch((loggingError) => {
        console.warn("[DoctorAI email failure log failed]", loggingError);
        return null;
      });

      return ok({
        visit: failedDelivery?.visit ?? approvedVisit,
        emailDeliveryLog: failedDelivery?.emailDeliveryLog,
        emailError: "Summary approved, but secure link email failed."
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("required before approval")) {
      return badRequest(error.message);
    }
    return serverError(error);
  }
}
