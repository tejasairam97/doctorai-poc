import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EmailClient } from "@azure/communication-email";

const ENV_PATH = resolve(process.cwd(), ".env.local");
const EXPECTED_RESOURCE_NAME = "doctorai-email-otp";

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const separatorIndex = trimmed.indexOf("=");
  if (separatorIndex === -1) return null;

  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return { key, value };
}

function loadEnvLocal() {
  try {
    const contents = readFileSync(ENV_PATH, "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed || process.env[parsed.key]) continue;
      process.env[parsed.key] = parsed.value;
    }
  } catch {
    // Missing .env.local is handled by the required config checks below.
  }
}

function hasValue(value) {
  return Boolean(value && value.trim());
}

function parseConnectionStringEndpointHost(connectionString) {
  const parts = Object.fromEntries(
    connectionString
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        return [part.slice(0, separatorIndex).toLowerCase(), part.slice(separatorIndex + 1)];
      })
  );

  const endpoint = parts.endpoint;
  if (!endpoint) return "";

  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}

function sanitizeError(error) {
  const parts = [
    error?.code ? `code=${String(error.code)}` : "",
    error?.statusCode ? `status=${String(error.statusCode)}` : "",
    error?.name ? `name=${String(error.name)}` : "",
    error?.message ? `message=${String(error.message)}` : "message=Unknown ACS email error"
  ].filter(Boolean);

  return parts
    .join(" ")
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, "[redacted]")
    .slice(0, 500);
}

loadEnvLocal();

const connectionString =
  process.env.ACS_CONNECTION_STRING?.trim() ||
  process.env.COMMUNICATION_SERVICES_CONNECTION_STRING?.trim() ||
  "";
const senderAddress = process.env.ACS_SENDER_ADDRESS?.trim() || "";
const testRecipient = process.env.ACS_TEST_RECIPIENT?.trim() || "";
const endpointHost = hasValue(connectionString) ? parseConnectionStringEndpointHost(connectionString) : "";

console.log(`connection string present: ${hasValue(connectionString) ? "yes" : "no"}`);
console.log(`parsed endpoint host: ${endpointHost || "unavailable"}`);
console.log(`sender address: ${senderAddress || "missing"}`);
console.log(`recipient configured: ${hasValue(testRecipient) ? "yes" : "no"}`);

if (!hasValue(connectionString) || !hasValue(senderAddress) || !hasValue(testRecipient)) {
  console.error("ACS smoke test skipped: required email configuration is missing.");
  process.exit(2);
}

if (!endpointHost.endsWith(".communication.azure.com") || !endpointHost.includes(EXPECTED_RESOURCE_NAME)) {
  console.error(`Wrong ACS connection string: unexpected endpoint host ${endpointHost || "unavailable"}.`);
  process.exit(3);
}

try {
  const client = new EmailClient(connectionString);
  const poller = await client.beginSend({
    senderAddress,
    content: {
      subject: "DoctorAI ACS smoke test",
      plainText: "If you received this, Azure Communication Services Email is working."
    },
    recipients: {
      to: [{ address: testRecipient }]
    }
  });

  const result = await poller.pollUntilDone();
  const succeeded = String(result?.status || "").toLowerCase() === "succeeded";
  console.log(`send result: ${succeeded ? "succeeded" : "failed"}`);
  console.log(`ACS send status: ${result?.status || "unknown"}`);
  if (result?.id) {
    console.log(`message id: ${result.id}`);
  }

  process.exit(succeeded ? 0 : 1);
} catch (error) {
  console.log("send result: failed");
  console.error(`sanitized error: ${sanitizeError(error)}`);
  process.exit(1);
}
