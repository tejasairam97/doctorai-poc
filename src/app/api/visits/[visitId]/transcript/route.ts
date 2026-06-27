import { badRequest, ok, serverError } from "@/lib/http";
import { INPUT_MODES, type InputMode } from "@/lib/status";
import { saveVisitTranscript } from "@/lib/store";

export async function POST(
  request: Request,
  context: { params: Promise<{ visitId: string }> }
) {
  try {
    const { visitId } = await context.params;
    const body = (await request.json()) as {
      transcriptText?: string;
      inputModeActual?: InputMode;
      status?: string;
    };

    if (typeof body.transcriptText !== "string") {
      return badRequest("transcriptText is required.");
    }

    if (!INPUT_MODES.includes((body.inputModeActual ?? "DOCTOR_SELF_SUMMARY") as InputMode)) {
      return badRequest("Invalid input mode.");
    }

    const visit = await saveVisitTranscript({
      visitId,
      transcriptText: body.transcriptText,
      inputModeActual: body.inputModeActual ?? "DOCTOR_SELF_SUMMARY",
      status: body.status
    });

    return ok({ visit });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Approved visits cannot be edited")) {
      return badRequest(error.message);
    }
    return serverError(error);
  }
}
