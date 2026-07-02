CREATE TABLE IF NOT EXISTS "login_otps" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role_context" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "request_ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_otps_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "patient_sessions" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "login_otps_email_role_context_purpose_created_at_idx"
ON "login_otps"("email", "role_context", "purpose", "created_at");

CREATE INDEX IF NOT EXISTS "login_otps_request_ip_created_at_idx"
ON "login_otps"("request_ip", "created_at");

CREATE INDEX IF NOT EXISTS "login_otps_expires_at_idx"
ON "login_otps"("expires_at");

CREATE INDEX IF NOT EXISTS "login_otps_consumed_at_idx"
ON "login_otps"("consumed_at");

CREATE UNIQUE INDEX IF NOT EXISTS "patient_sessions_session_token_hash_key"
ON "patient_sessions"("session_token_hash");

CREATE INDEX IF NOT EXISTS "patient_sessions_email_idx"
ON "patient_sessions"("email");

CREATE INDEX IF NOT EXISTS "patient_sessions_expires_at_idx"
ON "patient_sessions"("expires_at");

CREATE INDEX IF NOT EXISTS "patient_sessions_revoked_at_idx"
ON "patient_sessions"("revoked_at");
