-- Adds idempotency key columns to Dispatch and Repairs_Closeout so
-- retried POSTs (offline replay, network blips, double-submits across
-- tabs) collapse to a single row + a single email. The client generates
-- one UUID per submit attempt and sends it as `client_request_id` in the
-- body; the unique partial index means concurrent inserts with the same
-- id can't both succeed. Mirrors add_client_request_id_to_maintenance_form_submission.sql.
--
-- Run once in the Supabase SQL editor before deploying the API changes.

ALTER TABLE "Dispatch"
  ADD COLUMN IF NOT EXISTS client_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_dispatch_client_request_id
  ON "Dispatch" (client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE "Repairs_Closeout"
  ADD COLUMN IF NOT EXISTS client_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_repairs_closeout_client_request_id
  ON "Repairs_Closeout" (client_request_id)
  WHERE client_request_id IS NOT NULL;
