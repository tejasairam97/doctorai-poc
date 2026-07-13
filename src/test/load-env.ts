import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { getSummaryConfigStatus } from "@/lib/azure-openai";

function readEnvFile(path: string) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, "")];
      })
  );
}

Object.assign(process.env, {
  ...readEnvFile(resolve(process.cwd(), ".env.local")),
  ...readEnvFile(resolve(process.cwd(), ".env.test")),
  ...process.env
});

if (process.env.RUN_AZURE_LOAD_TESTS !== "true") {
  throw new Error("Azure load tests are disabled. Set RUN_AZURE_LOAD_TESTS=true explicitly before running them.");
}

const config = getSummaryConfigStatus();
if (!config.configured) {
  const missing = Object.entries(config.missing)
    .filter(([, isMissing]) => isMissing)
    .map(([name]) => name)
    .join(", ");
  throw new Error(`Azure load tests need configured Azure OpenAI credentials. Missing: ${missing}.`);
}
