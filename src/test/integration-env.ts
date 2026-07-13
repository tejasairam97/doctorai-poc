import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

function readEnvFile(path: string) {
  if (!existsSync(path)) return {};

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
        return [key, value];
      })
  );
}

function assertLocalDatabaseUrl(databaseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Integration tests need a valid TEST_DATABASE_URL or local DATABASE_URL.");
  }

  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new Error("Integration tests only support PostgreSQL URLs.");
  }

  if (!localHosts.has(parsed.hostname)) {
    throw new Error(
      `Refusing to run integration tests against non-local database host "${parsed.hostname}". Use a local TEST_DATABASE_URL.`
    );
  }
}

const env = {
  ...readEnvFile(resolve(process.cwd(), ".env.local")),
  ...readEnvFile(resolve(process.cwd(), ".env.test")),
  ...process.env
};
const databaseUrl = env.TEST_DATABASE_URL || env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Integration tests need TEST_DATABASE_URL or a local DATABASE_URL. Start local Postgres with `pnpm db:up` and run `pnpm prisma:push` first."
  );
}

assertLocalDatabaseUrl(databaseUrl);

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = databaseUrl;
process.env.APP_BASE_URL ||= env.APP_BASE_URL || "http://localhost:3000";
process.env.AUTH_SECRET ||= env.AUTH_SECRET || "integration-test-auth-secret";
