import { badRequest, ok, serverError } from "@/lib/http";
import { getVisit } from "@/lib/store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ visitId: string }> }
) {
  try {
    const { visitId } = await context.params;
    const visit = await getVisit(visitId);
    if (!visit) return badRequest("Visit not found.");
    return ok({ visit });
  } catch (error) {
    return serverError(error);
  }
}
