CREATE INDEX "visits_doctorId_status_idx" ON "visits"("doctorId", "status");
CREATE INDEX "visits_doctorId_created_at_idx" ON "visits"("doctorId", "created_at");
CREATE INDEX "usage_events_type_idx" ON "usage_events"("type");
CREATE INDEX "usage_events_created_at_idx" ON "usage_events"("created_at");
CREATE INDEX "email_delivery_logs_status_idx" ON "email_delivery_logs"("status");
CREATE INDEX "email_delivery_logs_created_at_idx" ON "email_delivery_logs"("created_at");
