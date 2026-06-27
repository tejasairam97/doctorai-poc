import { sendApprovedSummaryEmail } from "@/lib/email";
import { badRequest, ok, serverError } from "@/lib/http";
import { getVisit, recordEmailDelivery, updateUnencryptedEmailConsent } from "@/lib/store";

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
      unencryptedEmailConsentStatus?: EmailConsentStatus;
    };

    const requestedConsentStatus = isEmailConsentStatus(body.unencryptedEmailConsentStatus)
      ? body.unencryptedEmailConsentStatus
      : "NOT_ASKED";

    let visit = await getVisit(visitId);
    if (!visit) return badRequest("Visit not found.");

    if (!visit.approvedSummary) {
      return badRequest("Approve the summary before sending email.");
    }

    if (requestedConsentStatus !== visit.unencryptedEmailConsentStatus) {
      visit = await updateUnencryptedEmailConsent({
        visitId,
        consentStatus: requestedConsentStatus
      });
    }

    if (visit.unencryptedEmailConsentStatus !== "APPROVED") {
      const result = await recordEmailDelivery({
        visitId,
        recipient: visit.patient.email,
        status: "BLOCKED",
        error: "Patient consent is required before sending unencrypted PHI via email."
      });

      return Response.json(
        {
          error: "Patient consent is required before sending unencrypted PHI via email.",
          visit: result.visit,
          emailDeliveryLog: result.emailDeliveryLog
        },
        { status: 403 }
      );
    }

    try {
      const approvedSummary = visit.approvedSummary;
      if (!approvedSummary) {
        return badRequest("Approve the summary before sending email.");
      }

      const emailResult = await sendApprovedSummaryEmail({
        patientName: visit.patient.name,
        recipient: visit.patient.email,
        approvedSummary
      });

      const result = await recordEmailDelivery({
        visitId,
        recipient: visit.patient.email,
        status: emailResult.status,
        providerId: emailResult.providerId
      });

      return ok({
        visit: result.visit,
        emailDeliveryLog: result.emailDeliveryLog,
        emailSimulated: emailResult.status === "SIMULATED"
      });
    } catch (error) {
      const result = await recordEmailDelivery({
        visitId,
        recipient: visit.patient.email,
        status: "FAILED",
        error: error instanceof Error ? error.message : "Email delivery failed."
      });

      return ok({
        visit: result.visit,
        emailDeliveryLog: result.emailDeliveryLog,
        emailError: "Email delivery failed. The summary remains approved."
      });
    }
  } catch (error) {
    return serverError(error);
  }
}
