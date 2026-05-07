-- Adds an idempotency key column to ticket inserts so retried POSTs
-- (offline replay, network blips, double-submits across tabs) collapse
-- to a single row. The client generates one UUID per submit attempt and
-- sends it as `client_request_id` in the body; the unique partial index
-- means concurrent inserts with the same id can't both succeed.
--
-- Run once in the Supabase SQL editor.

ALTER TABLE "Maintenance_Form_Submission"
  ADD COLUMN IF NOT EXISTS client_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfs_client_request_id
  ON "Maintenance_Form_Submission" (client_request_id)
  WHERE client_request_id IS NOT NULL;
