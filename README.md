# DoctorAI MVP v1

DoctorAI is a narrow doctor-side clinical documentation starter app. This codebase covers local sign-up/login, a doctor dashboard, draft visit creation, Azure Speech-powered live transcription, doctor self-summary dictation, transcript autosave, interruption recovery, server-side draft summary generation, approval, and patient email delivery logging.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL, including Azure Database for PostgreSQL Flexible Server

Patient portal, appointment workflows, and front desk tooling are intentionally not implemented in this version. Live Conversation and Doctor Self-Summary use Azure Speech through a backend-issued short-lived token; the browser never receives long-lived Azure keys. Azure OpenAI and Azure Communication Services Email are server-side only.

## Local Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create `.env.local` for local development:

```bash
cp .env.example .env.local
```

Fill in the placeholder values when you are ready to use real Azure services. Keep `.env.local` on your machine only; it is ignored by git. Placeholder values are treated as not externally configured, so local summary/email flows use safe simulated fallbacks.

For PostgreSQL, set `DATABASE_URL` to a PostgreSQL connection string. For Azure Database for PostgreSQL Flexible Server, include `sslmode=require` and make sure your database exists and your local IP is allowed by the server firewall:

```bash
DATABASE_URL="postgresql://doctorai_user:password@your-server.postgres.database.azure.com:5432/doctorai?sslmode=require"
```

For Azure Speech transcription, set all three Speech values:

```bash
AZURE_SPEECH_KEY="..."
AZURE_SPEECH_REGION="eastus"
AZURE_SPEECH_ENDPOINT="https://eastus.api.cognitive.microsoft.com"
```

For Azure OpenAI summary generation, set:

```bash
AZURE_OPENAI_KEY="..."
AZURE_OPENAI_ENDPOINT="https://your-openai-resource.openai.azure.com"
AZURE_OPENAI_SUMMARY_DEPLOYMENT="your-chat-model-deployment-name"
AZURE_OPENAI_NORMALIZATION_DEPLOYMENT="your-optional-cheaper-normalization-deployment-name"
```

For Azure Communication Services Email, set:

```bash
ACS_CONNECTION_STRING="endpoint=https://your-acs-resource.communication.azure.com/;accesskey=..."
ACS_SENDER_ADDRESS="DoNotReply@your-verified-domain.example"
```

Do not prefix secrets with `NEXT_PUBLIC_`. Server routes read these values and issue short-lived browser-safe Speech tokens; the browser never receives long-lived Azure keys.

3. Generate the Prisma client and apply the schema to your PostgreSQL database:

```bash
pnpm prisma:generate
pnpm prisma db push
```

For a fresh managed PostgreSQL database, `prisma db push` is the simplest POC path. If you want migration history applied instead, use `pnpm prisma:migrate` against a fresh PostgreSQL database after confirming the connection string points to the intended database.

4. Seed demo data, if you want the demo account and one sample draft visit:

```bash
pnpm db:seed
```

5. Run the app:

```bash
pnpm dev
```

Open `http://localhost:3000`.

For local testing on a specific port, pass the port to Next.js instead of hard-coding it in app code:

```bash
pnpm dev -- -p 3002
```

## Environment Configuration

Server-side variables are listed in `.env.example`:

- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_ENDPOINT`
- `AZURE_SPEECH_REGION`
- `AZURE_OPENAI_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_SUMMARY_DEPLOYMENT`
- `AZURE_OPENAI_NORMALIZATION_DEPLOYMENT`
- `DATABASE_URL`
- `APP_BASE_URL`
- `AUTH_SECRET`
- `ENABLE_DEMO_LOGIN`
- `ACS_CONNECTION_STRING`
- `ACS_SENDER_ADDRESS`

ACS variables are optional for the hosted POC. If they are omitted, email delivery is simulated and logged.

For Azure App Service deployment, configure these under App Service > Settings > Environment variables. Do not bake secrets into source code, static assets, or client-side `NEXT_PUBLIC_` variables.

Later, these App Service settings can be changed to Azure Key Vault references, such as `@Microsoft.KeyVault(...)`, so the app reads secrets through managed infrastructure without code changes.

## Azure App Service Deployment

Use Azure App Service on Linux with a Node.js runtime. The production scripts are:

```bash
pnpm build
pnpm start
```

`pnpm build` generates the Prisma client and builds Next.js. `pnpm start` runs a small production wrapper that validates required hosted-POC environment variables, binds Next.js to `0.0.0.0`, and uses `process.env.PORT` when Azure App Service provides it. The production runtime does not hard-code `localhost` or port `3002`.

Use Node.js 20 or newer on Azure App Service Linux. A Basic tier plan is enough for an early real-user POC, assuming traffic is small and PostgreSQL, Speech, and OpenAI are managed Azure services.

Set these App Service environment variables for a real hosted POC:

- `DATABASE_URL`: Azure PostgreSQL app-user connection string with `sslmode=require`.
- `APP_BASE_URL`: public HTTPS App Service URL, for example `https://your-app.azurewebsites.net`.
- `AUTH_SECRET`: long random production secret.
- `AZURE_SPEECH_KEY`, `AZURE_SPEECH_ENDPOINT`, `AZURE_SPEECH_REGION`: Azure AI Speech resource.
- `AZURE_OPENAI_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_SUMMARY_DEPLOYMENT`: Azure OpenAI resource and deployed chat model.
- `AZURE_OPENAI_NORMALIZATION_DEPLOYMENT`: optional cheaper deployment for transcript normalization.
- `ENABLE_DEMO_LOGIN`: set to `false` for hosted production.
- `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS`: optional. If omitted, approved-summary email remains simulated and the app still starts.

The startup wrapper treats these as required for a hosted POC and exits with a clear missing-variable message if any are absent or still placeholders:

- `DATABASE_URL`
- `APP_BASE_URL`
- `AUTH_SECRET`
- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_ENDPOINT`
- `AZURE_SPEECH_REGION`
- `AZURE_OPENAI_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_SUMMARY_DEPLOYMENT`

ACS Email is intentionally not required at startup.

After deploying, check:

```bash
https://your-app.azurewebsites.net/api/health
```

The health endpoint returns HTTP 200 with basic JSON and lists missing environment variable names only. It never returns secret values. For Azure health checks, use `/api/health`.

## GitHub Deployment

GitHub-based CI/CD is prepared in [deploy-doctorai.yml](C:/Users/tejas/Documents/Codex/2026-06-17/you-are-building-mvp-v1-of/.github/workflows/deploy-doctorai.yml). The workflow:

- installs dependencies with `pnpm`
- runs `pnpm build`
- prunes dev dependencies
- packages the production app for Azure App Service
- deploys to the existing App Service `doctorai-aptiqo`

The workflow is triggered on pushes to `main` and on manual runs from GitHub Actions.

Add this GitHub repository secret before enabling deployment:

- `AZUREAPPSERVICE_PUBLISHPROFILE_DOCTORAI_APTIQO`: the publish profile XML downloaded from the Azure App Service `doctorai-aptiqo`

Keep runtime secrets out of GitHub source control. Configure these in Azure App Service Environment variables instead of GitHub Actions:

- `DATABASE_URL`
- `APP_BASE_URL`
- `AUTH_SECRET`
- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_ENDPOINT`
- `AZURE_SPEECH_REGION`
- `AZURE_OPENAI_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_SUMMARY_DEPLOYMENT`
- `AZURE_OPENAI_NORMALIZATION_DEPLOYMENT`
- `ENABLE_DEMO_LOGIN`
- `ACS_CONNECTION_STRING`
- `ACS_SENDER_ADDRESS`

## Demo Login

Demo auto-login is controlled by `ENABLE_DEMO_LOGIN`. Use `ENABLE_DEMO_LOGIN="true"` locally if desired and set it to `"false"` in hosted production. When disabled, the demo login shortcut is hidden and demo auto-creation is blocked.

After seeding, or when demo login auto-creation is enabled:

- Email: `demo@doctorai.local`
- Password: `password123`

## Current Workflow

1. Doctor signs up or logs in.
2. Doctor lands on the dashboard.
3. Doctor taps `New Visit`.
4. Doctor enters patient name, age, email, optional phone, consent status, and requested input mode.
5. The app creates:
   - a `patients` row
   - a `visits` row with `status = DRAFT`
   - a `usage_events` audit row
6. If consent is granted, the doctor can start Live Conversation mode.
7. Doctor Self-Summary remains available regardless of consent.
8. The browser requests a short-lived Speech auth token from `/api/speech-token`.
9. The browser requests microphone access using secure-context-friendly APIs, then starts Azure Speech continuous recognition.
10. Transcript text autosaves to the existing visit every 4 seconds.
11. If the page is hidden or the browser goes offline while recording, the app saves the latest transcript text, marks the same visit `INTERRUPTED`, and offers `Retry/Resume` or `Doctor Self-Summary`.
12. Stop saves the transcript as `TRANSCRIBED`, then generates a draft summary. No live summaries are generated while recording.
13. Regenerate Summary calls the same server-side summary route and increments `draft_generation_count`.
14. Approve Summary writes `approved_summary`.
15. Send Email is a separate action that requires patient consent for unencrypted PHI email. It sends or simulates patient email, logs `email_delivery_logs`, and marks the visit `EMAILED` when delivery is accepted.
16. Usage events track transcription attempts, summary generation, approval, and email delivery.

## Data Model

The Prisma schema includes the MVP tables:

- `doctor_accounts`
- `patients`
- `visits`
- `usage_events`
- `email_delivery_logs`

The visit model already has fields needed by later documentation work, including consent, input mode, status, transcript, draft summary, approved summary, interruption, resume, approval, email, and draft generation counters.

## Local Test Checklist

- Doctor sign-up/login works, including demo login.
- Create visit writes one `patients` row and one `visits` row.
- Live conversation is available only when consent is granted.
- Denied consent forces Doctor Self-Summary only.
- Interruption marks the same visit `INTERRUPTED` and preserves transcript text.
- Resume keeps the same visit id and increments `resume_count`.
- Stop saves transcript and generates a draft summary after recording stops.
- Regenerate Summary updates `draft_summary` and increments `draft_generation_count`.
- Approve Summary writes `approved_summary` even if patient email consent is declined.
- Send Email is allowed only when unencrypted PHI email consent is approved; blocked attempts are logged.
- Offline handling preserves the latest saved transcript and offers Resume or Doctor Self-Summary.
- Browser microphone permission denial shows a clear fallback to Doctor Self-Summary.

## Full POC Checklist

Replace placeholders in `.env.local` locally or Azure App Service environment variables in deployment:

- `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`, `AZURE_SPEECH_ENDPOINT`: Azure AI Speech resource.
- `AZURE_OPENAI_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_SUMMARY_DEPLOYMENT`: Azure OpenAI resource plus a deployed chat model.
- `AZURE_OPENAI_NORMALIZATION_DEPLOYMENT`: optional cheaper Azure OpenAI deployment for transcript normalization before summary generation.
- `ACS_CONNECTION_STRING`, `ACS_SENDER_ADDRESS`: optional Azure Communication Services Email resource with a verified sender/domain. If omitted, delivery is simulated.
- `DATABASE_URL`: PostgreSQL connection string. For Azure Database for PostgreSQL Flexible Server, include host, database, user, password, port `5432`, and `sslmode=require`.
- `ENABLE_DEMO_LOGIN`: optional local/demo flag. Use `"true"` locally if desired and `"false"` for shared deployments.
- `APP_BASE_URL`: public HTTPS app URL for deployment.
- `AUTH_SECRET`: long random server-side auth secret.

You also need an HTTPS-capable host for microphone access outside localhost, such as Azure App Service. Azure Key Vault references can be added later for secrets. No patient portal, appointment module, or front desk module is included in this MVP.
