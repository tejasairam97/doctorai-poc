import { sendApprovedSummaryEmail } from "@/lib/email";
import { badRequest, ok, serverError } from "@/lib/http";
import {
  createPatientSummaryLinkForVisit,
  getVisit,
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
        purpose: "SUMMARY_LINK",
        providerStatus: "BLOCKED",
        error: "Patient email consent is required before sending a secure summary link."
      });

      return Response.json(
        {
          error: "Patient email consent is required before sending a secure summary link.",
          visit: result.visit,
          emailDeliveryLog: result.emailDeliveryLog
        },
        { status: 403 }
      );
    }

    try {
      if (!visit.approvedSummary) {
        return badRequest("Approve the summary before sending email.");
      }

      const summaryLink = await createPatientSummaryLinkForVisit({ visitId });
      const emailResult = await sendApprovedSummaryEmail({
        recipient: visit.patient.email,
        summaryUrl: summaryLink.url,
        expiresAt: summaryLink.expiresAt
      });

      const result = await recordEmailDelivery({
        visitId,
        recipient: visit.patient.email,
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
    } catch (error) {
      const result = await recordEmailDelivery({
        visitId,
        recipient: visit.patient.email,
        status: "FAILED",
        purpose: "SUMMARY_LINK",
        provider: "ACS_EMAIL",
        providerStatus: "FAILED",
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
