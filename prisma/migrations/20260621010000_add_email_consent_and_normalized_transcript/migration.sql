ALTER TABLE "visits" ADD COLUMN "unencrypted_email_consent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "visits" ADD COLUMN "normalized_transcript_text" TEXT;
