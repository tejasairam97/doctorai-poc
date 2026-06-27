ALTER TABLE "visits" ADD COLUMN "unencrypted_email_consent_status" TEXT NOT NULL DEFAULT 'NOT_ASKED';
UPDATE "visits"
SET "unencrypted_email_consent_status" = 'APPROVED'
WHERE "unencrypted_email_consent" = true;
