import { NextResponse } from "next/server";
import { getDeploymentConfigStatus } from "@/lib/server-config";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getDeploymentConfigStatus();

  return NextResponse.json({
    ok: true,
    service: "doctorai",
    status: config.coreReady ? "ready" : "configuration_missing",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "unknown",
    config: {
      coreReady: config.coreReady,
      hostedPocReady: config.hostedPocReady,
      missingCore: config.missingCore,
      missingHostedPoc: config.missingHostedPoc,
      acsEmailConfigured: config.optionalServices.acsEmailConfigured,
      acsEmailMissing: config.optionalServices.acsEmailMissing,
      demoLoginEnabled: config.demoLoginEnabled
    }
  });
}
