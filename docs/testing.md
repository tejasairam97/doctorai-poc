# Testing DoctorAI

## What to test first

- Unit tests: pure business rules, config parsing, OTP hashing, and local AI fallbacks.
- Integration tests: API routes plus Prisma against disposable local Postgres.
- Manual smoke tests: signup/login, draft visit, generate summary, approve, email or simulated email, patient summary link.

## Current automated coverage

Run:

```powershell
pnpm test
```

These tests do not need real Azure keys or a database. Placeholder patient data uses `patient.placeholder@example.test` and placeholder clinical summaries; replace those fixtures when we agree on realistic seeded scenarios.

## Integration tests

Run against local Postgres only:

```powershell
pnpm db:up
pnpm prisma:push
pnpm test:integration
```

The integration setup reads `TEST_DATABASE_URL`, `.env.test`, or `.env.local`, and refuses any database host that is not `localhost`, `127.0.0.1`, or `::1`. Tests create unique placeholder doctor/patient emails and delete only their own records.

## Next tests to add

- Route tests for OTP request/verify and visit summary APIs.
- One Playwright end-to-end happy path after local Postgres is reliably available in CI.
