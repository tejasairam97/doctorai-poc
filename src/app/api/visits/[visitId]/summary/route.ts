import { generateDraftSummary } from "@/lib/azure-openai";
import { badRequest, ok, serverError } from "@/lib/http";
import { getVisit, logUsageEvent, saveDraftSummary } from "@/lib/store";

export async function POST(
  _request: Request,
  context: { params: Promise<{ visitId: string }> }
) {
  try {
    const { visitId } = await context.params;
    const visit = await getVisit(visitId);
    if (!visit) return badRequest("Visit not found.");
    if (visit.approvedSummary) return badRequest("Approved visits cannot regenerate draft summaries.");

    const transcriptText = visit.transcriptText.trim();
    if (!transcriptText) {
      return badRequest("Add transcript or doctor self-summary text before generating a summary.");
    }

    try {
      const result = await generateDraftSummary({
        transcriptText,
        inputModeActual: visit.inputModeActual
      });

      const updatedVisit = await saveDraftSummary({
        visitId: visit.id,
        normalizedTranscriptText: result.normalizedTranscript,
        draftSummary: result.summary,
        provider: result.provider,
        simulated: result.simulated
      });

      return ok({
        visit: updatedVisit,
        provider: result.provider,
        simulated: result.simulated
      });
    } catch (error) {
      await logUsageEvent({
        doctorId: visit.doctorId,
        visitId: visit.id,
        type: "SUMMARY_GENERATION_FAILED",
        metadata: {
          inputModeActual: visit.inputModeActual,
          reason: error instanceof Error ? error.message : "Unknown summary generation failure"
        }
      });
      throw error;
    }
  } catch (error) {
    return serverError(error);
  }
}
