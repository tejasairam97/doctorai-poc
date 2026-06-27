import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(fileName) {
  const path = join(rootDir, fileName);
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const requiredEnv = [
  "DATABASE_URL",
  "APP_BASE_URL",
  "AUTH_SECRET",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_ENDPOINT",
  "AZURE_SPEECH_REGION",
  "AZURE_OPENAI_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_SUMMARY_DEPLOYMENT"
];

function isPlaceholder(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    !normalized ||
    normalized.includes("replace-with") ||
    normalized.includes("your-") ||
    normalized.includes("placeholder") ||
    normalized.includes("example")
  );
}

const missing = requiredEnv.filter((key) => isPlaceholder(process.env[key]));
if (missing.length > 0) {
  console.error(
    `DoctorAI cannot start because required environment variables are missing or placeholders: ${missing.join(", ")}.`
  );
  console.error("Configure these in Azure App Service Environment variables. Secret values were not printed.");
  process.exit(1);
}

if (process.env.ENABLE_DEMO_LOGIN === "true" && process.env.NODE_ENV === "production") {
  console.warn("ENABLE_DEMO_LOGIN is true in production. Set it to false for hosted POC or early production use.");
}

if (!process.env.ACS_CONNECTION_STRING || !process.env.ACS_SENDER_ADDRESS) {
  console.warn("ACS Email is not fully configured. Approved-summary email will use simulated delivery.");
}

const nextBin = require.resolve("next/dist/bin/next");
const port = process.env.PORT || "3000";
const host = process.env.HOST || "0.0.0.0";

if (!existsSync(join(rootDir, ".next"))) {
  console.warn("The .next build directory was not found. Run `pnpm build` before `pnpm start`.");
}

const child = spawn(process.execPath, [nextBin, "start", "-H", host, "-p", port], {
  cwd: rootDir,
  stdio: "inherit",
  env: process.env
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
