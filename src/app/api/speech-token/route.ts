import { getSpeechConfigStatus, issueSpeechToken } from "@/lib/azure-speech";
import { badRequest, ok, serverError } from "@/lib/http";
import { INPUT_MODES, type InputMode } from "@/lib/status";
import { logTranscriptionAttempt } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      doctorId?: string;
      visitId?: string;
      inputModeActual?: InputMode;
    };

    if (!body.doctorId || !body.visitId) {
      return badRequest("doctorId and visitId are required.");
    }

    if (!INPUT_MODES.includes((body.inputModeActual ?? "DOCTOR_SELF_SUMMARY") as InputMode)) {
      return badRequest("Invalid input mode.");
    }

    const inputModeActual = body.inputModeActual ?? "DOCTOR_SELF_SUMMARY";
    const config = getSpeechConfigStatus();

    if (!config.configured) {
      await logTranscriptionAttempt({
        doctorId: body.doctorId,
        visitId: body.visitId,
        inputModeActual,
        status: "CONFIG_MISSING",
        reason: config.missing.key ? "missing_key" : config.missing.endpoint ? "missing_endpoint" : "missing_region"
      });

      return Response.json(
        {
          error: "Azure Speech is not configured.",
          retryable: true,
          missing: config.missing
        },
        { status: 503 }
      );
    }

    try {
      const token = await issueSpeechToken();
      await logTranscriptionAttempt({
        doctorId: body.doctorId,
        visitId: body.visitId,
        inputModeActual,
        status: "TOKEN_ISSUED"
      });
      return ok({ ...token, provider: "AZURE_SPEECH" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Azure Speech token request failed.";
      await logTranscriptionAttempt({
        doctorId: body.doctorId,
        visitId: body.visitId,
        inputModeActual,
        status: "TOKEN_FAILED",
        reason: message
      });
      return Response.json(
        {
          error: message,
          retryable: true
        },
        { status: 503 }
      );
    }
  } catch (error) {
    return serverError(error);
  }
}
