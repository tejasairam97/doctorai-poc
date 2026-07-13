import { spawn } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const envExamplePath = join(rootDir, ".env.example");
const envLocalPath = join(rootDir, ".env.local");

const args = new Set(process.argv.slice(2));
const options = {
  skipInstall: args.has("--skip-install"),
  skipDb: args.has("--skip-db"),
  seed: args.has("--seed"),
  migrate: args.has("--migrate"),
  forceEnv: args.has("--force-env"),
  help: args.has("--help") || args.has("-h")
};

function printHelp() {
  console.log(`DoctorAI setup

Usage:
  node scripts/setup.mjs [options]

Options:
  --skip-install   Skip pnpm install
  --skip-db        Skip Prisma schema apply / migrations
  --seed           Run pnpm db:seed after database setup
  --migrate        Use pnpm prisma:migrate instead of pnpm prisma:push
  --force-env      Overwrite .env.local from .env.example
  --help, -h       Show this help text
`);
}

if (options.help) {
  printHelp();
  process.exit(0);
}

function logStep(message) {
  console.log(`\n==> ${message}`);
}

function fail(message) {
  console.error(`\nSetup failed: ${message}`);
  process.exit(1);
}

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

function loadSimpleEnv(filePath) {
  if (!existsSync(filePath)) return {};

  const vars = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue.trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    vars[key] = value;
  }

  return vars;
}

function loadEnvIntoProcess(filePath) {
  const vars = loadSimpleEnv(filePath);

  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: rootDir,
      stdio: "inherit",
      shell: options.shell ?? process.platform === "win32"
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${commandArgs.join(" ")} exited with code ${code ?? "unknown"}`));
    });

    child.on("error", reject);
  });
}

function getPackageManagerRunner() {
  const execPath = process.env.npm_execpath;

  if (execPath) {
    return {
      command: process.execPath,
      argsPrefix: [execPath],
      displayName: "pnpm"
    };
  }

  return {
    command: "pnpm",
    argsPrefix: [],
    displayName: "pnpm"
  };
}

async function runPackageManager(args) {
  const runner = getPackageManagerRunner();
  await run(runner.command, [...runner.argsPrefix, ...args], {
    shell: runner.argsPrefix.length === 0 && process.platform === "win32"
  });
}

function ensureSupportedNode() {
  const major = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (Number.isNaN(major) || major < 20) {
    fail(`Node.js 20 or newer is required. Current version: ${process.version}`);
  }
}

function ensureEnvFile() {
  if (!existsSync(envExamplePath)) {
    fail(".env.example was not found.");
  }

  const hadEnvLocal = existsSync(envLocalPath);

  if (hadEnvLocal && !options.forceEnv) {
    console.log(".env.local already exists. Leaving it unchanged.");
    return;
  }

  copyFileSync(envExamplePath, envLocalPath);
  console.log(hadEnvLocal ? ".env.local was refreshed from .env.example." : ".env.local was created from .env.example.");
}

function getDatabaseUrl() {
  if (!existsSync(envLocalPath)) return process.env.DATABASE_URL;

  const envLocal = loadSimpleEnv(envLocalPath);
  return process.env.DATABASE_URL || envLocal.DATABASE_URL;
}

async function main() {
  ensureSupportedNode();

  logStep("Preparing environment file");
  ensureEnvFile();
  loadEnvIntoProcess(envLocalPath);

  if (!options.skipInstall) {
    logStep("Installing dependencies with pnpm");
    await runPackageManager(["install"]);
  } else {
    console.log("Skipping dependency install.");
  }

  logStep("Generating Prisma client");
  await runPackageManager(["prisma:generate"]);

  const databaseUrl = getDatabaseUrl();
  const shouldSkipDb = options.skipDb || isPlaceholder(databaseUrl);

  if (shouldSkipDb) {
    logStep("Skipping database setup");
    if (options.skipDb) {
      console.log("Database setup was skipped by flag.");
    } else {
      console.log("DATABASE_URL is still missing or a placeholder in .env.local.");
      console.log("Update .env.local, then run `pnpm prisma:push` or `pnpm prisma:migrate`.");
    }
  } else {
    logStep(options.migrate ? "Applying Prisma migrations" : "Pushing Prisma schema");
    await runPackageManager([options.migrate ? "prisma:migrate" : "prisma:push"]);

    if (options.seed) {
      logStep("Seeding demo data");
      await runPackageManager(["db:seed"]);
    }
  }

  logStep("Setup complete");
  console.log("Next steps:");
  console.log("  1. Fill in any remaining placeholders in .env.local.");
  console.log("  2. Run `pnpm db:seed` if you want demo data and did not use --seed.");
  console.log("  3. Start the app with `pnpm dev`.");
}

main().catch((error) => fail(error.message));
