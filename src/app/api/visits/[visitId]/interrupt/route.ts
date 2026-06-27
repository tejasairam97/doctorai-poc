import { badRequest, ok, serverError } from "@/lib/http";
import { INPUT_MODES, type InputMode } from "@/lib/status";
import { markVisitInterrupted } from "@/lib/store";

export async function POST(
  request: Request,
  context: { params: Promise<{ visitId: string }> }
) {
  try {
    const { visitId } = await context.params;
    const body = (await request.json()) as {
      reason?: string;
      transcriptText?: string;
      inputModeActual?: InputMode;
    };

    if (typeof body.transcriptText !== "string") {
      return badRequest("transcriptText is required.");
    }

    if (!INPUT_MODES.includes((body.inputModeActual ?? "DOCTOR_SELF_SUMMARY") as InputMode)) {
      return badRequest("Invalid input mode.");
    }

    const visit = await markVisitInterrupted({
      visitId,
      reason: body.reason || "risk_event",
      transcriptText: body.transcriptText,
      inputModeActual: body.inputModeActual ?? "DOCTOR_SELF_SUMMARY"
    });

    return ok({ visit });
  } catch (error) {
    return serverError(error);
  }
}
