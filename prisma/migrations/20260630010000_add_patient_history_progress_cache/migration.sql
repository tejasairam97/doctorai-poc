-- Add indexes for doctor-scoped patient history lookup by email.
CREATE INDEX IF NOT EXISTS "patients_email_idx" ON "patients"("email");
CREATE INDEX IF NOT EXISTS "visits_doctorId_patientId_idx" ON "visits"("doctorId", "patientId");
CREATE INDEX IF NOT EXISTS "visits_doctorId_status_approved_at_idx" ON "visits"("doctorId", "status", "approved_at");

-- Cache doctor-side progress summaries for patients with 2+ approved visits.
CREATE TABLE "patient_progress_summaries" (
    "id" TEXT NOT NULL,
    "doctor_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "patient_email" TEXT NOT NULL,
    "approved_visit_count" INTEGER NOT NULL,
    "summary_content" TEXT NOT NULL,
    "trend_label" TEXT NOT NULL DEFAULT 'unclear',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_progress_summaries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "patient_progress_summaries_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctor_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "patient_progress_summaries_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "patient_progress_summaries_doctor_id_patient_email_key" ON "patient_progress_summaries"("doctor_id", "patient_email");
CREATE INDEX "patient_progress_summaries_patient_id_idx" ON "patient_progress_summaries"("patient_id");
CREATE INDEX "patient_progress_summaries_trend_label_idx" ON "patient_progress_summaries"("trend_label");
CREATE INDEX "patient_progress_summaries_generated_at_idx" ON "patient_progress_summaries"("generated_at");
