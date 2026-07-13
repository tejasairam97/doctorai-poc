import { describe, expect, it } from "vitest";
import { generateDraftSummary } from "./azure-openai";

function readPositiveInteger(name: string, fallback: number, maximum: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

const requestCount = readPositiveInteger("AZURE_STRESS_REQUESTS", 6, 20);
const concurrency = readPositiveInteger("AZURE_STRESS_CONCURRENCY", 2, 5);
const maxP95Ms = readPositiveInteger("AZURE_STRESS_MAX_P95_MS", 60_000, 180_000);
const syntheticTranscript = [
  "Doctor: This is an automated reliability test using synthetic, non-patient data.",
  "Patient: I have had a mild cough for three days and no fever.",
  "Doctor: Continue fluids and contact the clinic if symptoms worsen."
].join("\n");

async function runInBatches<T>(tasks: Array<() => Promise<T>>, batchSize: number) {
  const results: PromiseSettledResult<T>[] = [];
  for (let index = 0; index < tasks.length; index += batchSize) {
    results.push(...(await Promise.allSettled(tasks.slice(index, index + batchSize).map((task) => task()))));
  }
  return results;
}

function percentile95(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

describe("Azure OpenAI synthetic reliability stress test", () => {
  it("serves concurrent synthetic draft-summary requests within the configured latency budget", async () => {
    const tasks = Array.from({ length: requestCount }, () => async () => {
      const startedAt = performance.now();
      const result = await generateDraftSummary({ transcriptText: syntheticTranscript, inputModeActual: "LIVE_CONVERSATION" });
      return { result, durationMs: performance.now() - startedAt };
    });
    const outcomes = await runInBatches(tasks, concurrency);
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(failures.map((outcome) => String(outcome.reason))).toEqual([]);

    const successful = outcomes
      .filter((outcome): outcome is PromiseFulfilledResult<{ result: Awaited<ReturnType<typeof generateDraftSummary>>; durationMs: number }> => outcome.status === "fulfilled")
      .map((outcome) => outcome.value);
    const durations = successful.map((outcome) => outcome.durationMs);
    expect(successful).toHaveLength(requestCount);
    for (const { result } of successful) {
      expect(result).toMatchObject({ provider: "AZURE_OPENAI", simulated: false });
      expect(result.normalizedTranscript.trim()).not.toHaveLength(0);
      expect(result.summary).toContain("Patient concern");
      expect(result.summary).toContain("Follow-up / instructions");
    }

    const p95Ms = percentile95(durations);
    console.info(`[Azure stress] requests=${requestCount} concurrency=${concurrency} p95Ms=${Math.round(p95Ms)} maxMs=${Math.round(Math.max(...durations))}`);
    expect(p95Ms).toBeLessThanOrEqual(maxP95Ms);
  });
});
