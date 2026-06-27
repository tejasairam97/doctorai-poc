import { badRequest, ok, serverError } from "@/lib/http";
import { INPUT_MODES, type InputMode } from "@/lib/status";
import { resumeVisit } from "@/lib/store";

export async function POST(
  request: Request,
  context: { params: Promise<{ visitId: string }> }
) {
  try {
    const { visitId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      inputModeActual?: InputMode;
    };

    if (!INPUT_MODES.includes((body.inputModeActual ?? "LIVE_CONVERSATION") as InputMode)) {
      return badRequest("Invalid input mode.");
    }

    const visit = await resumeVisit(visitId, body.inputModeActual ?? "LIVE_CONVERSATION");
    return ok({ visit });
  } catch (error) {
    return serverError(error);
  }
}
