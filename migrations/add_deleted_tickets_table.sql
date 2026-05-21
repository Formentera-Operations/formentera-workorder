-- Archive table for tickets deleted via DELETE /api/tickets/[id].
-- The full Maintenance_Form_Submission row is snapshot into original_data
-- as JSONB, plus audit columns capturing who deleted it, when, and why.
-- Child rows (Dispatch, Repairs_Closeout, vendor_payment_details, comments)
-- are cascade-deleted alongside the parent — they're not archived here.

CREATE TABLE IF NOT EXISTS deleted_tickets (
  id BIGINT PRIMARY KEY,
  original_data JSONB NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_by_email TEXT NOT NULL,
  deleted_by_name TEXT,
  deleted_by_role TEXT NOT NULL,
  deletion_reason TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deleted_tickets_deleted_at
  ON deleted_tickets (deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_tickets_deleted_by_email
  ON deleted_tickets (deleted_by_email);

-- RLS: only the service role (used by /api/tickets DELETE) ever touches
-- this table. The anon / authenticated keys can't read or write — there's
-- no client-side UI for the archive yet.
ALTER TABLE deleted_tickets ENABLE ROW LEVEL SECURITY;
