ALTER TABLE "email_delivery_logs"
ADD COLUMN IF NOT EXISTS "doctor_id" TEXT;

ALTER TABLE "email_delivery_logs"
ALTER COLUMN "visit_id" DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'email_delivery_logs_doctor_id_fkey'
  ) THEN
    ALTER TABLE "email_delivery_logs"
    ADD CONSTRAINT "email_delivery_logs_doctor_id_fkey"
    FOREIGN KEY ("doctor_id") REFERENCES "doctor_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "email_delivery_logs_doctor_id_idx"
ON "email_delivery_logs"("doctor_id");
