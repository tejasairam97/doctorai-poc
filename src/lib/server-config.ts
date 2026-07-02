export type ServerEnvKey =
  | "AZURE_SPEECH_KEY"
  | "AZURE_SPEECH_ENDPOINT"
  | "AZURE_SPEECH_REGION"
  | "AZURE_OPENAI_KEY"
  | "AZURE_OPENAI_ENDPOINT"
  | "AZURE_OPENAI_SUMMARY_DEPLOYMENT"
  | "AZURE_OPENAI_NORMALIZATION_DEPLOYMENT"
  | "DATABASE_URL"
  | "ACS_CONNECTION_STRING"
  | "ACS_SENDER_ADDRESS"
  | "APP_BASE_URL"
  | "AUTH_SECRET"
  | "ENABLE_DEMO_LOGIN";

type ValidationResult = {
  ok: boolean;
  missing: ServerEnvKey[];
  message?: string;
};

export class ServerConfigError extends Error {
  missing: ServerEnvKey[];

  constructor(featureName: string, missing: ServerEnvKey[]) {
    super(
      `${featureName} is not configured. Missing environment variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`
    );
    this.name = "ServerConfigError";
    this.missing = missing;
  }
}

export const CORE_SERVER_ENV_KEYS: ServerEnvKey[] = [
  "DATABASE_URL",
  "APP_BASE_URL",
  "AUTH_SECRET"
];

export const OPTIONAL_SERVICE_ENV_KEYS: ServerEnvKey[] = [
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_ENDPOINT",
  "AZURE_SPEECH_REGION",
  "AZURE_OPENAI_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_SUMMARY_DEPLOYMENT",
  "AZURE_OPENAI_NORMALIZATION_DEPLOYMENT",
  "ACS_CONNECTION_STRING",
  "ACS_SENDER_ADDRESS",
  "ENABLE_DEMO_LOGIN"
];

export const REQUIRED_SERVER_ENV_KEYS = CORE_SERVER_ENV_KEYS;

export const HOSTED_POC_REQUIRED_ENV_KEYS: ServerEnvKey[] = [
  ...CORE_SERVER_ENV_KEYS,
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_ENDPOINT",
  "AZURE_SPEECH_REGION",
  "AZURE_OPENAI_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_SUMMARY_DEPLOYMENT"
];

function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new Error("Server configuration can only be read on the server.");
  }
}

export function readServerEnv(key: ServerEnvKey) {
  assertServerOnly();
  return process.env[key]?.trim() || "";
}

export function isPlaceholderEnvValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes("replace-with") ||
    normalized.includes("your-") ||
    normalized.includes("placeholder") ||
    normalized.includes("example")
  );
}

export function readConfiguredServerEnv(key: ServerEnvKey) {
  const value = readServerEnv(key);
  return isPlaceholderEnvValue(value) ? "" : value;
}

export function validateServerEnv(keys: ServerEnvKey[] = REQUIRED_SERVER_ENV_KEYS): ValidationResult {
  assertServerOnly();
  const missing = keys.filter((key) => !readServerEnv(key));
  if (missing.length === 0) return { ok: true, missing: [] };

  return {
    ok: false,
    missing,
    message: `DoctorAI server configuration is incomplete. Missing: ${missing.join(", ")}.`
  };
}

export function validateConfiguredServerEnv(keys: ServerEnvKey[] = REQUIRED_SERVER_ENV_KEYS): ValidationResult {
  assertServerOnly();
  const missing = keys.filter((key) => !readConfiguredServerEnv(key));
  if (missing.length === 0) return { ok: true, missing: [] };

  return {
    ok: false,
    missing,
    message: `DoctorAI server configuration is incomplete. Missing configured values: ${missing.join(", ")}.`
  };
}

export function requireServerEnv(featureName: string, keys: ServerEnvKey[]) {
  const result = validateServerEnv(keys);
  if (!result.ok) {
    throw new ServerConfigError(featureName, result.missing);
  }

  return Object.fromEntries(keys.map((key) => [key, readServerEnv(key)])) as Record<ServerEnvKey, string>;
}

export function getDatabaseUrl() {
  const databaseUrl = readConfiguredServerEnv("DATABASE_URL");
  if (databaseUrl) return databaseUrl;

  throw new ServerConfigError("Database", ["DATABASE_URL"]);
}

export function getAuthSecret() {
  const authSecret = readConfiguredServerEnv("AUTH_SECRET");
  if (authSecret) return authSecret;

  throw new ServerConfigError("Authentication", ["AUTH_SECRET"]);
}

export function getDemoLoginEnabled() {
  const value = readServerEnv("ENABLE_DEMO_LOGIN").toLowerCase();
  return value === "true";
}

export function getDeploymentConfigStatus() {
  const hostedPoc = validateConfiguredServerEnv(HOSTED_POC_REQUIRED_ENV_KEYS);
  const core = validateConfiguredServerEnv(CORE_SERVER_ENV_KEYS);
  const acs = validateConfiguredServerEnv(["ACS_CONNECTION_STRING", "ACS_SENDER_ADDRESS"]);

  return {
    ready: hostedPoc.ok,
    coreReady: core.ok,
    hostedPocReady: hostedPoc.ok,
    missingCore: core.missing,
    missingHostedPoc: hostedPoc.missing,
    optionalServices: {
      acsEmailConfigured: acs.ok,
      acsEmailMissing: acs.missing
    },
    demoLoginEnabled: getDemoLoginEnabled()
  };
}

export function getAzureSpeechEnv() {
  return {
    key: readConfiguredServerEnv("AZURE_SPEECH_KEY"),
    endpoint: readConfiguredServerEnv("AZURE_SPEECH_ENDPOINT"),
    region: readConfiguredServerEnv("AZURE_SPEECH_REGION")
  };
}

export function getAzureOpenAIEnv() {
  return {
    key: readConfiguredServerEnv("AZURE_OPENAI_KEY"),
    endpoint: readConfiguredServerEnv("AZURE_OPENAI_ENDPOINT"),
    deployment: readConfiguredServerEnv("AZURE_OPENAI_SUMMARY_DEPLOYMENT"),
    normalizationDeployment: readConfiguredServerEnv("AZURE_OPENAI_NORMALIZATION_DEPLOYMENT")
  };
}

export function getAcsEmailEnv() {
  return {
    connectionString: readConfiguredServerEnv("ACS_CONNECTION_STRING"),
    senderAddress: readConfiguredServerEnv("ACS_SENDER_ADDRESS")
  };
}
