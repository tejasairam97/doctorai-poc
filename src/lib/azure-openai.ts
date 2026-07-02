import { getAzureOpenAIEnv } from "./server-config";
import type { PatientProgressTrend } from "./types";

const AZURE_OPENAI_API_VERSION = "2024-10-21";

type SummaryResult = {
  summary: string;
  normalizedTranscript: string;
  provider: "AZURE_OPENAI" | "LOCAL_PLACEHOLDER";
  simulated: boolean;
};

type ProgressSummaryResult = {
  trend: PatientProgressTrend;
  summaryContent: string;
  keyChangesSinceLastVisit: string[];
  unresolvedIssues: string[];
  followUpProgress: string[];
  provider: "AZURE_OPENAI" | "LOCAL_PLACEHOLDER";
  simulated: boolean;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, "");
}

function buildSummaryPrompt(inputModeActual: string) {
  return [
    "You are DoctorAI, drafting an outpatient clinical documentation summary for a physician to review.",
    "Use only the supplied normalized transcript or doctor self-summary. Do not invent diagnoses, medications, test results, vitals, or instructions.",
    "If a detail is unclear or not supported, say it was not documented.",
    "Keep the summary concise, doctor-reviewable, and organized with these exact sections:",
    "Patient concern",
    "Key history from conversation",
    "Doctor assessment/plan",
    "Follow-up / instructions",
    `Source mode: ${inputModeActual}.`
  ].join("\n");
}

function buildNormalizationPrompt(inputModeActual: string) {
  return [
    "You are preparing a clinical transcript for a later summarization step.",
    "Do not summarize, paraphrase, compress, add facts, remove facts, or change clinical meaning.",
    "Only normalize speaker labels and line breaks.",
    "Every spoken line must begin with exactly one of these labels:",
    "Doctor:",
    "Patient:",
    "Use Doctor: for clinician questions, assessments, plans, instructions, and self-summary text.",
    "Use Patient: for patient statements and responses.",
    "If the speaker is ambiguous, preserve the text under the most likely label without adding explanation.",
    `Source mode: ${inputModeActual}.`
  ].join("\n");
}

function buildProgressPrompt() {
  return [
    "You are DoctorAI, preparing a concise doctor-side outpatient progress summary.",
    "Use only the supplied approved visit summaries. Do not use raw transcript, invent facts, or add new diagnoses.",
    "Keep the output generic across specialties, clinical, concise, and doctor-reviewable.",
    "Compare the latest approved visit with the immediately prior approved visit. Older visits may provide context only.",
    "Return JSON only with this exact shape:",
    "{",
    "  \"trend\": \"improving\" | \"stable\" | \"worsening\" | \"unclear\",",
    "  \"keyChangesSinceLastVisit\": [\"...\"],",
    "  \"unresolvedIssues\": [\"...\"],",
    "  \"followUpProgress\": [\"...\"]",
    "}",
    "Use \"unclear\" when the approved summaries do not support a direction of change.",
    "Each array should contain 1 to 4 short clinical bullets. If not documented, say so plainly."
  ].join("\n");
}

function localNormalizeTranscript(transcriptText: string, inputModeActual: string) {
  const defaultSpeaker = inputModeActual === "DOCTOR_SELF_SUMMARY" ? "Doctor" : "Patient";
  const lines = transcriptText
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return (lines.length ? lines : [transcriptText.trim()])
    .map((line) => {
      const cleaned = line.replace(/^(doctor|dr\.?|provider|clinician)\s*:\s*/i, "");
      if (cleaned !== line) return `Doctor: ${cleaned}`;

      const patientCleaned = line.replace(/^(patient|pt\.?)\s*:\s*/i, "");
      if (patientCleaned !== line) return `Patient: ${patientCleaned}`;

      return `${defaultSpeaker}: ${line}`;
    })
    .join("\n");
}

function localPlaceholderSummary(transcriptText: string, inputModeActual: string) {
  const sourceLabel =
    inputModeActual === "DOCTOR_SELF_SUMMARY" ? "doctor self-summary" : "conversation transcript";
  const compactTranscript = transcriptText
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 90)
    .join(" ");

  return [
    "Patient concern",
    `- Draft generated from the available ${sourceLabel}. Review and edit before approval.`,
    "",
    "Key history from conversation",
    `- ${compactTranscript || "No supported transcript details were documented."}`,
    "",
    "Doctor assessment/plan",
    "- Not documented in the available text. Add the clinician's assessment and plan before approval.",
    "",
    "Follow-up / instructions",
    "- Not documented in the available text. Add patient instructions before approval."
  ].join("\n");
}

function cleanProgressLine(line: string) {
  return line.replace(/^[-*]\s*/, "").trim();
}

function localProgressItems(summary: string, maxItems = 4) {
  return summary
    .split(/\r?\n+/)
    .map(cleanProgressLine)
    .filter(Boolean)
    .filter((line) => !["Patient concern", "Key history from conversation", "Doctor assessment/plan", "Follow-up / instructions"].includes(line))
    .slice(0, maxItems);
}

function localProgressTrend(latestSummary: string): PatientProgressTrend {
  const text = latestSummary.toLowerCase();
  const worsening = /\b(worse|worsening|deteriorat|increased|increasing|persistent|not improved|uncontrolled)\b/.test(text);
  const improving = /\b(improv|better|resolved|decreased|decreasing|controlled|less frequent)\b/.test(text);
  const stable = /\b(stable|unchanged|same as|no change)\b/.test(text);

  if (worsening && !improving) return "worsening";
  if (improving && !worsening) return "improving";
  if (stable) return "stable";
  return "unclear";
}

function buildProgressContent(input: {
  trend: PatientProgressTrend;
  keyChangesSinceLastVisit: string[];
  unresolvedIssues: string[];
  followUpProgress: string[];
}) {
  return [
    `Trend: ${input.trend}`,
    "",
    "Key changes since last visit",
    ...input.keyChangesSinceLastVisit.map((item) => `- ${item}`),
    "",
    "Unresolved issues",
    ...input.unresolvedIssues.map((item) => `- ${item}`),
    "",
    "Follow-up progress",
    ...input.followUpProgress.map((item) => `- ${item}`)
  ].join("\n");
}

function localPlaceholderProgressSummary(approvedSummaries: Array<{ approvedSummary: string }>): ProgressSummaryResult {
  const latestSummary = approvedSummaries[0]?.approvedSummary?.trim() || "";
  const previousSummary = approvedSummaries[1]?.approvedSummary?.trim() || "";
  const previousLower = previousSummary.toLowerCase();
  const latestItems = localProgressItems(latestSummary, 8);
  const keyChangesSinceLastVisit = latestItems
    .filter((item) => !previousLower.includes(item.toLowerCase()))
    .slice(0, 4);
  const unresolvedIssues = latestItems
    .filter((item) => /\b(pending|unresolved|continue|follow up|monitor|persistent|not documented|return|referral)\b/i.test(item))
    .slice(0, 4);
  const followUpProgress = latestItems
    .filter((item) => /\b(follow|return|monitor|continue|instruction|progress|next)\b/i.test(item))
    .slice(0, 4);
  const trend = localProgressTrend(latestSummary);

  const safeResult = {
    trend,
    keyChangesSinceLastVisit: keyChangesSinceLastVisit.length
      ? keyChangesSinceLastVisit
      : ["No clearly documented change was detected between the two latest approved summaries."],
    unresolvedIssues: unresolvedIssues.length
      ? unresolvedIssues
      : ["No unresolved issue is clearly documented in the latest approved summary."],
    followUpProgress: followUpProgress.length
      ? followUpProgress
      : ["No follow-up progress is clearly documented in the latest approved summary."]
  };

  return {
    ...safeResult,
    summaryContent: buildProgressContent(safeResult),
    provider: "LOCAL_PLACEHOLDER",
    simulated: true
  };
}

export function getSummaryConfigStatus() {
  const env = getAzureOpenAIEnv();
  return {
    configured: Boolean(env.key && env.endpoint && env.deployment),
    missing: {
      key: !env.key,
      endpoint: !env.endpoint,
      deployment: !env.deployment
    }
  };
}

async function requestChatCompletion(input: {
  endpoint: string;
  key: string;
  deployment: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  purpose: "normalization" | "summary" | "progress summary";
}) {
  const endpoint = `${normalizeEndpoint(input.endpoint)}/openai/deployments/${encodeURIComponent(
    input.deployment
  )}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": input.key
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: input.systemPrompt },
        { role: "user", content: input.userPrompt }
      ],
      temperature: input.temperature,
      max_tokens: input.maxTokens
    })
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(
      `Azure OpenAI ${input.purpose} request failed (${response.status}). ${details.slice(0, 240)}`.trim()
    );
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`Azure OpenAI returned an empty ${input.purpose} response.`);
  }

  return content;
}

function parseJsonObject(content: string) {
  const withoutFence = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const jsonText =
    firstBrace >= 0 && lastBrace > firstBrace ? withoutFence.slice(firstBrace, lastBrace + 1) : withoutFence;
  return JSON.parse(jsonText) as Record<string, unknown>;
}

function normalizeProgressArray(value: unknown, fallback: string) {
  if (!Array.isArray(value)) return [fallback];
  const items = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 4);
  return items.length ? items : [fallback];
}

function normalizeProgressTrend(value: unknown): PatientProgressTrend {
  return value === "improving" || value === "stable" || value === "worsening" || value === "unclear"
    ? value
    : "unclear";
}

export async function generateDraftSummary(input: {
  transcriptText: string;
  inputModeActual: string;
}): Promise<SummaryResult> {
  const transcriptText = input.transcriptText.trim();
  if (!transcriptText) {
    throw new Error("Transcript text is required before generating a summary.");
  }

  const env = getAzureOpenAIEnv();
  if (!env.key || !env.endpoint || !env.deployment) {
    const normalizedTranscript = localNormalizeTranscript(transcriptText, input.inputModeActual);
    return {
      normalizedTranscript,
      summary: localPlaceholderSummary(normalizedTranscript, input.inputModeActual),
      provider: "LOCAL_PLACEHOLDER",
      simulated: true
    };
  }

  const normalizedTranscript = await requestChatCompletion({
    endpoint: env.endpoint,
    key: env.key,
    deployment: env.normalizationDeployment || env.deployment,
    systemPrompt: buildNormalizationPrompt(input.inputModeActual),
    userPrompt: `Raw transcript:\n${transcriptText}`,
    temperature: 0,
    maxTokens: 1400,
    purpose: "normalization"
  });

  const summary = await requestChatCompletion({
    endpoint: env.endpoint,
    key: env.key,
    deployment: env.deployment,
    systemPrompt: buildSummaryPrompt(input.inputModeActual),
    userPrompt: `Normalized transcript:\n${normalizedTranscript}`,
    temperature: 0.2,
    maxTokens: 850,
    purpose: "summary"
  });

  return {
    normalizedTranscript,
    summary,
    provider: "AZURE_OPENAI",
    simulated: false
  };
}

export async function generatePatientProgressSummary(input: {
  approvedSummaries: Array<{
    approvedAt?: string | Date | null;
    approvedSummary: string;
  }>;
}): Promise<ProgressSummaryResult> {
  const approvedSummaries = input.approvedSummaries
    .map((summary) => ({
      approvedAt: summary.approvedAt,
      approvedSummary: summary.approvedSummary.trim()
    }))
    .filter((summary) => summary.approvedSummary);

  if (approvedSummaries.length < 2) {
    throw new Error("Progress Summary requires at least 2 approved visits.");
  }

  const fallback = localPlaceholderProgressSummary(approvedSummaries);
  const env = getAzureOpenAIEnv();
  if (!env.key || !env.endpoint || !env.deployment) {
    return fallback;
  }

  try {
    const content = await requestChatCompletion({
      endpoint: env.endpoint,
      key: env.key,
      deployment: env.deployment,
      systemPrompt: buildProgressPrompt(),
      userPrompt: JSON.stringify({
        source: "approved_visit_summaries_only",
        visits: approvedSummaries.slice(0, 6).map((summary, index) => ({
          sequence: index === 0 ? "latest" : index === 1 ? "previous" : `older_${index}`,
          approvedAt: summary.approvedAt,
          approvedSummary: summary.approvedSummary
        }))
      }),
      temperature: 0.1,
      maxTokens: 700,
      purpose: "progress summary"
    });

    const parsed = parseJsonObject(content);
    const normalized = {
      trend: normalizeProgressTrend(parsed.trend),
      keyChangesSinceLastVisit: normalizeProgressArray(
        parsed.keyChangesSinceLastVisit,
        "No clearly documented change was detected between the two latest approved summaries."
      ),
      unresolvedIssues: normalizeProgressArray(
        parsed.unresolvedIssues,
        "No unresolved issue is clearly documented in the latest approved summary."
      ),
      followUpProgress: normalizeProgressArray(
        parsed.followUpProgress,
        "No follow-up progress is clearly documented in the latest approved summary."
      )
    };

    return {
      ...normalized,
      summaryContent: buildProgressContent(normalized),
      provider: "AZURE_OPENAI",
      simulated: false
    };
  } catch (error) {
    console.warn("[DoctorAI progress summary Azure generation failed]", error);
    return fallback;
  }
}
