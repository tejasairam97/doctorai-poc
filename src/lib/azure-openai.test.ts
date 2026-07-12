import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDraftSummary, generatePatientProgressSummary, getSummaryConfigStatus } from "./azure-openai";

const AZURE_ENV_KEYS = [
  "AZURE_OPENAI_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_SUMMARY_DEPLOYMENT",
  "AZURE_OPENAI_NORMALIZATION_DEPLOYMENT"
];

function clearAzureEnv() {
  for (const key of AZURE_ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(() => {
  clearAzureEnv();
  vi.restoreAllMocks();
});

describe("Azure OpenAI integration fallback", () => {
  it("reports summary config as missing when placeholder env values are used", () => {
    process.env.AZURE_OPENAI_KEY = "replace-with-your-openai-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://your-openai-resource.openai.azure.com";
    process.env.AZURE_OPENAI_SUMMARY_DEPLOYMENT = "doctorai-summary-placeholder";

    expect(getSummaryConfigStatus()).toEqual({
      configured: false,
      missing: {
        key: true,
        endpoint: true,
        deployment: false
      }
    });
  });

  it("creates a local placeholder draft summary without calling Azure", async () => {
    clearAzureEnv();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await generateDraftSummary({
      transcriptText: "Doctor: Patient reports cough for three days.\nPatient: No fever.",
      inputModeActual: "LIVE_CONVERSATION"
    });

    expect(result.provider).toBe("LOCAL_PLACEHOLDER");
    expect(result.simulated).toBe(true);
    expect(result.normalizedTranscript).toContain("Doctor: Patient reports cough for three days.");
    expect(result.summary).toContain("Patient concern");
    expect(result.summary).toContain("Review and edit before approval.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("creates a local placeholder progress summary from approved visit placeholders", async () => {
    clearAzureEnv();

    const result = await generatePatientProgressSummary({
      approvedSummaries: [
        {
          approvedAt: "2026-07-01T10:00:00.000Z",
          approvedSummary: "Patient concern\n- Cough documented. Follow up in one week."
        },
        {
          approvedAt: "2026-07-08T10:00:00.000Z",
          approvedSummary: "Patient concern\n- Cough better. Continue monitoring."
        }
      ]
    });

    expect(result.provider).toBe("LOCAL_PLACEHOLDER");
    expect(result.simulated).toBe(true);
    expect(result.trend).toBe("improving");
    expect(result.confidence).toBe("early signal");
    expect(result.timelineSnapshot).toHaveLength(2);
    expect(result.summaryContent).toContain("Timeline snapshot");
  });

  it("requires at least two approved summaries for progress summaries", async () => {
    await expect(
      generatePatientProgressSummary({
        approvedSummaries: [{ approvedSummary: "Patient concern\n- Placeholder single visit." }]
      })
    ).rejects.toThrow("Progress Summary requires at least 2 approved visits.");
  });
});
