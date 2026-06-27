import { NextResponse } from "next/server";
import { ServerConfigError } from "./server-config";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serverError(error: unknown) {
  if (error instanceof ServerConfigError) {
    console.error("[DoctorAI configuration error]", error.message);
    return NextResponse.json(
      {
        error: error.message,
        missing: error.missing
      },
      { status: 503 }
    );
  }

  console.error("[DoctorAI server error]", error);
  const message =
    process.env.NODE_ENV === "production"
      ? "Unexpected server error."
      : error instanceof Error
        ? error.message
        : "Unexpected server error";
  return NextResponse.json({ error: message }, { status: 500 });
}
