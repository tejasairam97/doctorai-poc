# DoctorAI Phase 2 Handoff

## 1. Current product scope implemented

DoctorAI is currently a narrow doctor-side clinical documentation web app. The implemented scope is:

- Doctor sign-up and login
- Doctor dashboard with visit list and new-visit creation
- Visit creation with patient name, age, email, optional phone
- Consent-aware mode selection:
  - `LIVE_CONVERSATION`
  - `DOCTOR_SELF_SUMMARY`
- Azure Speech token issuance and browser-side continuous transcription
- Transcript autosave to the same visit row every few seconds
- Interruption handling for page hide/offline/risk events with resume on the same visit
- Server-side summary generation after stop only
- Two-step summary pipeline:
  - transcript normalization
  - summary generation
- Summary approval as a separate action from email sending
- Optional/simulated patient email delivery
- Internal usage event logging and restricted internal usage view

Intentionally not implemented:

- Patient portal
- Appointment management
- Front desk/admin scheduling module
- Offline audio upload
- Raw audio storage at rest in the normal path
- Full auth/session system

## 2. Current database schema summary

Prisma uses PostgreSQL.

Tables:

- `doctor_accounts`
  - doctor identity, email, password hash, timestamps
- `patients`
  - patient demographics and contact fields
- `visits`
  - main workflow table
  - important fields:
    - `consent_status`
    - `input_mode_requested`
    - `input_mode_actual`
    - `status`
    - `transcript_text`
    - `normalized_transcript_text`
    - `draft_summary`
    - `approved_summary`
    - `unencrypted_email_consent`
    - `unencrypted_email_consent_status`
    - `resume_count`
    - `interruption_reason`
    - `transcript_last_saved_at`
    - `approved_at`
    - `emailed_at`
    - `draft_generation_count`
- `usage_events`
  - audit/operational events such as draft creation, interruption, resume, transcription attempts, summary generation, approval, email delivery
- `email_delivery_logs`
  - patient summary delivery attempts and outcomes

Important schema facts:

- Prisma datasource provider is `postgresql`
- `visits` has indexes on `doctorId`, `doctorId + status`, `doctorId + createdAt`, and `patientId`
- `usage_events` and `email_delivery_logs` also have basic operational indexes

Reference:

- [schema.prisma](C:/Users/tejas/Documents/Codex/2026-06-17/you-are-building-mvp-v1-of/prisma/schema.prisma)

## 3. Current API/routes summary

App routes are implemented under `src/app/api`.

- `POST /api/auth`
  - sign-up and login
  - demo login shortcut is gated by `ENABLE_DEMO_LOGIN`
- `GET /api/health`
  - health/status JSON
  - reports config readiness without exposing secrets
- `GET /api/runtime-config`
  - exposes only safe client runtime config
  - currently used for demo-login visibility
- `POST /api/speech-token`
  - validates request
  - checks Azure Speech config
  - returns short-lived Speech token when configured
  - logs transcription attempts
- `GET /api/usage`
  - restricted internal usage endpoint
  - only accessible to doctors whose email ends with `@doctorai.local`
- `GET /api/visits`
  - list visits by `doctorId`
- `POST /api/visits`
  - create draft visit and patient row
- `GET /api/visits/[visitId]`
  - fetch one visit
- `POST /api/visits/[visitId]/transcript`
  - save transcript text and status
- `POST /api/visits/[visitId]/interrupt`
  - mark interrupted and preserve transcript
- `POST /api/visits/[visitId]/resume`
  - resume same visit and increment `resume_count`
- `POST /api/visits/[visitId]/summary`
  - generate or regenerate draft summary
  - blocked if visit already has approved summary
- `POST /api/visits/[visitId]/approve`
  - approve summary
  - may also persist `unencrypted_email_consent_status`
- `POST /api/visits/[visitId]/email`
  - send approved summary email
  - blocks with `403` if unencrypted email consent is not approved
  - logs blocked, simulated, sent, or failed delivery

## 4. Current environment variables used

Defined in server config:

- `DATABASE_URL`
- `APP_BASE_URL`
- `AUTH_SECRET`
- `ENABLE_DEMO_LOGIN`
- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_ENDPOINT`
- `AZURE_SPEECH_REGION`
- `AZURE_OPENAI_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_SUMMARY_DEPLOYMENT`
- `AZURE_OPENAI_NORMALIZATION_DEPLOYMENT`
- `ACS_CONNECTION_STRING`
- `ACS_SENDER_ADDRESS`

Behavior notes:

- Core required env for app startup logic:
  - `DATABASE_URL`
  - `APP_BASE_URL`
  - `AUTH_SECRET`
- Hosted POC required env expands this with Speech and OpenAI summary settings
- ACS email env vars are optional
- Placeholder values are treated as not configured

Reference:

- [server-config.ts](C:/Users/tejas/Documents/Codex/2026-06-17/you-are-building-mvp-v1-of/src/lib/server-config.ts)

## 5. Current Azure deployment setup

Current deployment target is Azure App Service Linux named `doctorai-aptiqo`.

Current deployment assumptions:

- App Service provides runtime env vars
- `PORT` is provided by App Service
- App starts with `pnpm start`, which runs a custom wrapper
- The wrapper validates required hosted-POC env vars, binds to `0.0.0.0`, and starts Next with the provided `PORT`
- App Service build automation/Oryx is expected to build from the repository source root during deploy
- Email can stay simulated if ACS is not configured

Reference:

- [start.mjs](C:/Users/tejas/Documents/Codex/2026-06-17/you-are-building-mvp-v1-of/scripts/start.mjs)
- [package.json](C:/Users/tejas/Documents/Codex/2026-06-17/you-are-building-mvp-v1-of/package.json)

## 6. Current GitHub Actions deployment setup

Workflow file:

- [deploy-doctorai.yml](C:/Users/tejas/Documents/Codex/2026-06-17/you-are-building-mvp-v1-of/.github/workflows/deploy-doctorai.yml)

Current workflow behavior:

- triggers on push to `main`
- has a `build` job used as validation only
- injects build-time env vars from GitHub Secrets:
  - `DATABASE_URL`
  - `AUTH_SECRET`
  - Azure Speech envs
  - Azure OpenAI envs
- sets non-secret build envs:
  - `APP_BASE_URL=https://doctorai-aptiqo.azurewebsites.net`
  - `ENABLE_DEMO_LOGIN=false`
  - `NODE_ENV=production`
- `deploy` job does a fresh checkout
- deploys the repository source root directly via `azure/webapps-deploy@v3`
- publish profile secret name is:
  - `AZUREAPPSERVICE_PUBLISHPROFILE_DOCTORAI_APTIQO`

Important: this workflow was recently changed away from artifact packaging because App Service/Oryx needed the actual source root to find the app correctly.

## 7. Current known constraints

- There is no real authenticated session layer; the client stores the selected doctor object in `localStorage`
- API authorization is minimal and mostly driven by passed `doctorId` values
- Password storage is only SHA-256 hashing, not a production-grade password-auth stack
- Demo login is environment-driven and should be disabled in hosted production
- Internal usage access is currently gated by email suffix `@doctorai.local`
- Summary generation falls back to a local placeholder summary when Azure OpenAI is not configured
- Email sending falls back to simulated delivery when ACS is not configured
- The workflow/actual deployment behavior is more current than some README wording; trust the workflow and current code first
- The app is a POC/early-production shape, not a hardened HIPAA-grade auth/access-control implementation

## 8. Current doctor workflow from signup to transcription to summary approval

1. Doctor signs up or logs in via `/api/auth`
2. Frontend stores doctor identity in `localStorage` under `doctorai.doctor`
3. Doctor creates a new visit with patient details, consent, and requested input mode
4. Backend creates:
   - patient row
   - visit row
   - usage event
5. If consent allows it, doctor can use Live Conversation mode
6. Doctor Self-Summary remains available regardless of consent and is also available as fallback
7. For live transcription:
   - client requests `/api/speech-token`
   - backend returns short-lived Azure Speech token when configured
   - browser uses Azure Speech SDK continuous recognition
8. Transcript autosaves to the same visit row every ~4 seconds
9. If page hides or network drops:
   - transcript is saved
   - visit is marked `INTERRUPTED`
   - same visit can be resumed
10. When recording stops, summary generation happens server-side only
11. Summary pipeline:
   - normalize transcript speaker labels into `Doctor:` / `Patient:`
   - generate draft summary from normalized transcript
12. Doctor can edit/regenerate draft summary
13. Doctor can approve summary independently of email
14. Email sending is separate and allowed only if unencrypted email consent status is `APPROVED`
15. Email result is logged in `email_delivery_logs` and mirrored into `usage_events`

## 9. Special implementation details the next Codex context must know

- Frontend app is mostly in [page.tsx](C:/Users/tejas/Documents/Codex/2026-06-17/you-are-building-mvp-v1-of/src/app/page.tsx); it is a large single client component driving auth, dashboard, recording, transcript autosave, summary review, and email actions
- Auth is not cookie/session based; it is localStorage-driven
- `ensureDemoDoctor()` is blocked when `ENABLE_DEMO_LOGIN` is false
- Summary approval and email sending are intentionally separate actions
- Transcript normalization is part of the Azure OpenAI flow and is saved in `normalized_transcript_text`
- Build-time dependencies required by App Service Oryx were moved into `dependencies` in `package.json` so production-only install can still run `prisma generate` and `next build`
- App Service deployment is currently source-root deploy, not ZIP artifact deploy, because Oryx must see the actual repo root
- Health/config visibility is intentionally exposed through `/api/health` without leaking secrets
- If deployment issues come up again, check the current workflow file first, then compare it against README because README may lag behind the most recent workflow fixes
