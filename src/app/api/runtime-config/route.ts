import { NextResponse } from "next/server";
import { getDemoLoginEnabled } from "@/lib/server-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const demoLoginEnabled = getDemoLoginEnabled();

  return NextResponse.json({
    demoLogin: demoLoginEnabled
      ? {
          enabled: true,
          email: "demo@doctorai.local",
          password: "password123"
        }
      : {
          enabled: false
        }
  });
}
