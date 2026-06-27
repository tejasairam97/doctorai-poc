import { getAzureOpenAIEnv } from "./server-config";

const AZURE_OPENAI_API_VERSION = "2024-10-21";

type SummaryResult = {
  summary: string;
  normalizedTranscript: string;
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
  purpose: "normalization" | "summary";
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
