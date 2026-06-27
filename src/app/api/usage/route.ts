import { ok, serverError } from "@/lib/http";
import { getDoctorById, listInternalUsageEvents } from "@/lib/store";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const doctorId = searchParams.get("doctorId");
    if (!doctorId) {
      return Response.json({ error: "doctorId is required." }, { status: 400 });
    }

    const doctor = await getDoctorById(doctorId);
    if (!doctor?.email.endsWith("@doctorai.local")) {
      return Response.json({ error: "Internal usage is restricted." }, { status: 403 });
    }

    const limit = Number(searchParams.get("limit") || 25);
    const usageEvents = await listInternalUsageEvents(Number.isFinite(limit) ? limit : 25);
    return ok({ usageEvents });
  } catch (error) {
    return serverError(error);
  }
}
