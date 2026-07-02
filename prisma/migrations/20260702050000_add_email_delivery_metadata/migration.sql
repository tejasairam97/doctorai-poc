ALTER TABLE "email_delivery_logs"
ADD COLUMN "purpose" TEXT,
ADD COLUMN "provider" TEXT,
ADD COLUMN "provider_status" TEXT,
ADD COLUMN "message_id" TEXT;

CREATE INDEX "email_delivery_logs_purpose_idx" ON "email_delivery_logs"("purpose");
