ALTER TABLE "patient_progress_summaries"
ADD COLUMN IF NOT EXISTS "confidence_label" TEXT NOT NULL DEFAULT 'unclear',
ADD COLUMN IF NOT EXISTS "cache_version" TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX IF NOT EXISTS "patient_progress_summaries_cache_version_idx"
ON "patient_progress_summaries"("cache_version");
