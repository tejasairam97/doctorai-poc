import type { NextRequest } from "next/server";
import { ok, serverError } from "@/lib/http";
import { PATIENT_SESSION_COOKIE_NAME } from "@/lib/otp";
import { revokePatientSessionByToken } from "@/lib/store";

function expiredPatientSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  };
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(PATIENT_SESSION_COOKIE_NAME)?.value;
    await revokePatientSessionByToken(token);
    const response = ok({ ok: true });
    response.cookies.set(PATIENT_SESSION_COOKIE_NAME, "", expiredPatientSessionCookieOptions());
    return response;
  } catch (error) {
    return serverError(error);
  }
}
