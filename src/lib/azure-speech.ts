import { getAzureSpeechEnv } from "./server-config";

type SpeechTokenResult = {
  token: string;
  region: string;
  endpoint: string;
  expiresInSeconds: number;
};

function normalizeEndpoint(endpoint: string, region: string) {
  const trimmed = endpoint.trim().replace(/\/$/, "");
  if (trimmed) return trimmed;
  return `https://${region}.api.cognitive.microsoft.com`;
}

function inferRegionFromEndpoint(endpoint: string) {
  try {
    const host = new URL(endpoint).hostname;
    const [region] = host.split(".");
    return region || "";
  } catch {
    return "";
  }
}

export function getSpeechConfigStatus() {
  const { key, endpoint, region: configuredRegion } = getAzureSpeechEnv();
  const region = configuredRegion || inferRegionFromEndpoint(endpoint);

  return {
    configured: Boolean(key && endpoint && region),
    region,
    endpoint: region ? normalizeEndpoint(endpoint, region) : endpoint,
    missing: {
      key: !key,
      endpoint: !endpoint,
      region: !region
    }
  };
}

export async function issueSpeechToken(): Promise<SpeechTokenResult> {
  const { key, endpoint, region: configuredRegion } = getAzureSpeechEnv();
  const region = configuredRegion || inferRegionFromEndpoint(endpoint);

  if (!key || !endpoint || !region) {
    throw new Error(
      "Azure Speech is not configured. Set AZURE_SPEECH_KEY, AZURE_SPEECH_ENDPOINT, and AZURE_SPEECH_REGION."
    );
  }

  const normalizedEndpoint = normalizeEndpoint(endpoint, region);
  const response = await fetch(`${normalizedEndpoint}/sts/v1.0/issueToken`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Length": "0"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Azure Speech token request failed with ${response.status}.`);
  }

  return {
    token: await response.text(),
    region,
    endpoint: normalizedEndpoint,
    expiresInSeconds: 540
  };
}
