CREATE TABLE "patient_summary_links" (
    "id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "patient_email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_doctor_id" TEXT NOT NULL,

    CONSTRAINT "patient_summary_links_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "patient_summary_links_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "patient_summary_links_created_by_doctor_id_fkey" FOREIGN KEY ("created_by_doctor_id") REFERENCES "doctor_accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "patient_summary_links_token_hash_key" ON "patient_summary_links"("token_hash");
CREATE INDEX "patient_summary_links_patient_email_idx" ON "patient_summary_links"("patient_email");
CREATE INDEX "patient_summary_links_visit_id_idx" ON "patient_summary_links"("visit_id");
CREATE INDEX "patient_summary_links_created_by_doctor_id_idx" ON "patient_summary_links"("created_by_doctor_id");
CREATE INDEX "patient_summary_links_expires_at_idx" ON "patient_summary_links"("expires_at");
