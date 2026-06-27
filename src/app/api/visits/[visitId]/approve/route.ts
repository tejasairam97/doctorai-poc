import { badRequest, ok, serverError } from "@/lib/http";
import { approveVisitSummary, updateUnencryptedEmailConsent } from "@/lib/store";

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

    return ok({ visit: approvedVisit });
  } catch (error) {
    if (error instanceof Error && error.message.includes("required before approval")) {
      return badRequest(error.message);
    }
    return serverError(error);
  }
}
